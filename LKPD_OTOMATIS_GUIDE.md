# 📚 Panduan LKPD Otomatis (dari RPP)

## 1. Overview Fitur

Fitur **LKPD Otomatis** memungkinkan guru untuk membuat Lembar Kerja Peserta Didik (LKPD) secara otomatis berdasarkan file Rencana Pelaksanaan Pembelajaran (RPP) yang diupload.

### Keuntungan:
✅ Hemat waktu - otomatis membuat LKPD yang sesuai RPP  
✅ Konsistensi - LKPD align dengan tujuan pembelajaran dan metode di RPP  
✅ Fleksibel - bisa set jumlah aktivitas (1-10)  
✅ Mudah - cukup upload RPP dan klik Generate  

---

## 2. Cara Menggunakan

### Step 1: Buka Tab LKPD (Siswa)
- Klik menu **"LKPD (Siswa)"** di sidebar kiri
- Format **"⚡ LKPD Otomatis (Upload RPP)"** sudah dipilih secara default

### Step 2: Verifikasi Format (Sudah Default Otomatis)
- Field **"Format / Tipe LKPD"** sudah menampilkan **"⚡ LKPD Otomatis (Upload RPP)"** sebagai pilihan default
- Jika ingin menggunakan format lain (Diskusi, Eksperimen, dll), silakan ubah dari dropdown

### Step 3: Isi Form yang Diperlukan
Isikan field-field berikut:

| Field | Wajib? | Contoh |
|-------|--------|---------|
| **Mata Pelajaran** | ✅ Ya | Matematika, Bahasa Indonesia, IPA, dll |
| **Fase** | ✅ Ya | Fase B, Fase C, Fase D, dll |
| **Semester** | ✅ Ya | 1 atau 2 |
| **Topik / Materi Pokok** | ⚠️ Opsional* | Bangun Datar, Persamaan Linear, dll |
| **Alokasi Waktu** | ✅ Ya | 2 x 40 Menit, 1 Jam, dll |
| **Upload RPP** | ✅ Ya | File: .doc, .docx, .pdf |

*Topik bisa dikosongkan jika Anda yakin RPP sudah jelas mencakup semua materi

### Step 4: Upload File RPP
- Klik tombol upload di area "Upload RPP"
- Pilih file RPP Anda (format: .doc, .docx, atau .pdf)
- Tunggu file ditampilkan dengan ✅ checkmark hijau
- File info menampilkan: Nama file + Ukuran file

### Step 5: Lihat Informasi Auto-Detection
- Area **"Jumlah Aktivitas"** menampilkan info: "Jumlah aktivitas akan otomatis disesuaikan berdasarkan kegiatan pembelajaran yang terdeteksi di RPP Anda. Tidak perlu diisi manual."
- **Tidak perlu memasukkan angka** - sistem akan otomatis mendeteksi kegiatan di RPP

### Step 6: Generate LKPD
- Klik tombol **"GENERATE LKPD OTOMATIS"** 
- Tunggu proses (biasanya 30-60 detik)
- LKPD akan ditampilkan di panel preview

### Step 7: Simpan/Download
- Klik tombol **"Download"** atau **"Simpan ke Database"**
- Format output: HTML yang siap dicetak atau dibagikan ke siswa

---

## 3. Workflow Lengkap

