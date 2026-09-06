# ROOT CAUSE & FIX: Admin SIMPAN Progress Tidak Restore

## 🔴 Root Cause Ditemukan

### Problem Statement
Ketika admin menekan tombol **SIMPAN** di "Live Progress Siswa", data seharusnya tersimpan. Namun saat siswa reload/login kembali, siswa mengerjakan dari awal (checkpoint hilang).

### Root Cause Analysis

Masalah terjadi di TIGA tempat:

#### 1. **Server Endpoint `/api/live-exams` - Hanya return data < 5 menit**
   - **File:** `server.js` Line 1043-1060 (SEBELUM PERBAIKAN)
   - **Masalah:** 
     ```javascript
     const fresh = liveExams.filter(exam => {
         const updatedAt = exam.updatedAt ? new Date(exam.updatedAt).getTime() : 0;
         return !Number.isNaN(updatedAt) && (now - updatedAt) < 5 * 60 * 1000; // ← Only 5 mins!
     });
     ```
   - **Impact:** Jika admin SIMPAN > 5 menit yg lalu, entry tidak ter-return
   - **Solusi:** Filter berubah menjadi: Return FRESH (< 5 min) ATAU ada `adminSavedProgress.answers.length > 0`

#### 2. **Server Tidak Ada Endpoint Khusus untuk Restore**
   - **Masalah:** Ketika siswa login dan klik "MULAI UJIAN", harus fetch `/api/live-exams` untuk search entry
   - **Issue:** Array mungkin besar, filter kompleks, bisa miss
   - **Solusi:** Add new endpoint `/api/saved-exam/:studentId/:mapel?rombel=X`

#### 3. **Client `getSavedStudentExamProgress()` - Fallback mechanism lemah**
   - **File:** `app.js` Line 135-200 (SEBELUM PERBAIKAN)
   - **Masalah:** Hanya try `/api/live-exams`, jika gagal langsung skip ke localStorage
   - **Fix:** 
     1. Try specific endpoint `/api/saved-exam/...` (baru)
     2. Fallback ke general `/api/live-exams` (sebelumnya)
     3. Fallback ke localStorage (lokal)

## ✅ Perbaikan Diterapkan

### 1. Update Server `/api/live-exams` (FILE: server.js)

**Pattern Match yang Baru:**
```javascript
const result = liveExams.filter(exam => {
    const isFresh = (now - updatedAt) < 5 * 60 * 1000;
    const hasAdminCheckpoint = exam.adminSavedProgress && 
                              Array.isArray(exam.adminSavedProgress.answers) && 
                              exam.adminSavedProgress.answers.length > 0;
    return isFresh || hasAdminCheckpoint; // ← ANY age OK jika ada checkpoint
});
```

### 2. Add New Server Endpoint (FILE: server.js)

```javascript
GET /api/saved-exam/:studentId/:mapel?rombel=X
// Returns: { ok: true, exam: {...} } atau { ok: false, exam: null }
// Purpose: Direct lookup untuk restore without scanning full array
```

### 3. Update Client Function (FILE: app.js Line 135-220)

```javascript
async function getSavedStudentExamProgress(mapel = null) {
    // Step 1: Try specific endpoint
    if (mapel) {
        try {
            const res = await fetch(`/api/saved-exam/${studentId}/${mapel}?rombel=X`);
            if (res.ok && data.ok) return saved; // ← Found!
        } catch { }
    }
    
    // Step 2: Fallback to general endpoint
    try {
        const serverExams = await fetchLiveExamsFromServer(); // /api/live-exams
        const exact = serverExams.find(...); // search di array
        if (exact) return saved; // ← Found!
    } catch { }
    
    // Step 3: Fallback ke localStorage
    const localSaved = loadAdminSavedProgress();
    if (localSaved && matchSaved(localSaved)) return localSaved; // ← Found!
    
    // Step 4: Not found
    return null;
}
```

## 📊 Flow Perbaikan

```
SEBELUM (Broken):
1. Admin SIMPAN → Data ke server ✓
2. Siswa login → Fetch /api/db (tidak include activeExams)
3. Siswa klik mapel → Call startExam()
4. startExam() → Call getSavedStudentExamProgress()
5. getSavedStudentExamProgress() → Fetch /api/live-exams
6. Server FILTER: hanya return < 5 min ← MASALAH!
7. Jika query time = admin SIMPAN + 10 min = MISS ❌
8. Siswa start dari soal 1 ❌

SESUDAH (Fixed):
1. Admin SIMPAN → Data ke server ✓
2. Siswa login → Fetch /api/db (tidak include activeExams) ✓
3. Siswa klik mapel → Call startExam()
4. startExam() → Call getSavedStudentExamProgress()
5. getSavedStudentExamProgress():
   a. Try /api/saved-exam/{studentId}/{mapel}?rombel=X
      → Direct lookup, return entry dengan adminSavedProgress ✓
   b. Jika gagal, fallback /api/live-exams
      → Filter return FRESH OR adminCheckpoint ✓
   c. Jika gagal, fallback localStorage
      → Local cache dari sebelumnya ✓
6. Return saved ✓
7. resumeStudentExam(saved) → Restore dari checkpoint ✓
8. Siswa melanjutkan dari soal yg tepat ✅
```

## 🔍 Testing New Flow

