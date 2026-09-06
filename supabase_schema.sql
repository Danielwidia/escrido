-- Jalankan SQL ini di Supabase Dashboard > SQL Editor
-- https://app.supabase.com/project/aqjdvehjaterwdnyqwoj/sql/new

-- 1. Buat tabel untuk database utama
CREATE TABLE IF NOT EXISTS cbt_database (
  id BIGINT PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Buat tabel untuk hasil ujian siswa
CREATE TABLE IF NOT EXISTS cbt_results (
  id BIGSERIAL PRIMARY KEY,
  student_id TEXT NOT NULL,
  mapel TEXT,
  rombel TEXT,
  date TEXT,
  score NUMERIC,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Buat tabel untuk Live Exams (real-time ujian)
CREATE TABLE IF NOT EXISTS cbt_live_exams (
  id BIGSERIAL PRIMARY KEY,
  student_id TEXT NOT NULL,
  mapel TEXT,
  rombel TEXT,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Buat tabel untuk Global API Keys
CREATE TABLE IF NOT EXISTS global_api_keys (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'exhausted')),
  note TEXT,
  vercel_env_var TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Buat tabel untuk Teacher API Keys
CREATE TABLE IF NOT EXISTS teacher_api_keys (
  id BIGSERIAL PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'exhausted')),
  note TEXT,
  vercel_env_var TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Buat tabel untuk Activity Logs
CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT,
  role TEXT,
  activity TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Buat tabel untuk Grades (Penilaian)
CREATE TABLE IF NOT EXISTS grades (
  id BIGSERIAL PRIMARY KEY,
  student_id TEXT NOT NULL,
  mapel TEXT,
  rombel TEXT,
  u1 NUMERIC DEFAULT 0,
  u2 NUMERIC DEFAULT 0,
  u3 NUMERIC DEFAULT 0,
  t1 NUMERIC DEFAULT 0,
  t2 NUMERIC DEFAULT 0,
  t3 NUMERIC DEFAULT 0,
  kelas NUMERIC DEFAULT 100,
  uas NUMERIC DEFAULT 0,
  nilai_akhir NUMERIC DEFAULT 0,
  data JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. PENTING: Disable RLS agar public key bisa baca/tulis
ALTER TABLE cbt_database DISABLE ROW LEVEL SECURITY;
ALTER TABLE cbt_results DISABLE ROW LEVEL SECURITY;
ALTER TABLE cbt_live_exams DISABLE ROW LEVEL SECURITY;
ALTER TABLE global_api_keys DISABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_api_keys DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE grades DISABLE ROW LEVEL SECURITY;

-- 9. Sisipkan data awal (hanya jika tabel masih kosong)
INSERT INTO cbt_database (id, data)
VALUES (1, '{
  "subjects": [
    {"name":"Pendidikan Agama","locked":false},
    {"name":"Bahasa Indonesia","locked":false},
    {"name":"Matematika","locked":false},
    {"name":"IPA","locked":false},
    {"name":"IPS","locked":false},
    {"name":"Bahasa Inggris","locked":false}
  ],
  "rombels": ["VII","VIII","IX"],
  "questions": [],
  "students": [{"id":"ADM","password":"admin321","name":"Administrator","role":"admin"}],
  "results": [],
  "schedules": [],
  "timeLimits": {},
  "schoolSettings": {}
}'::jsonb)
ON CONFLICT (id) DO NOTHING;