```
┌──────────────────────────────────────────────────────┐
│   1. Buka Tab LKPD (Siswa)                           │
│      Format: ⚡ LKPD Otomatis (SUDAH DEFAULT)        │
└─────────────┬──────────────────────────────────────┘
              │
┌─────────────▼──────────────────────────────────────┐
│   2. Isi Form:                                     │
│      - Mata Pelajaran                              │
│      - Fase / Tingkat                              │
│      - Semester                                    │
│      - Alokasi Waktu                               │
│      - Topik (opsional)                            │
└─────────────┬──────────────────────────────────────┘
              │
┌─────────────▼──────────────────────────────────────┐
│   3. Upload File RPP                               │
│      (.doc, .docx, atau .pdf)                      │
│      Tunggu: ✅ File terupload                     │
└─────────────┬──────────────────────────────────────┘
              │
┌─────────────▼──────────────────────────────────────┐
│   4. Sistem Akan:                                  │
│      🔍 Membaca RPP dengan detail                  │
│      🔍 Mendeteksi kegiatan pembelajaran          │
│      🔍 Menghitung jumlah aktivitas optimal        │
│         (otomatis: 3-8 aktivitas)                  │
└─────────────┬──────────────────────────────────────┘
              │
┌─────────────▼──────────────────────────────────────┐
│   5. Klik "GENERATE LKPD OTOMATIS"                │
│      AI membaca RPP dan membuat LKPD dengan:       │
│      ✓ Aktivitas sesuai kegiatan di RPP            │
│      ✓ Jumlah aktivitas otomatis-terdeteksi        │
│      ✓ Tujuan pembelajaran aligned                 │
│      ✓ Metode pembelajaran sesuai RPP              │
└─────────────┬──────────────────────────────────────┘
              │
┌─────────────▼──────────────────────────────────────┐
│   6. Preview LKPD (30-90 detik)                    │
│      Review hasil generate                         │
└─────────────┬──────────────────────────────────────┘
              │
    ┌─────────┴──────────────┐
    │                        │
┌───▼────────┐        ┌──────▼──────┐
│  Download  │        │  Simpan DB  │
│  (HTML)    │        │  (Database) │
└────────────┘        └─────────────┘
```

## ⭐ Fitur Auto-Detection

### Apa itu Auto-Detection?
Sistem akan **otomatis mendeteksi dan menghitung** jumlah aktivitas berdasarkan kegiatan pembelajaran di RPP:

- 🔍 **Membaca kegiatan inti (Kegiatan Inti) di RPP**
- 🔍 **Menghitung fase/tahapan pembelajaran**
- 🔍 **Mendeteksi jumlah learning objectives**
- 🔍 **Mempertimbangkan alokasi waktu**
- 🔍 **Menghasilkan 3-8 aktivitas optimal** (tidak hardcode)

### Mengapa Auto-Detection?
✅ **Lebih cerdas**: Jumlah aktivitas sesuai kebutuhan RPP yang sebenarnya  
✅ **Lebih efisien**: Tidak perlu mikir berapa jumlah aktivitas yang tepat  
✅ **Lebih flexible**: Jumlah berbeda untuk setiap RPP  
✅ **Lebih aligned**: Setiap aktivitas sesuai dengan kegiatan di RPP  

### Contoh Auto-Detection:

**RPP 1: Matematika - Bangun Datar (2 fase pembelajaran)**
```
Input: Upload RPP Bangun Datar
Output: LKPD dengan 3 aktivitas
Alasan: RPP memiliki 2 fase pembelajaran + 1 persiapan = 3 aktivitas optimal
```

**RPP 2: IPA - Fotosintesis (4 fase pembelajaran)**
```
Input: Upload RPP Fotosintesis
Output: LKPD dengan 5 aktivitas
Alasan: RPP memiliki 4 fase pembelajaran + 1 refleksi = 5 aktivitas optimal
```

**RPP 3: Bahasa Indonesia - Analisis Cerpen (5 pembelajaran objectives)**
```
Input: Upload RPP Analisis Cerpen
Output: LKPD dengan 5-6 aktivitas
Alasan: 5 learning objectives terdeteksi = 5-6 aktivitas untuk setiap objective
```

---

## 4. Contoh Form yang Benar

### Contoh 1: Matematika - Bangun Datar
```
📌 Mata Pelajaran: Matematika
📌 Fase: Fase C (Kelas 5)
📌 Semester: 1
📌 Topik: Bangun Datar - Luas dan Keliling
📌 Alokasi Waktu: 2 x 40 Menit
📌 Jumlah Aktivitas: 5
📌 Upload RPP: RPP_Bangun_Datar.docx ✅
```
**Hasil Expected**: LKPD dengan 5 aktivitas about bangun datar, sesuai dengan RPP