### Test 1: Immediate After Admin SIMPAN (< 5 min)
```
1. Admin login → Open Live Progress
2. Admin SIMPAN siswa A
3. Siswa A (1-2 detik kemudian) reload
4. siswa A login ulang
5. Siswa A klik mapel
   EXPECTED: Resume dari checkpoint ✅
   MECHANISM: /api/live-exams return FRESH entry
```

### Test 2: Delayed After Admin SIMPAN (ANY TIME)
```
1. Admin login → Open Live Progress
2. Admin SIMPAN siswa A (pada jam 10:00)
3. Siswa A login (pada jam 10:00:05 atau kapanpun setelah itu)
4. Siswa A klik mapel
   EXPECTED: Resume dari checkpoint ✅
   MECHANISM: 
   - /api/saved-exam/siswaA/mapel return entry (specific endpoint)
   - OR /api/live-exams return entry (adminCheckpoint filter)
```

### Test 3: Fresh Admin SIMPAN + Multiple Queries
```
1. Admin SIMPAN 3 siswa different mapels
2. Siswa 1 login → query mapel X
   EXPECTED: Get entry untuk siswa 1 mapel X ✅
3. Siswa 2 login → query mapel Y
   EXPECTED: Get entry untuk siswa 2 mapel Y ✅
4. Siswa 3 login → query mapel Z
   EXPECTED: Get entry untuk siswa 3 mapel Z ✅
   MECHANISM: /api/saved-exam endpoint filtered by studentId + mapel
```

## 📥 Console Logs untuk Debug

### Server Logs (Expect to see):
```
[GET /api/saved-exam] studentId: DRKS-1234 mapel: Matematika rombel: 7A
[GET /api/saved-exam] ✅ Found: { currentIdx: 7, answerCount: 7 }
// OR
[GET /api/live-exams] Total: 25 | Fresh (<5min): 3 | With admin checkpoint: 15 | Returned: 18
```

### Client Logs (Expect to see):
```
[getSavedStudentExamProgress] Trying specific endpoint for DRKS-1234 mapel: Matematika
[getSavedStudentExamProgress] Fetching from: http://localhost:3000/api/saved-exam/DRKS-1234/Matematika?rombel=7A
[getSavedStudentExamProgress] ✅ Found via specific endpoint
[getSavedStudentExamProgress] ✅ Admin saved progress: { currentIdx: 7, answers.length: 7, ... }
[startExam] ✅ Found saved progress for mapel, resuming instead of restarting: Matematika from index: 7
[resumeStudentExam] Resuming exam from saved progress: { mapel: Matematika, currentIdx: 7, answersCount: 7, source: server }
```

## 📁 Files Modified

### server.js
- Line 1043-1080: Update `/api/live-exams` endpoint
- Line 1082-1117: Add new `/api/saved-exam/:studentId/:mapel` endpoint

### app.js  
- Line 135-220: Rewrite `getSavedStudentExamProgress()` dengan 3-tier fallback mechanism
- Line 658-660: Improved logging di `startExam()`

## 🎯 Expected Behavior Now

1. ✅ Admin SIMPAN → Entry ke database dengan `adminSavedProgress`
2. ✅ Admin selesai, task selesai
3. ✅ Siswa reload/login pagi hari (>12 jam kemudian)
4. ✅ Siswa klik mapel
5. ✅ System detect ada saved checkpoint
6. ✅ Auto-load dari checkpoint
7. ✅ Siswa melanjutkan soal dari posisi sebelumnya
8. ✅ NO "ngerjain dari awal"  ❌ 

#### 4. **Student ID Mismatch dlm `adminSavedProgress` (Ditemukan di Langkah Tambahan)**
   - **File:** `app.js` Line 401-430 (Fungsi `requestStudentSave`)
   - **Masalah:** 
     ```javascript
     adminSavedProgress: {
         studentId: currentSiswa.id, // ← INI ADALAH ID ADMIN! (Karena dipanggil di dashboard admin)
         ...
     }
     ```
   - **Impact:** Ketika siswa login, `getSavedStudentExamProgress` Reject data karena ID mismatch (`saved.studentId !== currentSiswa.id`).
   - **Solusi:** Ganti `currentSiswa.id` menjadi `activeExam.studentId`.

#### 5. **Global "SIMPAN LIVE" Tidak Menyimpan Checkpoint Individu**
   - **Masalah:** Tombol global hanya save DB general, tidak memicu checkpoint di store `live_exams`.
   - **Solusi:** Implementasi `saveAllLiveProgress()` yang iterasi semua `db.activeExams` dan kirim `adminSaveRequest` untuk tiap siswa.

## ✅ Perbaikan Tambahan (13 Mei 2026)

### 1. Fix metadata di `requestStudentSave`
Corrected `studentId`, `studentName`, dan `rombel` agar menggunakan data `activeExam`, bukan data admin yang sedang login.

### 2. Implementasi Global Save
Menambahkan fungsi `saveAllLiveProgress()` dan mengupdate `saveLiveProgressState()` agar semua siswa yang sedang ujian ikut tersimpan checkpoint-nya saat tombol "SIMPAN" global ditekan.

### 3. Refine Sync Logic
Mengubah key merge di `syncAdminLiveState` dari hanya `studentId` menjadi `studentId|mapel` agar siswa yang mengambil mata pelajaran berbeda tidak tertukar/terhapus datanya di dashboard admin.

---
*Perbaikan ini memastikan sinkronisasi antara admin dan siswa berjalan sempurna, bahkan jika admin menggunakan tombol simpan global maupun per siswa.*
