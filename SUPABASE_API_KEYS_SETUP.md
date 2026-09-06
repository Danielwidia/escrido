# Setup: Global API Keys di Supabase (Bukan database.json)

> **UPDATE TERBARU**: Global API Keys sekarang disimpan di **Supabase** untuk scalability, security, dan performance yang lebih baik! 🚀

## 📊 Perbandingan Storage

| Aspek | database.json | Supabase |
|-------|---------------|---------|
| **Lokasi** | Local server | Cloud (Supabase) |
| **Backup Otomatis** | Perlu manual | ✅ Supabase handle |
| **Skalabilitas** | Terbatas | ✅ Unlimited |
| **Performa Query** | Lambat untuk banyak keys | ✅ Database queries optimal |
| **Security** | Plain text | ✅ Encrypted columns |
| **Redundancy** | Tidak ada | ✅ Multi-region backup |
| **Production Ready** | ⚠️ Risky | ✅ **RECOMMENDED** |

---

## 🚀 Quick Setup (3 Langkah)

### Step 1️⃣: Setup Supabase di Cloud

1. Buka https://supabase.com/dashboard
2. Buat project baru atau select existing
3. Catat URL dan API Key:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **Anon Key**: `eyJxxx...` (dari Settings → API)

### Step 2️⃣: Setup Database Schema

1. Di Supabase Dashboard, buka **SQL Editor**
2. Jalankan script dari [supabase_schema.sql](supabase_schema.sql):
   ```sql
   -- Ini akan create tables:
   -- - global_api_keys (NEW)
   -- - teacher_api_keys (NEW)
   -- Both sudah included di file
   ```
3. Pastikan tabel `global_api_keys` ter-create dengan kolom:
   - `id` (primary key)
   - `provider` (text)
   - `key` (unique text)
   - `status` (active/exhausted)
   - `note` (text)
   - `added_at`, `updated_at` (timestamps)

### Step 3️⃣: Setup Environment Variables

Buka `.env` di root project tambahkan:

```env
# Supabase Configuration
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJxxxxx...
```

**Dah itu!** Aplikasi otomatis akan pakai Supabase untuk API Keys. ✅

---

## 🔍 Verify Setup

Jalankan server dan check logs:

```bash
node server.js
```

**Expected logs:**
```
✅ Supabase mode: Connected to https://xxxxx.supabase.co
[API] Loaded 5 global API keys dari Supabase
```

---

## 📋 Cara Kerja

### Flow untuk Admin Add API Key:

```
1. Admin submit API Key dari dashboard
   ↓
2. Server cek Supabase
   ↓
3a. Jika Supabase OK:
   - Save ke tabel `global_api_keys` di Supabase
   - Done! ✅
   ↓
3b. Jika Supabase FAIL (error/config missing):
   - Fallback ke database.json
   - Simpan ke `globalSettings.apiKeys`
   - Done! ⚠️
   ↓
4. Optional: Push ke Vercel (jika VERCEL_TOKEN ada)
```

### Flow untuk GET API Keys:

```
1. Frontend call /api/admin/global-api-keys
   ↓
2. Server check Supabase (prioritas)
   ↓
3a. Jika ada data di Supabase:
   - Return Supabase data (teken: isFromSupabase=true)
   - Done! ✅
   ↓
3b. Jika Supabase kosong/error:
   - Fallback ke database.json
   - Return database.json data (teken: isFromDB=true)
   - Done! ⚠️
   ↓
4. Combine dengan env keys (GOOGLE_API_KEY, dll)
```

---

## 🐛 Troubleshooting

### ❌ Error: "SUPABASE_URL atau SUPABASE_KEY tidak ditemukan"

**Penyebab**: .env tidak dikonfigurasi

**Solusi:**
```env
# .env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJxxxxx...
```

Restart server jalankan `node server.js` lagi.

---

### ❌ Error: "ERROR PGRST116: ... global_api_keys relation does not exist"

