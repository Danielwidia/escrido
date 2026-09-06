# ⚡ QUICK SETUP: Supabase untuk API Keys

> Selesai dalam 5 menit! 🚀

## 📋 Checklist

- [ ] Buat project di Supabase
- [ ] Copy Project URL dan API Key
- [ ] Update `.env` file
- [ ] Jalankan SQL schema
- [ ] Restart server
- [ ] Test add API Key

## 3️⃣ Langkah Setup

### 1. Buka Supabase

Https://supabase.com/dashboard

Create new project atau select existing.

### 2. Copy Credentials

Di **Settings → API**:
- **Project URL**: `https://xxxxx.supabase.co`
- **Anon Key**: `eyJxxx...`

### 3. Update `.env`

```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJxxxxx...
```

### 4. Setup Database

Di Supabase **SQL Editor**, copy-paste dari [supabase_schema.sql](supabase_schema.sql) dan jalankan.

Tables yang ter-create:
```
✅ cbt_database
✅ cbt_results
✅ global_api_keys <-- API Keys disini
✅ teacher_api_keys
```

### 5. Restart Server

```bash
node server.js
```

Check logs:
```
✅ Supabase mode: Connected to https://xxxxx.supabase.co
```

✅ **SELESAI!**

---

## 🧪 Test

1. Admin dashboard → API Keys Global
2. Input API Key
3. Klik TAMBAH
4. Lihat response: `"storage": "Supabase"` ✅

---

**Masalah?** Cek [SUPABASE_API_KEYS_SETUP.md](SUPABASE_API_KEYS_SETUP.md) untuk troubleshooting.