### Contoh 2: Bahasa Indonesia - Cerpen
```
📌 Mata Pelajaran: Bahasa Indonesia
📌 Fase: Fase D (Kelas 7)
📌 Semester: 1
📌 Topik: (dikosongkan - ada di RPP)
📌 Alokasi Waktu: 3 x 40 Menit
📌 Jumlah Aktivitas: 6
📌 Upload RPP: RPP_Analisis_Cerpen.pdf ✅
```
**Hasil Expected**: LKPD dengan 6 aktivitas analisis cerpen

---

## 5. Tips & Best Practices

### 📋 Tips untuk RPP yang Bagus (untuk Auto-Detection Optimal):

1. **RPP Harus Detail**: Pastikan RPP Anda berisi komponen lengkap agar auto-detection bekerja optimal:
   - ✅ **Tujuan Pembelajaran (Kegiatan Inti)** - Semakin banyak objectives, semakin banyak aktivitas
   - ✅ **Langkah-langkah Pembelajaran Terstruktur** - Phase/tahapan pembelajaran yang jelas
   - ✅ **Metode/Model Pembelajaran** - Spesifik seperti Discovery Learning, PBL, dll
   - ✅ **Alokasi Waktu Detail** - Untuk setiap fase pembelajaran
   - ✅ **Alat dan Bahan** - Jika ada praktikum/eksperimen
   - ✅ **Indikator Capaian** - Learning objectives yang terukur

2. **Format RPP**: Gunakan format RPP standar:
   - Dokumen Word (.docx) - **recommended** untuk extraction yang lebih baik
   - PDF (.pdf) - juga support
   - Hindari gambar berlebihan atau scan buram (affects text extraction)

3. **Jumlah Aktivitas Otomatis**: Sistem akan auto-detect berdasarkan:
   - **Kegiatan Inti**: Setiap fase/tahapan = 1 aktivitas (±1)
   - **Learning Objectives**: Semakin banyak CP = lebih banyak aktivitas
   - **Alokasi Waktu**: Lebih panjang = lebih banyak aktivitas (maksimal 8)
   - **Metode Pembelajaran**: Discovery/PBL = lebih banyak, Ceramah = lebih sedikit
   
   **Range Otomatis: 3-8 aktivitas** (sistem memilih otomatis)
   - 2-3 jam: 5-6 aktivitas
   - 3+ jam: 7-10 aktivitas

4. **Topik Field**: Isi jika ingin specificitas tambahan
   - Contoh: "Luas Lingkaran dengan metode apresiasi"
   - Jika kosong, system ekstrak dari RPP

5. **Metode Pembelajaran**: RPP dengan metode SaintifiK, Discovery, PBL akan generate LKPD lebih baik

### ⚠️ Hindari Kesalahan Umum:

- ❌ Upload file RPP yang tidak jelas (scan buram, tulisan kecil)
- ❌ RPP terlalu singkat atau tidak lengkap
- ❌ Jumlah aktivitas terlalu banyak (>10) = error
- ❌ Alokasi waktu tidak realistis dengan jumlah aktivitas
- ❌ Upload file selain .doc, .docx, .pdf

---

## 6. Struktur LKPD Otomatis yang Dihasilkan

LKPD otomatis akan otomatis memiliki komponen berikut:

```html
📄 LEMBAR KERJA PESERTA DIDIK (LKPD) OTOMATIS

├─ 🔷 IDENTITAS
│  ├─ Nama Peserta Didik: _________________
│  ├─ Kelas: _______ Nomor Absen: ________
│  └─ Tanggal: ___________________________
│
├─ 🎯 TUJUAN PEMBELAJARAN
│  └─ [Diekstrak dari RPP dan disesuaikan bahasa siswa]
│
├─ 🧪 ALAT DAN BAHAN (jika ada dalam RPP)
│  └─ [Diekstrak otomatis]
│
├─ 📝 AKTIVITAS/PERCOBAAN/DISKUSI (1-10 buah)
│  ├─ Aktivitas 1: [Sesuai langkah pembelajaran RPP]
│  │  ├─ Pertanyaan Pemandu
│  │  ├─ Ruang Pengerjaan
│  │  └─ Observasi / Pencatatan
│  │
│  ├─ Aktivitas 2: ...
│  └─ Aktivitas N: ...
│
├─ ❓ PERTANYAAN PEMANDU
│  └─ [Mendorong pemahaman sesuai indikator capaian]
│
├─ 📌 RUANG PENGERJAAN
│  └─ Area untuk siswa menulis jawaban/analisis
│
└─ 🤔 KESIMPULAN & REFLEKSI
   ├─ Kesimpulan: Apa yang telah Anda pelajari?
   └─ Refleksi: Apakah Anda sudah memahami?
```

