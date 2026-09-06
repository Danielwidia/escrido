# Perbaikan: Admin SIMPAN Progress Siswa

## Masalah
Ketika admin menekan tombol **SIMPAN** di Live Progress, jawaban siswa tersimpan ke server. Namun, ketika siswa melakukan reload/login kembali, siswa mengerjakan soal dari awal (bukan melanjutkan dari soal yang telah disimpan).

## Root Cause
1. Saat admin menekan **SIMPAN**, data `adminSavedProgress` tersimpan ke server dengan benar
2. Namun, saat siswa login kembali:
   - Data tidak di-restore dari `adminSavedProgress` yang benar
   - Fungsi `saveStudentExamProgress()` tidak menyimpan dengan konsisten
   - `examData.adminSavedProgress` tidak diperbarui ketika siswa menerima perintah dari admin

## Solusi Implementasi

### 1. Perbaiki `saveStudentExamProgress()` (Line 66-115)
**Perubahan:**
- Prioritas 1: Gunakan `examData.adminSavedProgress` jika ada (dari perintah admin SIMPAN)
- Prioritas 2: Jika `examData.savedByAdminCommand` bernilai true, gunakan state `examData` saat ini
- Fallback: Jangan simpan jika tidak ada flag admin save

**Alasan:** Memastikan hanya checkpoint yang diinisiasi admin yang disimpan ke localStorage

### 2. Perbaiki `requestStudentSave()` (Line 357-401)
**Perubahan:**
- Ubah `activeExam.savedByAdminCommand = false` menjadi `true`
- Hapus panggilan `saveStudentExamProgress()` dari admin side (biar siswa yang handle)
- Log dengan detail `adminSaveRequest` SET TRUE

**Alasan:** Menandai bahwa admin telah menyimpan, flag akan dideteksi siswa saat polling

### 3. Perbaiki `processAdminCommandsOnStudent()` (Line 7199-7223)
**Perubahan:**
- Ketika `commandEntry.adminSaveRequest` terdeteksi:
  - Update `examData.adminSavedProgress` DENGAN DATA DARI ADMIN
  - Update `examData.currentIdx`, `examData.answers`, `examData.ragu`
  - Update `examSecondsRemaining`
  - Set `examData.savedByAdminCommand = true`
  - Baru kemudian panggil `saveStudentExamProgress()`

**Alasan:** Memastikan siswa menerima checkpoint yang tepat dari admin dan menyimpannya ke localStorage

### 4. Perbaiki `getSavedStudentExamProgress()` (Line 160-176)
**Perubahan:**
- Tambahkan `adminSavedProgress: exact.adminSavedProgress` ke dalam objek `saved`
- Ini memastikan full `adminSavedProgress` dikirim ke `resumeStudentExam()`

**Alasan:** Mempertahankan semua informasi checkpoint untuk restore yang komprehensif

### 5. Perbaiki `resumeStudentExam()` (Line 218-237)
**Perubahan:**
- Gunakan `saved.adminSavedProgress` jika tersedia
- Jika tidak ada, rekonstruksi dari data `saved` yang lain

**Alasan:** Memastikan ketika melanjutkan ujian, `examData.adminSavedProgress` sudah berisi data yang benar

## Alur Kerja yang Benar Setelah Perbaikan

### A. Admin Menekan SIMPAN
```
1. Admin Panel: renderRombelProgress() → requestStudentSave(studentId)
2. requestStudentSave():
   ├─ Ambil activeExam dari db.activeExams untuk siswa
   ├─ Buat saveEntry dengan adminSavedProgress berisi:
   │  ├─ currentIdx
   │  ├─ answers (semua jawaban)
   │  ├─ ragu[]
   │  ├─ totalSeconds
   │  └─ remainingSeconds
   ├─ Set activeExam.adminSaveRequest = true
   ├─ Set activeExam.savedByAdminCommand = true
   ├─ POST ke /api/live-exam dengan saveEntry
   └─ saveLocalDb() → DB Updated ✅

3. Server: /api/live-exam
   ├─ Terima saveEntry dengan adminSavedProgress lengkap
   └─ insertLiveExamSingle() → Simpan ke database ✅

4. Siswa (polling setiap ~500ms):
   ├─ fetchLiveExamsFromServer() → Dapat entry dengan adminSaveRequest=true
   ├─ processAdminCommandsOnStudent():
   │  ├─ Detect adminSaveRequest
   │  ├─ Update examData dari commandEntry.adminSavedProgress
   │  ├─ examData.adminSavedProgress = commandEntry.adminSavedProgress
   │  ├─ Set examData.savedByAdminCommand = true
   │  └─ saveStudentExamProgress() → SAVE CHECKPOINT ke localStorage ✅
   └─ Toast: "Admin menyimpan jawaban Anda..."
```

