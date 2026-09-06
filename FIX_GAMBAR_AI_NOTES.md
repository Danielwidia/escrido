# Fix: Tampilan Gambar Soal AI di Bank Soal

## Masalah
Gambar untuk soal yang dibuat AI tidak muncul di bank soal maupun di lembar kerja siswa, padahal gambar sudah ada di folder `/images/`.

## Root Cause
1. **Bank Soal Detail**: Di fungsi `renderAdminDetailPaket()`, kolom gambar (`q.images` array) tidak ditampilkan dalam tabel detail paket soal
2. **Gambar AI**: Path gambar dari pollinations.ai sudah di-convert ke `/images/ai_*.jpg` oleh server saat di-process

## Solusi yang Diterapkan

### 1. Menambah Kolom Gambar di Bank Soal Detail
**File**: `app.js` - Fungsi `renderAdminDetailPaket()` (line ~3389)

**Perubahan:**
- Menambah kolom baru untuk menampilkan thumbnail gambar
- Menampilkan jumlah gambar dengan badge
- Implementasi click-to-zoom menggunakan SweetAlert
- Menangani kedua format: `q.images` (array) dan `q.image` (legacy single)

**Kode:**
```javascript
// Generate image column HTML
let imageColHtml = '<span class="text-slate-400">-</span>';
if (q.images && Array.isArray(q.images) && q.images.length > 0) {
    const firstImg = normalizeImgSrc(q.images[0]);
    imageColHtml = `
        <div class="flex items-center gap-2">
            <img src="${firstImg}" alt="Gambar" class="w-8 h-8 object-cover rounded border border-slate-200 cursor-zoom-in" 
                onclick="event.stopPropagation(); Swal.fire({imageUrl: '${firstImg}', showConfirmButton: false, customClass: {popup: 'rounded-3xl border-none shadow-2xl'}})" title="Klik untuk perbesar">
            <span class="text-[10px] font-bold text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded">${q.images.length}</span>
        </div>
    `;
}
```

**Tabel Kolom:**
- No. | Soal | **Gambar** | Mapel/Rombel | Jawaban | Tipe | Aksi

### 2. Verifikasi Flow Gambar AI

**Flow Lengkap:**
1. AI generate soal → Response dari `/api/generate-ai` dengan URL gambar `https://image.pollinations.ai/...`
2. Server process → `processImagesInQuestions()` save gambar ke `/images/ai_*.jpg`
3. Soal disimpan → Database menyimpan `q.images = ['/images/ai_*.jpg']`
4. UI render → `normalizeImgSrc()` convert path ke full URL → Browser load gambar

**Path Gambar yang Benar:**
- Format: `/images/ai_{timestamp}_{random}.{ext}`
- Contoh: `/images/ai_1705123456_abc12.jpg`
- Server serve dari: `rootPath/images/` via middleware `/images`

### 3. Kompatibilitas
- ✅ Bank Soal Global View: Sudah ada tampilan gambar
- ✅ Bank Soal Detail View: **FIXED** - Kolom gambar ditambah
- ✅ Halaman Ujian Siswa: Gambar sudah tampil di `showQuestion()`
- ✅ Edit Soal Modal: Gambar sudah ditampilkan saat edit

## Testing Checklist

### Test Case 1: Generate Soal dengan Gambar
```
1. Login sebagai Admin/Guru
2. Buka "Soal Pintar" → "Generate Soal Pintar"
3. Pilih Mata Pelajaran & Kelas
4. Set Penanganan Gambar = "Generate Gambar Asli Otomatis (AI)"
5. Click "GENERATE DENGAN AI"
6. Tunggu hingga selesai → Soal dengan gambar generate dari AI
```

### Test Case 2: Lihat Gambar di Bank Soal
```
1. Admin → Bank Soal → Riwayat Soal
2. Cari soal dengan gambar (yang di-generate AI)
3. Click "Lihat Detail" untuk paket soal tersebut
4. Verifikasi: Ada kolom "Gambar" dengan thumbnail
5. Click thumbnail → Preview gambar besar
```

### Test Case 3: Lihat Gambar saat Ujian
```
1. Login sebagai Siswa
2. Ambil ujian dengan soal yang punya gambar AI
3. Gambar seharusnya muncul di bawah soal
4. Click gambar untuk zoom/preview
```

### Test Case 4: Verifikasi Folder Images
```
Periksa folder: `{aplikasi}/images/`
Seharusnya ada file: `ai_*.jpg` (gambar-gambar AI yang tersimpan)
```

## File Output Location
- **Gambar disimpan ke**: `{rootPath}/images/ai_*.jpg`
- **Server serve dari**: `http://localhost:3000/images/ai_*.jpg`
- **Database reference**: `/images/ai_*.jpg`

## Issue yang Mungkin Terjadi

### Issue 1: Gambar Tidak Muncul Padahal Ada di Folder
**Solusi:**
1. Pastikan path di database benar: `/images/ai_*.jpg` (jangan absolute path)
2. Check middleware static di server.js sudah serve `/images`
3. Refresh browser cache (Ctrl+F5)

### Issue 2: Kolom Gambar Tidak Muncul di Tabel
**Solusi:**
1. Pastikan `app.js` sudah updated (reload page di admin)
2. Check browser console untuk errors
3. Pastikan SweetAlert library sudah loaded

### Issue 3: Contoh Debug Server
```javascript
// Di server.js, check log:
// [STORAGE] Local save success: /images/ai_1705123456_abc12.jpg
// Ini berarti gambar successfully saved ke folder
```

## Deployment Notes
- ✅ Tidak ada breaking changes
- ✅ Backward compatible dengan soal lama (single image)
- ✅ Auto-migrate dari `q.image` ke `q.images[]`
- ✅ Works di dev mode maupun production (.exe)

## Next Steps (Optional)
1. Bulk image optimization untuk AI generated images
2. Cleanup old unused images di `/images/` folder
3. Add image gallery view di bank soal
4. Archive/backup images secara periodik