---

## 7. Troubleshooting

### ❓ Masalah: "File RPP wajib diunggah"
**Penyebab**: Belum upload file RPP  
**Solusi**: 
1. Pastikan format LKPD masih "⚡ LKPD Otomatis (Upload RPP)"
2. Biarkan file terupload dengan ✅ hijau
3. Klik Generate lagi

### ❓ Masalah: "Format RPP tidak support" / Error parsing
**Penyebab**: File RPP corrupt atau format salah  
**Solusi**:
1. Pastikan file adalah .doc, .docx, atau .pdf
2. Coba buka file RPP di Word, pastikan tidak corrupt
3. Simpan ulang file RPP
4. Upload ulang

### ❓ Masalah: "Mata Pelajaran atau Fase tidak valid"
**Penyebab**: Field wajib belum diisi  
**Solusi**:
1. Pastikan "Mata Pelajaran" sudah dipilih
2. Pastikan "Fase" sudah dipilih
3. Pastikan "Semester" sudah dipilih

### ❓ Masalah: Generate lama / Timeout
**Penyebab**: File RPP terlalu besar atau koneksi lambat  
**Solusi**:
1. Tunggu 1-2 menit lebih lama
2. Pastikan koneksi internet stabil
3. Coba dengan file RPP yang lebih kecil
4. Refresh halaman dan coba lagi

### ❓ Masalah: LKPD yang dihasilkan tidak sesuai RPP
**Penyebab**: RPP tidak lengkap atau terlalu ringkas  
**Solusi**:
1. Pastikan RPP memiliki tujuan pembelajaran yang jelas
2. Pastikan RPP memiliki langkah-langkah pembelajaran detail
3. Tambahkan deskripsi lebih detail di setiap bagian RPP
4. Upload RPP yang lebih komprehensif

---

## 8. Perbandingan: LKPD Manual vs LKPD Otomatis

| Aspek | LKPD Manual | LKPD Otomatis |
|-------|------------|---------------|
| **Input** | Topik + Materi (manual upload) | File RPP |
| **Waktu Pembuatan** | 1-2 menit | 30-60 detik |
| **Alignment RPP** | Manual check | Otomatis sesuai |
| **Jumlah Aktivitas** | Flexible | 1-10 aktivitas |
| **Ideal untuk** | Materi umum | Persiapan lengkap dengan RPP |
| **Format** | 5 pilihan format | Auto + RPP-aligned |

---

## 9. FAQ

**Q: Apakah LKPD Otomatis bisa untuk semua mata pelajaran?**  
A: Ya, untuk semua mata pelajaran yang ada di kurikulum.

**Q: Berapa ukuran file RPP maksimal?**  
A: Max 50MB (praktis <10MB)

**Q: Bisa generate LKPD tanpa upload RPP?**  
A: Tidak, RPP adalah syarat wajib untuk LKPD Otomatis.

**Q: Hasil LKPD bisa diedit setelah generate?**  
A: Ya, download sebagai HTML, edit dengan text editor atau Word.

**Q: Berapa lama proses generate?**  
A: Biasanya 30-90 detik tergantung ukuran RPP dan kecepatan koneksi.

**Q: Apakah LKPD Otomatis memerlukan internet?**  
A: Ya, memerlukan koneksi internet untuk AI processing.

---

## 10. Support & Feedback

Jika ada masalah atau masukan untuk fitur LKPD Otomatis:
1. Cek documentation ini terlebih dahulu
2. Hubungi admin/developer
3. Sertakan screenshot error atau deskripsi masalah

---

**Versi**: 1.0  
**Last Updated**: 2024  
**Status**: Active ✅
