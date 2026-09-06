/**
 * run-build.js — Orchestrator Build CBT Dorkas (MySQL Version)
 * Menghindari file lock dengan mengeksekusi tahapan dalam proses terpisah.
 */
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const GREEN = '\x1b[32m';
const BLUE  = '\x1b[34m';
const YELLOW= '\x1b[33m';
const RED   = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
function log(c, m) { console.log(`${c}${m}${RESET}`); }

const ROOT = path.join(__dirname, '..');

// ════════════════════════════════════════════════════════════════════════
//  MAIN BUILD FLOW
// ════════════════════════════════════════════════════════════════════════
let buildOk = false;

try {
    // ── Step 1: Sync data & assets ──────────────────────────────────────
    log(BLUE, '\n[1/3] Menyiapkan data dan sinkronisasi (dist/APP)...');
    execSync('node scripts/build-app.js', { stdio: 'inherit', cwd: ROOT });

    // ── Step 2: Package ─────────────────────────────────────────────────
    log(BLUE, '\n[2/3] Mengkompilasi DR-CBT.exe...');
    log(YELLOW, '   (Proses ini memakan waktu beberapa menit)\n');
    execSync('npx @yao-pkg/pkg . --targets node20-win-x64 --output dist/DR-CBT.exe', {
        stdio: 'inherit',
        cwd: ROOT
    });
    log(GREEN, '   ✅ DR-CBT.exe berhasil dibuat!');

    // ── Step 3: Post-build (icon & metadata) ────────────────────────────
    log(BLUE, '\n[3/3] Menerapkan metadata dan icon executable...');
    execSync('node scripts/post-build.js', { stdio: 'inherit', cwd: ROOT });

    buildOk = true;

} catch (err) {
    log(RED, '\n❌ Proses build gagal: ' + err.message);
} finally {
    if (!buildOk) {
        process.exit(1);
    }
}

const DIST    = path.join(__dirname, '..', 'dist');
const exePath = path.join(DIST, 'DR-CBT.exe');
const exeSize = fs.existsSync(exePath) ? (fs.statSync(exePath).size / 1024 / 1024).toFixed(1) + ' MB' : '?';

log(BOLD, '\n════════════════════════════════════════');
log(GREEN, '  🎉 Build Selesai!');
log(BOLD, '════════════════════════════════════════');
console.log(`
  📦 Output:
     dist/DR-CBT.exe  (${exeSize})
     dist/APP/            (file konfigurasi & data statis)
        ├── .env            ← Konfigurasi Database (Supabase Cloud)
        └── images/         ← SEMUA gambar soal (Offline Cache)

  🚀 Cara pakai:
     1. Pastikan file '.env' di folder 'dist/APP/' berisi SUPABASE_URL & SUPABASE_KEY yang benar.
     2. Jalankan: dist\\DR-CBT.exe
${RESET}`);