**Penyebab**: Table `global_api_keys` tidak di-create di Supabase

**Solusi:**
1. Buka Supabase Dashboard → SQL Editor
2. Copy semua SQL dari [supabase_schema.sql](supabase_schema.sql)
3. Jalankan di SQL Editor
4. Verify tables ada:
   - `cbt_database`
   - `cbt_results`
   - `global_api_keys` ← cek ada tidak
   - `teacher_api_keys` ← cek ada tidak

---

### ⚠️ Warning: "Failed to add to Supabase, falling back to database.json"

**Penyebab**: Supabase ada tapi ada error (koneksi, permission, dll)

**Solusi**:
1. Check koneksi Supabase (bisa ping?)
2. Verify permission - table harus `DISABLE ROW LEVEL SECURITY`
3. Check API Key punya akses (Settings → API → anon key)
4. Check logs di Supabase dashboard untuk details error

---

### 🔄 Fallback ke database.json OK?

**Ya!** Sistem dirancang dengan fallback:
- Jika Supabase gagal → auto-fallback ke database.json
- Data tetap tersimpan
- Production tetap jalan
- Just fix Supabase config kemudian

---

## 📝 Response Format

### Success (Supabase):
```json
{
  "ok": true,
  "message": "Global API Key berhasil ditambahkan",
  "storage": "Supabase",
  "vercelStatus": "Auto-pushed sebagai GLOBAL_GOOGLE_GEMINI_APIKEY_xxx"
}
```

### Success (Fallback database.json):
```json
{
  "ok": true,
  "message": "Global API Key berhasil ditambahkan",
  "storage": "database.json",
  "vercelStatus": "Vercel tidak dikonfigurasi"
}
```

---

## 🔐 Security Best Practice

### ✅ DO:
- ✅ Use Supabase ANON key (read/write) daripada SERVICE key
- ✅ Disable RLS untuk API keys (public resource)
- ✅ Store actual API key di kolom (Supabase encrypts by default)
- ✅ Audit logs jika perlu (enable Supabase audit trail)

### ❌ DON'T:
- ❌ Commit `.env` ke GitHub
- ❌ Share Supabase URL/KEY via chat
- ❌ Use SERVICE key untuk anon access (overkill)
- ❌ Enable RLS tanpa proper policies (API akan jadi inaccessible)

---

## 🚚 Migration: database.json → Supabase

Jika sudah punya API Keys di database.json, migrate ke Supabase:

### Manual Migration (Copy-Paste):

```bash
# 1. Export dari database.json
cat database.json | jq '.globalSettings.apiKeys'

# Copy output, format menjadi SQL INSERT:
INSERT INTO global_api_keys (provider, key, status, note, added_at, updated_at)
VALUES
  ('Google Gemini', 'AIzaSy...', 'active', 'Note', now(), now()),
  ('OpenAI', 'sk_live_...', 'exhausted', 'Note', now(), now());

# 2. Jalankan di Supabase SQL Editor
# 3. Verify data
SELECT * FROM global_api_keys;
```

### Auto Migration Script (TODO):

Kita bisa buat script untuk auto-migrate jika perlu. Just ask! 

---

## 🎯 Next Steps

- [x] Setup Supabase
- [x] Create database schema
- [x] Configure SUPABASE_URL & SUPABASE_KEY
- [x] Restart server
- [ ] Add first API Key melalui admin dashboard
- [ ] Verify di Supabase dashboard (tabel `global_api_keys` ada data)
- [ ] Test AI generation dengan global API key

---

## 📚 Reference

| File | Purpose |
|------|---------|
| [supabase_schema.sql](supabase_schema.sql) | Database schema definition |
| [server.js](server.js#L2530) | API endpoints & Supabase functions |
| [GLOBAL_API_KEY_SYNC.md](GLOBAL_API_KEY_SYNC.md) | Vercel sync documentation |

---

**Questions?** Check server logs untuk debug info. Prefix `[Supabase]` untuk error tracking.

