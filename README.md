# DR CBT - Online

Ringkasan singkat: aplikasi CBT (Computer Based Test) berbasis Node/JS + static frontend. Project ini menampung file HTML, JS, dan SQLite/db utilities.

Instalasi lokal
- Pastikan Node.js terpasang.
- Install deps (jika ada):

```powershell
npm install
```

Menjalankan (pengembangan)

```powershell
node server.js
# atau jika ada perintah di package.json: npm run dev
```

GitHub
- Buat repository baru di GitHub, lalu push:

```powershell
git remote add origin git@github.com:USERNAME/REPO.git
git branch -M main
git push -u origin main
```

Deploy ke Vercel
- Via web: Import project dari GitHub di https://vercel.com
- Via CLI:

```powershell
npm i -g vercel
vercel login
vercel --prod
```

Catatan environment
- Jika menggunakan Supabase atau API keys, tambahkan ke Vercel Environment Variables sebelum deploy.

Kontak
- Jika butuh bantuan deploy, beri tahu saya langkah mana yang mau saya jalankan.
