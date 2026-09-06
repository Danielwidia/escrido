/**
 * Build Script - CBT Dorkas (Supabase Cloud Version)
 * Membuat dist/DR-CBT.exe dan menyalin semua file statis ke dist/APP/
 * Jalankan: node scripts/build-app.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const APP_DIR = path.join(DIST, 'APP');
const LOCAL_IMAGES_DIR = path.join(ROOT, 'images');

// Warna console
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function log(color, msg) { console.log(`${color}${msg}${RESET}`); }

async function downloadImage(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

async function runBuild() {
    // ─── Langkah 1: Buat folder dist dan dist/APP ─────────────────────────────────
    log(BLUE, '\n📁 Menyiapkan folder dist/APP...');
    if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
    if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });

    const DIST_IMAGES_DIR = path.join(APP_DIR, 'images');
    if (!fs.existsSync(DIST_IMAGES_DIR)) fs.mkdirSync(DIST_IMAGES_DIR, { recursive: true });
    if (!fs.existsSync(LOCAL_IMAGES_DIR)) fs.mkdirSync(LOCAL_IMAGES_DIR, { recursive: true });
    
    log(GREEN, '   ✅ Folder dist/APP/ siap');
    log(GREEN, '   ✅ Folder dist/APP/images/ siap');

    // ─── Langkah 2: Copy file statis ke dist/APP ─────────────────────────────────
    log(BLUE, '\n📋 Menyalin file statis ke dist/APP/...');

    const STATIC_FILES = [
        'index.html',
        'admin.html',
        'guru.html',
        'siswa.html',
        'quizz.html',
        'administrasi_guru.html',
        'app.js',
        'wordParser.js',
        'style.css',
        'logo.png',
        'db.js',
        '.env',
    ];

    let copiedCount = 0;
    let skippedCount = 0;

    for (const file of STATIC_FILES) {
        const src = path.join(ROOT, file);
        const dest = path.join(APP_DIR, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            log(GREEN, `   ✅ ${file}`);
            copiedCount++;
        } else {
            log(YELLOW, `   ⚠️  ${file} tidak ditemukan, dilewati`);
            skippedCount++;
        }
    }

    log(GREEN, `\n   Disalin: ${copiedCount} file | Dilewati: ${skippedCount} file`);

    // ─── Langkah 3: Sinkronisasi Data & Gambar dari Supabase ──────────────────────
    log(BLUE, '\n🔄 Menyinkronkan data dan melokalisasi gambar dari Supabase...');

    let db = { questions: [] };

    // Check for Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (supabaseUrl && supabaseKey) {
        log(YELLOW, '   ℹ️  Supabase terdeteksi, mengunduh database...');
        try {
            const supabaseClient = createClient(supabaseUrl, supabaseKey);
            const { data, error } = await supabaseClient
                .from('cbt_database')
                .select('data')
                .eq('id', 1)
                .single();
            
            if (error) throw error;
            if (data && data.data) {
                db = data.data;
                log(GREEN, '   ✅ Data dari Supabase berhasil disinkronkan');
            }
        } catch (e) {
            log(RED, '   ⚠️  Gagal sinkronisasi Supabase: ' + e.message);
        }
    } else {
        log(YELLOW, '   ⚠️  SUPABASE_URL atau SUPABASE_KEY tidak ditemukan di environment.');
    }

    // Process Images
    log(BLUE, '   🖼️  Memproses gambar soal...');
    let imgCount = 0;
    let downloadCount = 0;

    if (db.questions && Array.isArray(db.questions)) {
        for (const q of db.questions) {
            if (q.images && Array.isArray(q.images)) {
                for (let i = 0; i < q.images.length; i++) {
                    const imgUrl = q.images[i];
                    if (imgUrl && imgUrl.startsWith('http')) {
                        const fileName = path.basename(imgUrl.split('?')[0]);
                        const dest = path.join(LOCAL_IMAGES_DIR, fileName);
                        
                        if (!fs.existsSync(dest)) {
                            try {
                                await downloadImage(imgUrl, dest);
                                downloadCount++;
                            } catch (e) {
                                log(RED, `      ❌ Gagal download: ${imgUrl} -> ${e.message}`);
                            }
                        }
                        imgCount++;
                    } else if (imgUrl && imgUrl.startsWith('/images/')) {
                        imgCount++;
                    }
                }
            }
        }
    }

    log(GREEN, `   ✅ ${imgCount} referensi gambar dilokalisasi (${downloadCount} baru diunduh)`);

    // Copy ALL images from local images/ to dist/APP/images
    log(BLUE, '\n📁 Menyalin semua gambar ke dist/APP/images...');
    if (fs.existsSync(LOCAL_IMAGES_DIR)) {
        const images = fs.readdirSync(LOCAL_IMAGES_DIR);
        let imageCopiedCount = 0;
        for (const img of images) {
            const src = path.join(LOCAL_IMAGES_DIR, img);
            const dest = path.join(DIST_IMAGES_DIR, img);
            if (fs.statSync(src).isFile()) {
                fs.copyFileSync(src, dest);
                imageCopiedCount++;
            }
        }
        log(GREEN, `   ✅ ${imageCopiedCount} gambar disalin ke dist/APP/images/`);
    }

    const resultsPath = path.join(APP_DIR, 'results.json');
    if (!fs.existsSync(resultsPath)) {
        fs.writeFileSync(resultsPath, '[]', 'utf8');
    }

    log(GREEN, '   ✅ Proses sinkronisasi data dan aset selesai.');
    log(GREEN, '\n✨ Step 1 (build-app) Berhasil!');
    setTimeout(() => process.exit(0), 500);
}

runBuild().catch(err => {
    log(RED, '\n❌ Terjadi kesalahan sinkronisasi: ' + err.message);
    console.error(err);
    process.exit(1);
});
