# Panduan Integrasi MySQL Portable

Untuk mengintegrasikan MySQL Portable agar otomatis berjalan saat aplikasi dijalankan, ikuti langkah-langkah berikut:

## 1. Persiapkan Folder MySQL
1. Unduh **MySQL Community Server (ZIP Archive)** untuk Windows dari situs resmi MySQL.
2. Ekstrak isi file ZIP tersebut ke dalam folder bernama `mysql` di direktori utama proyek Anda.
3. Pastikan strukturnya seperti ini:
   ```
   CBT Offline - Baru/
   ├── mysql/
   │   ├── bin/
   │   │   ├── mysqld.exe  <-- Ini file utamanya
   │   │   └── mysql.exe
   │   ├── data/           <-- Akan dibuat otomatis jika belum ada
   │   └── ...
   ├── server.js
   ├── mysql-manager.js    <-- Sudah saya buatkan
   └── ...
   ```

## 2. Cara Kerja Otomatisasi
Saya telah menambahkan file `mysql-manager.js` dan memodifikasi `server.js` Anda:
- Saat aplikasi dimulai, `server.js` akan memanggil `mysqlMgr.start()`.
- Jika folder `mysql/data` belum ada, aplikasi akan menjalankan perintah inisialisasi (`--initialize-insecure`).
- Aplikasi akan menjalankan `mysqld.exe` secara background.
- Aplikasi akan menunggu sampai port `3306` siap sebelum akhirnya menjalankan server Express.

## 3. Keuntungan
- **Tanpa Instalasi**: User tidak perlu menginstal MySQL di komputer mereka.
- **Portabilitas Tinggi**: Seluruh database tersimpan di dalam folder `mysql/data` di folder aplikasi.
- **Sekali Klik**: Cukup jalankan aplikasi (`npm run dev` atau file `.exe` hasil build), MySQL akan ikut berjalan otomatis.

## 4. Tips Tambahan
Jika Anda menggunakan **XAMPP Portable**, Anda cukup menyalin isi folder `mysql` dari XAMPP ke dalam folder proyek Anda dengan nama yang sama.

---
**Catatan**: Jika MySQL sudah terinstal di komputer dan berjalan di port 3306, aplikasi secara otomatis akan mendeteksi port yang sibuk dan menggunakan MySQL yang sudah jalan tersebut daripada mencoba menjalankan versi portable-nya lagi.