### B. Siswa Reload/Login Kembali
```
1. Siswa Login
   ├─ showStudentExamList()
   └─ restoreStudentExamProgress()

2. restoreStudentExamProgress():
   ├─ getSavedStudentExamProgress():
   │  ├─ Fetch /api/live-exams dari server
   │  ├─ Cari entry dengan e.adminSavedProgress.answers.length > 0
   │  ├─ Ekstrak saved object dengan:
   │  │  ├─ answers: dari adminSavedProgress.answers
   │  │  ├─ currentIdx: dari adminSavedProgress.currentIdx
   │  │  ├─ ragu: dari adminSavedProgress.ragu
   │  │  ├─ adminSavedProgress: FULL OBJECT
   │  │  └─ savedByAdminCommand: true
   │  ├─ Cache ke localStorage dengan STUDENT_ADMIN_SAVED_PROGRESS_KEY
   │  └─ Return saved object ✅
   └─ resumeStudentExam(saved):
      ├─ Load questions dan normalize
      ├─ Restore examData dari saved:
      │  ├─ examData.currentIdx = saved.currentIdx
      │  ├─ examData.answers = saved.answers
      │  ├─ examData.ragu = saved.ragu
      │  └─ examData.adminSavedProgress = saved.adminSavedProgress ✅
      ├─ examSecondsRemaining = saved.remainingSeconds
      └─ Resume dari soal sesuai currentIdx (BUKAN DARI AWAL) ✅
```

## Testing Checklist

- [ ] Admin login → Buka Live Progress
- [ ] Pilih siswa yang sedang mengerjakan ujian
- [ ] Klik tombol **SIMPAN**
- [ ] Verifikasi:
  - Di console: `[requestStudentSave] ✅ JAWABAN SISWA ... DISIMPAN KE SERVER`
  - Toast berhasil muncul
  - Database terupdate
- [ ] Siswa (di browser lain) lihat toast: "Admin menyimpan jawaban Anda"
- [ ] Siswa reload halaman atau logout
- [ ] Siswa login kembali
- [ ] Verifikasi:
  - Siswa TIDAK diminta untuk pilih ulang mapel (auto-load)
  - Siswa TIDAK dimulai dari soal pertama
  - Siswa melanjutkan dari soal sesuai `currentIdx` dari admin save
  - Console: `[resumeStudentExam] Resuming exam from saved progress...`

## Log Messages untuk Debugging

Jika masalah masih terjadi, cek console untuk messages:

```javascript
// Admin side
[requestStudentSave] ✅ JAWABAN SISWA {studentId} DISIMPAN KE SERVER - adminSaveRequest SET TRUE

// Server side
[POST /api/live-exam] Received: { studentId: ..., mapel: ... }
[insertLiveExamSingle] Saved to SQLite

// Student side (polling)
[Student] ADMIN SAVE REQUEST DETECTED - Forcing latest exam state save
[Student] adminSavedProgress from server: { currentIdx: ..., answers.length: ..., ... }
[Student] ✅ examData updated with admin saved progress: { currentIdx: ..., answersCount: ... }
[saveStudentExamProgress] ✅ Checkpoint saved: { currentIdx: ..., answersCount: ... }

// Student restore
[getSavedStudentExamProgress] Fetching from server...
[getSavedStudentExamProgress] Exact match found: true
[getSavedStudentExamProgress] Admin saved progress: { currentIdx: ..., answers.length: ... }
[resumeStudentExam] Resuming exam from saved progress: { mapel: ..., currentIdx: ..., answersCount: ..., source: ... }
```

## Files Dimodifikasi
- `app.js` (5 fungsi diperbaiki)
  - `saveStudentExamProgress()` (Line 66-115)
  - `requestStudentSave()` (Line 357-401)
  - `processAdminCommandsOnStudent()` (Line 7199-7223)
  - `getSavedStudentExamProgress()` (Line 160-176)
  - `resumeStudentExam()` (Line 218-237)

## Catatan Penting
- Perubahan bersifat **backward compatible** - tidak merusak ujian yang sedang berjalan
- Semua checkpoint tersimpan di 3 layer:
  1. **Server** (`db.activeExams`)
  2. **Client localStorage** (`STUDENT_ADMIN_SAVED_PROGRESS_KEY`)
  3. **Memory** (`examData.adminSavedProgress`)
- Prioritas restore: Server → localStorage → Memory
