// Load .env awal dari direktori saat ini
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { parseWordDocument } = require('./wordParser');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const pdf = require('pdf-parse');
const sqlDb = require('./db'); // ← Supabase database module

const app = express();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 } // High limit for standalone build
});
app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

const isPkg = typeof process.pkg !== 'undefined';
const baseDir = isPkg ? path.dirname(process.execPath) : __dirname;
const rootPath = isPkg ? path.join(baseDir, 'APP') : (process.env.VERCEL ? process.cwd() : __dirname);

// Saat berjalan sebagai .exe, re-load .env dari folder APP agar bisa diedit tanpa rebuild
if (isPkg) {
    const envPath = path.join(rootPath, '.env');
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath, override: true });
        console.log(`✅ .env dimuat dari: ${envPath}`);
    } else {
        console.warn(`⚠️  File .env tidak ditemukan di: ${envPath}`);
    }
}

// ─── Logging & Static Middleware ──────────────────────────────────────────────
app.use((req, res, next) => {
    if (!req.url.startsWith('/api') && req.url !== '/' && !req.url.includes('.')) {
        console.log(`[ROUTE] ${req.method} ${req.url}`);
    }
    next();
});

// Explicitly serve /images folder
const imagesPath = path.join(rootPath, 'images');
console.log(`[INIT] Serving /images from: ${imagesPath}`);
app.use('/images', express.static(imagesPath));

// Fallback for AI images that might be in dist/APP/images
const fallbackImagesPath = path.join(baseDir, 'dist', 'APP', 'images');
if (fs.existsSync(fallbackImagesPath) && fallbackImagesPath !== imagesPath) {
    console.log(`[INIT] Serving /images fallback from: ${fallbackImagesPath}`);
    app.use('/images', express.static(fallbackImagesPath));
}

// Serve other static files from APP folder (external in .exe, local in dev)
app.use(express.static(rootPath));

// ─── Environment ──────────────────────────────────────────────────────────────
// Mode: Supabase sebagai satu-satunya database (cloud).
const USE_SUPABASE = true;

// Inisialisasi Supabase client global
let supabase = null;
try {
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
    if (sbUrl && sbKey) {
        supabase = createClient(sbUrl, sbKey);
        console.log('✅ Supabase client initialized');
    } else {
        console.warn('⚠️  SUPABASE_URL atau SUPABASE_KEY belum dikonfigurasi!');
    }
} catch (e) {
    console.error('❌ Gagal inisialisasi Supabase:', e.message);
}

console.log(`💾 Database Mode : Supabase (cloud)`);
console.log(`   URL: ${process.env.SUPABASE_URL || 'tidak dikonfigurasi'}`);

// Jika database Supabase masih kosong atau belum berisi data awal
async function autoMigrateIfNeeded() {
    console.log('[INIT] autoMigrateIfNeeded start');
    try {
        const RESCUE_FILE = path.join(rootPath, 'cbt_data_rescued.json');
        const LOCAL_DATA = path.join(rootPath, 'database.json');
        const LOCAL_RESULTS = path.join(rootPath, 'results.json');

        console.log('[INIT] Checking migration status via Supabase...');
        let hasMigrated = false;
        try {
            hasMigrated = await sqlDb.getConfig('migrated_from_sqlite');
        } catch (e) {
            console.warn('[INIT] Could not check config table (might be first run):', e.message);
        }

        if (hasMigrated === true) {
            console.log('[INIT] Database already migrated previously. Skipping auto-migration.');
            return;
        }
        console.log('[INIT] Migration flag is not set.');

        console.log('[INIT] Checking existing students via Supabase...');
        let existing = [];
        try {
            existing = await sqlDb.getAllStudents();
            console.log('[INIT] Existing student count:', existing.length);
        } catch (e) {
            console.error('⚠️  Database connection or schema error during startup!', e.message);
            return;
        }

        if (existing.length === 0) {
            console.log('[INIT] Database tables are empty. Checking source files for migration...');
            // ── Cek 1: File rescue JSON ──────────────────────────────────────
            if (fs.existsSync(RESCUE_FILE)) {
                console.log('📦 Menemukan file RESCUE JSON, memulihkan dari ' + RESCUE_FILE + '...');
                const rescue = JSON.parse(fs.readFileSync(RESCUE_FILE, 'utf8'));
                await sqlDb.writeDB(rescue);
                await sqlDb.setConfig('migrated_from_sqlite', true);
                console.log('✅ Pemulihan dari RESCUE JSON selesai.');
                return;
            }

            // ── Cek 2: Fallback ke JSON lama ─────────────────────────────────
            if (fs.existsSync(LOCAL_DATA)) {
                console.log('📦 Database Supabase kosong, menjalankan auto-migrasi dari JSON (fallback terakhir)...');
                const mainDb = JSON.parse(fs.readFileSync(LOCAL_DATA, 'utf8'));
                await sqlDb.writeDB(mainDb);
                if (fs.existsSync(LOCAL_RESULTS)) {
                    const results = JSON.parse(fs.readFileSync(LOCAL_RESULTS, 'utf8'));
                    if (Array.isArray(results) && results.length > 0) {
                        await sqlDb.setAllResults(results);
                        console.log(`   📊 Migrated ${results.length} results dari results.json`);
                    }
                }
                await sqlDb.setConfig('migrated_from_sqlite', true);
                console.log('✅ Auto-migrasi dari JSON selesai.');
            }
        }
    } catch (e) {
        console.error('⚠️  Auto-migrasi gagal:', e.message);
    }
}



// ─── Default DB ───────────────────────────────────────────────────────────────
const DEFAULT_DB = {
    subjects: [
        { name: 'Pendidikan Agama', locked: false },
        { name: 'Bahasa Indonesia', locked: false },
        { name: 'Matematika', locked: false },
        { name: 'IPA', locked: false },
        { name: 'IPS', locked: false },
        { name: 'Bahasa Inggris', locked: false }
    ],
    rombels: ['Fase D (Kelas 7)', 'Fase D (Kelas 8)', 'Fase D (Kelas 9)'],
    questions: [],
    students: [{ id: 'ADM', password: 'admin321', name: 'Administrator', role: 'admin' }],
    results: [],
    schedules: [],
    timeLimits: {},
    quizzes: []
};

// ─── Real-time State Manager untuk API Keys ────────────────────────────────────
const realtimeState = {
    lastUpdated: {}, // { teacherId: timestamp }
    apiKeyChanges: {}, // { teacherId: { count, status, timestamp } }
    globalKeyChanges: { timestamp: null, count: 0, status: {} }
};

function updateRealtimeState(type, teacherId = null) {
    const now = new Date().toISOString();
    if (type === 'teacher-key' && teacherId) {
        realtimeState.lastUpdated[teacherId] = now;
        if (!realtimeState.apiKeyChanges[teacherId]) {
            realtimeState.apiKeyChanges[teacherId] = { count: 0, status: {}, timestamp: now };
        }
        realtimeState.apiKeyChanges[teacherId].timestamp = now;
    } else if (type === 'global-key') {
        realtimeState.globalKeyChanges.timestamp = now;
    }
}

// ─── Merge helpers ────────────────────────────────────────────────────────────
function mergeResults(existing = [], incoming = []) {
    const map = new Map();
    const key = r => `${r.studentId || ''}::${r.mapel || ''}::${r.rombel || ''}::${r.date || ''}`;
    existing.forEach(r => map.set(key(r), r));
    incoming.forEach(r => {
        const k = key(r);
        map.set(k, map.has(k) ? Object.assign({}, map.get(k), r) : r);
    });
    return Array.from(map.values());
}

// ─── Document Parsing Helpers ────────────────────────────────────────────────
async function parseBlueprint(fileBuffer, originalName) {
    const ext = path.extname(originalName).toLowerCase();
    let text = "";

    try {
        if (ext === '.docx') {
            const result = await mammoth.extractRawText({ buffer: fileBuffer });
            text = result.value;
        } else if (ext === '.doc') {
            // .doc (legacy Word) — fallback: baca sebagai plaintext, strip binary chars
            text = fileBuffer.toString('utf8').replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, ' ').replace(/\s+/g, ' ');
        } else if (ext === '.xlsx' || ext === '.xls') {
            const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                text += `Sheet: ${sheetName}\n` + xlsx.utils.sheet_to_txt(sheet) + "\n";
            });
        } else if (ext === '.pdf') {
            const data = await pdf(fileBuffer);
            text = data.text;
        } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
            // Gambar: kirim ke Gemini Vision untuk ekstraksi teks (OCR)
            const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
            const base64Image = fileBuffer.toString('base64');
            text = await extractTextFromImage(base64Image, mimeType);
        } else {
            text = fileBuffer.toString('utf8');
        }
        return text.trim();
    } catch (err) {
        console.error(`Error parsing blueprint (${ext}):`, err.message);
        return "";
    }
}

/**
 * Kirim gambar ke Gemini Vision untuk OCR / ekstraksi teks kisi-kisi
 */
async function extractTextFromImage(base64Data, mimeType) {
    const rawKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
    const keys = rawKey.split(',').map(k => k.trim()).filter(k => k);
    if (keys.length === 0) {
        console.warn('[OCR] No Gemini key configured, skipping image OCR.');
        return "[Gambar diunggah, tapi API Key Gemini belum dikonfigurasi untuk membaca isinya]";
    }

    const models = ['gemini-3.5-pro', 'gemini-3.5-flash', 'gemini-3.1-flash', 'gemini-3.1-flash-lite', 'gemini-3.0-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    const prompt = "Ini adalah foto atau scan dokumen kisi-kisi / soal ujian. Tolong baca dan ekstrak SELURUH teks yang terlihat dalam gambar ini secara akurat. Jika ada tabel, pertahankan strukturnya. Jangan tambahkan komentar, langsung tulis teks yang ada di gambar saja.";

    for (const model of models) {
        for (const key of keys) {
            console.log(`[OCR] Attempting extraction with model: ${model}`);
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${key}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: prompt },
                                { inline_data: { mime_type: mimeType, data: base64Data } }
                            ]
                        }]
                    })
                });
                if (response.ok) {
                    const data = await response.json();
                    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    console.log(`[OCR] ✅ Image text extracted (${result.length} chars) via ${model}`);
                    return result;
                }
                const errData = await response.json().catch(() => ({}));
                console.warn(`[OCR] Model ${model} failed: ${response.status} - ${errData.error?.message || ''}`);
            } catch (e) {
                console.error(`[OCR] Fetch error with ${model}:`, e.message);
            }
        }
    }
    return "[Gagal mengekstrak teks dari gambar. Pastikan Gemini API Key sudah dikonfigurasi.]";
}

function normalizeQuestionType(type = '') {
    const t = String(type || '').toLowerCase().trim();
    if (['single', 'pilihan_ganda', 'pg', 'multiple_choice'].includes(t)) return 'single';
    if (['multiple', 'pg_kompleks', 'complex', 'checkbox'].includes(t)) return 'multiple';
    if (['text', 'uraian', 'isian', 'essay', 'short_answer'].includes(t)) return 'text';
    if (['tf', 'boolean', 'benar_salah', 'true_false', 'bs'].includes(t)) return 'tf';
    if (['matching', 'jodohkan', 'pasangkan', 'pairing', 'match'].includes(t)) return 'matching';
    return 'single';
}

/**
 * Robustly normalizes an AI-generated question into the standard format used by the bank soal.
 * This includes statement extraction for TF, answer key mapping, and property verification.
 */
function fullNormalizeQuestion(q, mapel, rombel) {
    if (q.type === 'tf' || (Array.isArray(q.options) && q.options.length <= 2)) {
        console.log(`[NORMALIZE] TF Input: text="${q.text?.substring(0, 50)}...", type=${q.type}, options=${JSON.stringify(q.options)}, correct=${JSON.stringify(q.correct)}`);
    }
    const normalized = { ...q };
    if (normalized.text !== undefined && normalized.text !== null && typeof normalized.text !== 'string') {
        normalized.text = Array.isArray(normalized.text) ? normalized.text.join('\n') : String(normalized.text);
    }

    // Ensure mapel and rombel are set
    if (!normalized.mapel) normalized.mapel = mapel;
    if (!normalized.rombel) normalized.rombel = rombel;

    // Normalize type string
    normalized.type = normalizeQuestionType(normalized.type || 'single');

    // HELPERS
    const cleanOptionText = opt => {
        if (!opt || typeof opt !== 'string') return opt;
        return opt.replace(/^(?:[A-D][\.\)\:\-\s]|[o\-\*]?\s*\[[\s_xX]?\])\s*/i, '').trim();
    };
    const isGenericOption = opt => {
        if (!opt || String(opt).trim() === '') return true;
        const clean = String(opt).replace(/[\[\]\-\(\)\.\–\—\_]/g, '').trim().toLowerCase();
        return /^(benar|salah|true|false|ya|tidak|ok|yes|no|pilihan|option)$/.test(clean);
    };

    const parseBooleanAnswer = (value, options = null) => {
        if (typeof value === 'boolean') return value;

        // If value is a numeric index, check the content of the option at that index
        if (typeof value === 'number' && Array.isArray(options) && options.length > value) {
            const optText = String(options[value]).toLowerCase();
            const isPositive = ['benar', 'true', 'ya', 'yes', 'b', 'betul', 'ok', 'right', 'correct'].some(t => optText.includes(t));
            const isNegative = ['salah', 'false', 'tidak', 'no', 's', 'wrong', 'incorrect'].some(t => optText.includes(t));
            if (isPositive && !isNegative) return true;
            if (isNegative && !isPositive) return false;
            // Fallback for number 1 as true if no clear text match
            if (value === 1) return true;
            if (value === 0) return false; // wait, this is ambiguous. Most systems use 0=false, 1=true.
        }

        if (typeof value === 'number') return value === 1;
        if (value === null || value === undefined) return false;

        const clean = value.toString().trim().toLowerCase().replace(/[\(\)\[\]\.]/g, '');
        if (['benar', 'true', 't', 'ya', 'yes', '1', 'correct', 'right', 'b', 'betul', 'ok'].includes(clean)) return true;
        if (['salah', 'false', 'f', 'tidak', 'no', '0', 'incorrect', 'wrong', 's'].includes(clean)) return false;
        return false;
    };

    // AUTO-DETECT TF: If it's single choice but options are just Benar/Salah
    if (normalized.type !== 'tf' && Array.isArray(normalized.options) && normalized.options.length > 0 && normalized.options.length <= 2) {
        if (normalized.options.every(isGenericOption)) {
            normalized.type = 'tf';
        }
    }

    // Normalize TF (True/False) questions
    if (normalized.type === 'tf') {
        const normalizeOptionList = raw => {
            if (Array.isArray(raw)) {
                return raw.flatMap(item => {
                    if (typeof item === 'string') return item.split(/\r?\n|;/).map(s => s.trim()).filter(Boolean);
                    if (typeof item === 'boolean') return [item ? "Benar" : "Salah"];
                    return [];
                }).map(s => s.trim()).filter(Boolean);
            }
            if (typeof raw === 'string') {
                return raw.split(/\r?\n|;/).map(s => s.trim()).filter(Boolean);
            }
            return [];
        };

        const parseStatementsFromText = (textStr) => {
            const statements = [];
            const corrects = [];
            const lines = textStr.split(/\r?\n/).map(l => l.trim()).filter(l => l);
            for (const line of lines) {
                // If the line is JUST a generic option like "Benar" or "[ ] Salah", ignore it as a statement
                if (isGenericOption(line)) continue;

                const match = line.match(/^(?:pernyataan\s*\d*\s*[:\-–]\s*|(?:\d+\.|\-|\*)?\s*)(.+?)\s*(?:[\-:–]\s*(Benar|Salah|True|False|T|F|Ya|Tidak|Yes|No|B|S|Betul)|\((Benar|Salah|True|False|T|F|Ya|Tidak|Yes|No|B|S|Betul)\))?\s*$/i);
                if (match) {
                    const stmt = match[1].trim();
                    const answerRaw = match[2] || match[3] || '';
                    if (stmt && !/^(benar atau salah|pilihlah|berikut ini|instruksi|tentukan)/i.test(stmt) && !isGenericOption(stmt)) {
                        statements.push(stmt);
                        corrects.push(answerRaw ? parseBooleanAnswer(answerRaw) : null);
                    }
                }
            }
            return { statements, corrects };
        };

        normalized.options = normalizeOptionList(normalized.options);

        if (normalized.options.length === 1 && /\r?\n/.test(normalized.options[0])) {
            normalized.options = normalized.options[0].split(/\r?\n|;/).map(s => s.trim()).filter(Boolean);
        }

        // Detect embedded answers in options
        if (normalized.options.length > 0) {
            const parsedOptions = [];
            const parsedCorrects = [];
            for (const opt of normalized.options) {
                const match = opt.match(/^(.+?)\s*(?:[\-:–]\s*|\()?(Benar|Salah|True|False|T|F|Ya|Tidak|Yes|No|Betul)\)?$/i);
                if (match) {
                    parsedOptions.push(match[1].trim());
                    parsedCorrects.push(parseBooleanAnswer(match[2] || match[3]));
                } else {
                    parsedOptions.push(opt);
                    // Preservation logic: use original correct if available
                    let fallback = false;
                    if (Array.isArray(normalized.correct) && normalized.correct.length > parsedOptions.length - 1) {
                        fallback = parseBooleanAnswer(normalized.correct[parsedOptions.length - 1], q.options);
                    } else if (!Array.isArray(normalized.correct) && normalized.correct !== undefined && normalized.correct !== null) {
                        if (parsedOptions.length === 1) fallback = parseBooleanAnswer(normalized.correct, q.options);
                    }
                    parsedCorrects.push(fallback);
                }
            }
            normalized.options = parsedOptions;

            // Only overwrite if we found actual embedded answers or if original is missing/invalid
            const foundEmbedded = parsedCorrects.some((_, idx) => {
                const originalOpt = Array.isArray(q.options) ? q.options[idx] : null;
                if (typeof originalOpt !== 'string') return false;
                return /(Benar|Salah|True|False|T|F|Ya|Tidak|Yes|No|Betul)\)?$/i.test(originalOpt);
            });

            if (foundEmbedded || !Array.isArray(normalized.correct) || normalized.correct.length !== parsedCorrects.length) {
                normalized.correct = parsedCorrects;
            }
        }

        // Clean up statements and remove generic ones
        if (Array.isArray(normalized.options)) {
            normalized.options = normalized.options
                .map(opt => typeof opt === 'string' ? opt.replace(/^(?:pernyataan\s*\d*\s*[:\-–]\s*|(?:\d+\.|\-|\*)\s+)/i, '').trim() : opt)
                .filter(opt => !isGenericOption(opt));
        }

        const defaultTfInstruction = 'Tentukan apakah pernyataan berikut Benar atau Salah:';
        const optionsAreEmptyOrGeneric = !normalized.options || normalized.options.length === 0 || normalized.options.every(isGenericOption);

        if (optionsAreEmptyOrGeneric && normalized.text && typeof normalized.text === 'string' && normalized.text.length > 5) {
            const { statements, corrects } = parseStatementsFromText(normalized.text);
            if (statements.length > 0) {
                normalized.options = statements;
                const finalCorrects = [];
                const originalHasArray = Array.isArray(normalized.correct);
                const originalValue = normalized.correct;
                for (let i = 0; i < statements.length; i++) {
                    if (corrects[i] !== null) finalCorrects.push(corrects[i]);
                    else if (originalHasArray && originalValue.length > i) finalCorrects.push(parseBooleanAnswer(originalValue[i], q.options));
                    else if (!originalHasArray && originalValue !== undefined && originalValue !== null) {
                        if (i === 0) finalCorrects.push(parseBooleanAnswer(originalValue, q.options));
                        else finalCorrects.push(false);
                    }
                    else finalCorrects.push(false);
                }
                normalized.correct = finalCorrects;
                normalized.text = defaultTfInstruction;
            } else if (typeof normalized.text === 'string' && normalized.text.length > 10) {
                // If it's a single long text that doesn't look like an instruction, it's the statement
                const cleanStmt = normalized.text.replace(/^pernyataan\s*[:\-–]\s*/i, '').replace(/^(\d+\.|\-|\*)\s*/, '').trim();
                const isInstruction = /^(benar atau salah|pilihlah|berikut ini|instruksi|tentukan|pilih satu)/i.test(cleanStmt);

                if (!isInstruction && cleanStmt.length > 5) {
                    normalized.options = [cleanStmt];
                    normalized.text = defaultTfInstruction;
                    const singleCorrect = Array.isArray(normalized.correct) ? normalized.correct[0] : normalized.correct;
                    normalized.correct = [parseBooleanAnswer(singleCorrect !== undefined ? singleCorrect : false, q.options)];
                }
            }
        }

        if (!normalized.text || (typeof normalized.text === 'string' && normalized.text.trim() === '') || isGenericOption(normalized.text)) {
            normalized.text = defaultTfInstruction;
        }

        if (!Array.isArray(normalized.correct)) {
            const scalarVal = (normalized.correct !== undefined && normalized.correct !== null) ? parseBooleanAnswer(normalized.correct) : false;
            normalized.correct = normalized.options.map((_, i) => i === 0 ? scalarVal : false);
        } else if (normalized.correct.length !== normalized.options.length) {
            const correctLength = normalized.correct.length;
            const optionsLength = normalized.options.length;
            if (optionsLength > 0) {
                if (correctLength < optionsLength) {
                    normalized.correct = [...normalized.correct, ...Array(optionsLength - correctLength).fill(false)];
                } else {
                    normalized.correct = normalized.correct.slice(0, optionsLength);
                }
            }
        }
        normalized.correct = normalized.correct.map(val => parseBooleanAnswer(val, q.options));
        console.log(`[NORMALIZE] TF Output: type=${normalized.type}, options=${JSON.stringify(normalized.options)}, correct=${JSON.stringify(normalized.correct)}`);
    }

    // Normalize Single and Multiple Choice to exactly 4 options
    if (normalized.type === 'multiple' || normalized.type === 'single') {
        if (!Array.isArray(normalized.options)) normalized.options = [];
        if (normalized.options.length !== 4) {
            if (normalized.options.length > 4) {
                normalized.options = normalized.options.slice(0, 4);
            } else {
                while (normalized.options.length < 4) normalized.options.push(`Pilihan ${String.fromCharCode(65 + normalized.options.length)}`);
            }
        }
        // Clean each option from markers like [ ] or [x]
        normalized.options = normalized.options.map(cleanOptionText);

        if (normalized.type === 'multiple') {
            if (!Array.isArray(normalized.correct)) normalized.correct = [normalized.correct];
            // Ensure indices are within 0-3 range
            normalized.correct = normalized.correct
                .map(c => typeof c === 'string' ? parseInt(c) : c)
                .filter(c => typeof c === 'number' && c >= 0 && c <= 3);

            if (normalized.correct.length < 2) {
                const available = [0, 1, 2, 3].filter(i => !normalized.correct.includes(i));
                while (normalized.correct.length < 2 && available.length > 0) {
                    normalized.correct.push(available.splice(Math.floor(Math.random() * available.length), 1)[0]);
                }
            } else if (normalized.correct.length > 3) {
                normalized.correct = normalized.correct.slice(0, 3);
            }
        } else if (normalized.type === 'single') {
            let correctIndex = parseInt(normalized.correct);
            if (isNaN(correctIndex) || correctIndex < 0 || correctIndex > 3) correctIndex = 0;
            normalized.correct = correctIndex;
        }
    }

    // Normalize Matching
    if (normalized.type === 'matching') {
        const normalizeMatchingItem = raw => {
            if (raw === undefined || raw === null) return '';
            let text = String(raw).trim();
            const labelMatch = text.match(/^(?:[A-Ea-e]|\d+)\s*[\.\)\-:]\s*(.+)$/);
            if (labelMatch) {
                text = labelMatch[1].trim();
            }
            return text;
        };

        const extractMatchingIndex = raw => {
            if (raw === undefined || raw === null) return null;
            const value = String(raw).trim();
            const letterOnly = value.match(/^[A-Ea-e]$/);
            if (letterOnly) return letterOnly[0].toUpperCase().charCodeAt(0) - 65;
            const numericOnly = value.match(/^\d+$/);
            if (numericOnly) return parseInt(numericOnly[0], 10) - 1;
            const pairMatch = value.match(/^(?:\d+)\s*[-:]\s*([A-Ea-e])$/) || value.match(/^[A-Ea-e]\s*[-:]\s*(\d+)$/);
            if (pairMatch) {
                const token = pairMatch[1];
                if (/^[A-Ea-e]$/.test(token)) return token.toUpperCase().charCodeAt(0) - 65;
                const num = parseInt(token, 10);
                return Number.isNaN(num) ? null : num - 1;
            }
            return null;
        };

        const normalizeMatchingArray = arr => Array.isArray(arr) ? arr.map(normalizeMatchingItem).filter(v => v !== '') : [];
        normalized.questions = normalizeMatchingArray(normalized.questions);
        normalized.answers = normalizeMatchingArray(normalized.answers);

        if (Array.isArray(normalized.correct)) {
            normalized.correct = normalized.correct.map(normalizeMatchingItem).filter(v => v !== '');
        } else if (typeof normalized.correct === 'string' && normalized.correct.trim()) {
            normalized.correct = [normalizeMatchingItem(normalized.correct)];
        } else {
            normalized.correct = Array.isArray(normalized.correct) ? normalized.correct : [];
        }

        if (normalized.answers.length > 0 && normalized.correct.length > 0) {
            const mappedCorrect = normalized.correct.map(item => {
                const index = extractMatchingIndex(item);
                if (index !== null && normalized.answers[index] !== undefined) {
                    return normalizeMatchingItem(normalized.answers[index]);
                }
                return normalizeMatchingItem(item);
            });
            const mappedHasUsefulChange = mappedCorrect.some((item, idx) => item && item !== normalizeMatchingItem(normalized.correct[idx]));
            if (mappedHasUsefulChange) normalized.correct = mappedCorrect;
        }

        if (normalized.answers.length === 0 && normalized.correct.length > 0) {
            normalized.answers = [...new Set(normalized.correct)];
        }

        if ((normalized.answers.length === 0 || normalized.answers.every(a => !a || a.trim() === '')) && Array.isArray(normalized.options) && normalized.options.length > 0) {
            normalized.options = normalized.options.filter(opt => !/^[A-Ea-e]?\s*[\.\s]*\d+[-\s]*[A-Ea-e](?:[,\s]+\d+[-\s]*[A-Ea-e])*$/i.test(String(opt).trim()));
        }

        const isSelectedPattern = str => /^[A-E]?[-\.\s]*\d+[-\s]*[A-E](?:[,\s]+\d+[-\s]*[A-E])*$/i.test(String(str).trim());

        // Filter out MCQ selection patterns from options if the type is matching
        if (Array.isArray(normalized.options)) {
            normalized.options = normalized.options.filter(opt => !isSelectedPattern(opt));
        }

        // If questions/answers are missing but options exist, try to parse from remaining options
        if ((!normalized.questions || normalized.questions.length === 0) && Array.isArray(normalized.options) && normalized.options.length > 0) {
            normalized.questions = [];
            normalized.answers = [];
            normalized.options.forEach(opt => {
                const parts = String(opt).split(/[|:=]/); // split by |, :, or =
                if (parts.length >= 2) {
                    normalized.questions.push(parts[0].trim());
                    normalized.answers.push(parts[1].trim());
                } else if (opt && opt.trim() !== '' && !isSelectedPattern(opt)) {
                    normalized.questions.push(opt.trim());
                    normalized.answers.push('');
                }
            });
        }

        // HEURISTIC: If questions/answers still empty (or answers all empty), try to extract from text
        const answersAllEmpty = normalized.answers.length > 0 && normalized.answers.every(a => !a || a.trim() === '');
        if ((!normalized.questions || normalized.questions.length === 0 || answersAllEmpty) && typeof normalized.text === 'string') {
            const cleanText = normalized.text.replace(/<br\s*\/?>/gi, '\n');
            const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const leftItems = [];
            const rightItems = [];
            let inLeft = false;
            let inRight = false;

            lines.forEach(line => {
                const lower = line.toLowerCase();
                // Broader detection for columns
                if (lower.includes('(kiri)') || lower.includes('kolom a') || lower.includes('bagian 1') || lower.includes('pernyataan') || lower.includes('soal')) {
                    inLeft = true; inRight = false; return;
                }
                if (lower.includes('(kanan)') || lower.includes('kolom b') || lower.includes('bagian 2') || lower.includes('jawaban') || lower.includes('kunci') || lower.includes('pilihan rima')) {
                    inLeft = false; inRight = true; return;
                }

                // Try to detect list items like "1. Pantun" or "- Syair"
                const itemMatch = line.match(/^(?:\d+[\.\)]|[A-Z][\.\)]|[\-\*])\s*(.+)$/);
                const content = itemMatch ? itemMatch[1].trim() : line;

                if (content && content.length > 1 && !isSelectedPattern(content) && !content.toLowerCase().startsWith('jodohkan')) {
                    if (inLeft) leftItems.push(content);
                    else if (inRight) rightItems.push(content);
                }
            });

            if (leftItems.length > 0) {
                normalized.questions = leftItems;
                normalized.answers = rightItems;
                // If answers still empty but we have many items in left, maybe they are all there?
                if (rightItems.length === 0 && leftItems.length >= 4) {
                    const mid = Math.ceil(leftItems.length / 2);
                    normalized.questions = leftItems.slice(0, mid);
                    normalized.answers = leftItems.slice(mid);
                }
            }
        }

        // Final fallback: if questions is long and answers is empty or all-empty, split it
        const hasNoRealAnswers = normalized.answers.length === 0 || normalized.answers.every(a => !a || a.trim() === '');
        if (normalized.questions.length >= 4 && hasNoRealAnswers) {
            const mid = Math.ceil(normalized.questions.length / 2);
            const pool = [...normalized.questions];
            normalized.questions = pool.slice(0, mid);
            normalized.answers = pool.slice(mid);
        }

        if (!Array.isArray(normalized.questions)) normalized.questions = [];
        if (!Array.isArray(normalized.answers)) normalized.answers = [];

        // Correct recovery
        if (!Array.isArray(normalized.correct) || normalized.correct.length === 0 || normalized.correct.every(c => !c)) {
            normalized.correct = (normalized.answers.length >= normalized.questions.length) ?
                normalized.answers.slice(0, normalized.questions.length) :
                [...(normalized.answers), ...Array(Math.max(0, normalized.questions.length - normalized.answers.length)).fill('')];
        }

        // If correct contains numbers (indices), map them to strings from answers
        normalized.correct = normalized.correct.map((c, idx) => {
            if (typeof c === 'number' || (typeof c === 'string' && /^\d+$/.test(c))) {
                const cIdx = parseInt(c);
                if (!isNaN(cIdx) && normalized.answers[cIdx] !== undefined) {
                    return normalized.answers[cIdx];
                }
            }
            return String(c);
        });

        // Ensure correct length matches questions length
        if (normalized.correct.length !== normalized.questions.length) {
            const qLen = normalized.questions.length;
            if (normalized.correct.length < qLen) {
                const padding = Array(qLen - normalized.correct.length).fill(normalized.answers[0] || '');
                normalized.correct = [...normalized.correct, ...padding];
            } else {
                normalized.correct = normalized.correct.slice(0, qLen);
            }
        }
    }

    // Normalize Essay / Uraian
    if (normalized.type === 'text') {
        // AI might put the answer in various fields
        if (normalized.correct === undefined || normalized.correct === null || (typeof normalized.correct === 'string' && normalized.correct.trim() === '')) {
            const possibleAnswerFields = ['answer', 'jawaban', 'response', 'ref_answer', 'reference_answer', 'key'];
            for (const field of possibleAnswerFields) {
                if (normalized[field] !== undefined && normalized[field] !== null && String(normalized[field]).trim() !== '') {
                    normalized.correct = String(normalized[field]).trim();
                    break;
                }
            }
        }

        // Ensure options is an empty array for text type
        normalized.options = [];

        // Ensure correct is a string
        if (normalized.correct === undefined || normalized.correct === null) {
            normalized.correct = '';
        } else if (typeof normalized.correct !== 'string') {
            normalized.correct = String(normalized.correct);
        }
    }

    if (!normalized.images || !Array.isArray(normalized.images)) {
        if (normalized.images && typeof normalized.images === 'string') {
            normalized.images = [normalized.images];
        } else {
            normalized.images = [];
        }
    }

    // Ensure all elements in images are strings
    normalized.images = normalized.images.filter(img => img && typeof img === 'string');

    if (!normalized.text) normalized.text = '';
    if (typeof normalized.text !== 'string') normalized.text = String(normalized.text);

    return normalized;
}

// ─── Data Layer (Supabase Native + Fallback) ──────────────────────────────────

async function readDB(loadAll = true) {
    try {
        const dbObj = await sqlDb.readDB(loadAll);
        return dbObj || { ...DEFAULT_DB, globalSettings: { apiKeys: [] } };
    } catch (e) {
        console.error('readDB error:', e.message);
        return {
            ...DEFAULT_DB,
            globalSettings: { apiKeys: [] },
            error: e.message
        };
    }
}

async function writeDB(obj) {
    await sqlDb.writeDB(obj);
}

async function readResults(options = {}) {
    try {
        if (Object.keys(options).length > 0) {
            return await sqlDb.getResults(options);
        }
        return await sqlDb.getAllResults();
    } catch (e) {
        console.error('readResults error:', e.message);
        return [];
    }
}

async function writeResults(results) {
    await sqlDb.setAllResults(results);
}


async function readLiveExams() {
    try {
        const items = await sqlDb.getAllLiveExams();
        console.log('[readLiveExams] Parsed', items.length, 'items');
        return items;
    } catch (e) {
        console.error('[readLiveExams] Error:', e.message);
        return [];
    }
}

async function writeLiveExams(liveExams) {
    await sqlDb.setAllLiveExams(liveExams);
}

function mergeLiveExamData(existing, incoming) {
    if (!existing || typeof existing !== 'object') return { ...incoming };
    if (!incoming || typeof incoming !== 'object') return { ...existing };

    const merged = { ...existing, ...incoming };

    // SERVER-SIDE TIMESTAMP ENFORCEMENT
    merged.updatedAt = Date.now();

    // Preserve answers/currentIdx unless incoming explicitly includes them.
    if (existing.answers && incoming.answers === undefined) merged.answers = existing.answers;
    if (existing.currentIdx !== undefined && incoming.currentIdx === undefined) merged.currentIdx = existing.currentIdx;
    if (existing.ragu && incoming.ragu === undefined) merged.ragu = existing.ragu;

    // If admin explicitly requests to DELETE the checkpoint
    if (incoming.adminDeleteCheckpoint) {
        merged.adminSavedProgress = null;
        merged.adminSaveConfirmed = false;
        merged.savedByAdminCommand = false;
        merged.adminReloadRequest = false; // Also clear any pending reload
        merged.adminClearRequest = true; // Alert student side as well
        merged.adminClearConfirmed = false; // Reset confirmation status for new request
    } else {
        const hasIncomingCheckpoint = incoming.adminSavedProgress &&
            Array.isArray(incoming.adminSavedProgress.answers) &&
            incoming.adminSavedProgress.answers.length > 0;

        if (existing.adminSavedProgress && !hasIncomingCheckpoint) {
            merged.adminSavedProgress = existing.adminSavedProgress;
        }

        // Preserve flags only if NOT deleting
        merged.adminSaveConfirmed = existing.adminSaveConfirmed || incoming.adminSaveConfirmed || false;
        merged.savedByAdminCommand = existing.savedByAdminCommand || incoming.savedByAdminCommand || false;

        // 1. Handle Reload Request (Strict Persistence)
        if (incoming.adminReloadConfirmed) {
            merged.adminReloadRequest = false;
        } else if (existing.adminReloadRequest) {
            if (incoming.adminReloadRequest && incoming.adminReloadRequest !== existing.adminReloadRequest) {
                merged.adminReloadRequest = incoming.adminReloadRequest;
            } else {
                merged.adminReloadRequest = existing.adminReloadRequest;
            }
        } else {
            merged.adminReloadRequest = incoming.adminReloadRequest || false;
        }

        // 2. Handle Clear Request (Strict Persistence)
        if (incoming.adminClearConfirmed) {
            merged.adminClearRequest = false;
        } else if (existing.adminClearRequest) {
            if (incoming.adminClearRequest && incoming.adminClearRequest !== existing.adminClearRequest) {
                merged.adminClearRequest = incoming.adminClearRequest;
            } else {
                merged.adminClearRequest = existing.adminClearRequest;
            }
        } else {
            merged.adminClearRequest = incoming.adminClearRequest || false;
        }
    }

    delete merged.adminDeleteCheckpoint;

    // If the incoming payload is a SPECIFIC save request, update flags.
    if (incoming.adminSaveRequest) {
        merged.adminSaveConfirmed = true;
        merged.savedByAdminCommand = true;
    }

    return merged;
}

async function insertLiveExamSingle(exam) {
    console.log('[insertLiveExamSingle] Received exam:', { studentId: exam.studentId, mapel: exam.mapel, rombel: exam.rombel, updatedAt: exam.updatedAt, type: typeof exam.updatedAt });
    try {
        const normalizeExamDate = value => {
            if (value === undefined || value === null || value === '') return new Date().toISOString();
            if (typeof value === 'number') return new Date(value).toISOString();
            const trimmed = String(value).trim();
            if (/^\d+$/.test(trimmed)) {
                let ms = Number(trimmed);
                if (trimmed.length === 10) ms *= 1000;
                return new Date(ms).toISOString();
            }
            const parsed = Date.parse(trimmed);
            return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
        };

        exam.updatedAt = normalizeExamDate(exam.updatedAt);

        const norm = v => String(v || '').trim().toLowerCase();
        const nid = norm(exam.studentId);
        const nrb = norm(exam.rombel);
        const nmp = norm(exam.mapel);

        const allExams = await sqlDb.getAllLiveExams();
        const existing = allExams.find(e =>
            norm(e.studentId) === nid &&
            norm(e.rombel) === nrb &&
            norm(e.mapel) === nmp
        );

        if (exam.adminDeleteCheckpoint) {
            console.log(`[insertLiveExamSingle] 🚀 HARD WIPING database checkpoint for ${nid}`);
            await sqlDb.clearCheckpointDirectly(nid, nmp, nrb);

            if (existing) {
                existing.adminSavedProgress = null;
                existing.adminSaveConfirmed = false;
                existing.savedByAdminCommand = false;
            }
        }

        const merged = mergeLiveExamData(existing || {}, exam);

        if (exam.adminDeleteCheckpoint) {
            merged.adminSavedProgress = null;
            merged.adminSaveConfirmed = false;
            merged.savedByAdminCommand = false;
            merged.adminClearRequest = Date.now();
        }

        await sqlDb.upsertLiveExam(merged);
        console.log('[insertLiveExamSingle] Saved checkpoints in Supabase');
    } catch (err) {
        console.error('[insertLiveExamSingle] Error:', err.message);
        throw err;
    }
}

async function insertResultSingle(resultObj) {
    if (resultObj.deleted) {
        await sqlDb.deleteResult(
            resultObj.studentId || '',
            resultObj.mapel || '',
            resultObj.rombel || '',
            resultObj.date || ''
        );
    } else {
        await sqlDb.upsertResult(resultObj);
    }
}

// ─── Static Files (Manual Fallbacks) ──────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(rootPath, 'index.html')));
app.get('/administrasi_guru.html', (req, res) => res.sendFile(path.join(rootPath, 'administrasi_guru.html')));

// Specific route for favicon to avoid SPA catch-all
app.get('/favicon.ico', (req, res) => {
    const icoPath = path.join(rootPath, 'favicon.ico');
    if (fs.existsSync(icoPath)) {
        res.sendFile(icoPath);
    } else {
        res.sendFile(path.join(rootPath, 'logo.png'));
    }
});

// Catch-all for SPA navigation
app.get('*', (req, res, next) => {
    if (req.url.startsWith('/api')) return next();
    if (req.url.includes('.')) return next();
    res.sendFile(path.join(rootPath, 'index.html'));
});

// ─── Health Endpoint ──────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
    const status = {
        ok: false,
        mode: USE_SUPABASE ? 'supabase' : 'local',
        error: null
    };
    if (USE_SUPABASE) {
        try {
            const { error: dbError } = await supabase.from('cbt_database').select('id').limit(1);
            if (dbError) throw dbError;

            status.db_connection = 'OK';
            status.ok = true;
        } catch (e) {
            status.error = e.message;
        }
    } else {
        status.error = 'Set SUPABASE_URL and SUPABASE_KEY in environment variables.';
    }
    res.json(status);
});

// ─── API: Network IPs ────────────────────────────────────────────────────────
app.get('/api/ips', (req, res) => {
    try {
        const os = require('os');
        const interfaces = os.networkInterfaces();
        const ips = [];
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if ('IPv4' === iface.family && !iface.internal) {
                    ips.push(iface.address);
                }
            }
        }
        res.json(ips);
    } catch (e) {
        console.error('GET /api/ips error:', e.message);
        res.status(500).json([]);
    }
});

// ─── API: Dashboard Stats (Alias if needed) ───────────────────────────────────
app.get('/api/admin/global-api-keys', async (req, res) => {
    try {
        const db = await readDB();
        let keys = [];

        // 1. Get from Supabase if configured
        if (typeof USE_SUPABASE !== 'undefined' && USE_SUPABASE && typeof supabase !== 'undefined') {
            try {
                const { data, error } = await supabase
                    .from('global_api_keys')
                    .select('*')
                    .order('added_at', { ascending: false });

                if (data && !error) {
                    data.forEach(key => {
                        keys.push({
                            id: key.id,
                            source: 'supabase',
                            provider: key.provider,
                            key: key.key,
                            status: key.status,
                            addedAt: key.added_at,
                            updatedAt: key.updated_at,
                            note: key.note
                        });
                    });
                }
            } catch (err) {
                console.warn('[ADMIN] Supabase global keys error:', err.message);
            }
        }

        // 2. Fallback/Merge with MySQL globalSettings
        if (db.globalSettings && Array.isArray(db.globalSettings.apiKeys)) {
            db.globalSettings.apiKeys.forEach((k, idx) => {
                if (!keys.some(existing => existing.key === k.key)) {
                    keys.push({
                        ...k,
                        id: `mysql-${idx}`,
                        source: 'mysql',
                        index: idx
                    });
                }
            });
        }

        // 3. Add Teacher keys
        if (db.students) {
            db.students.forEach(s => {
                if (s.role === 'teacher' && Array.isArray(s.apiKeys)) {
                    const normalized = typeof normalizeTeacherApiKeysArray === 'function' ?
                        normalizeTeacherApiKeysArray(s.apiKeys) : s.apiKeys;

                    normalized.forEach((k, idx) => {
                        if (!keys.some(existing => existing.key === k.key)) {
                            keys.push({
                                id: `teacher-${s.id}-${idx}`,
                                source: 'teacher',
                                teacherId: s.id,
                                teacherName: s.name,
                                index: idx,
                                provider: k.provider || 'Unknown',
                                key: k.key,
                                status: k.status || 'active',
                                addedAt: 'Guru: ' + s.name,
                                updatedAt: k.updatedAt || new Date().toISOString(),
                                note: 'Personal key'
                            });
                        }
                    });
                }
            });
        }

        // 4. Add Env Vars
        const geminiRaw = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
        geminiRaw.split(',').forEach((k, i) => {
            const trimmed = k.trim();
            if (trimmed && !keys.some(existing => existing.key === trimmed)) {
                keys.push({
                    id: `env-gemini-${i}`,
                    source: 'env',
                    provider: 'Google Gemini',
                    key: trimmed,
                    status: 'active',
                    addedAt: 'Vercel Env',
                    updatedAt: new Date().toISOString(),
                    note: 'Static Env Var'
                });
            }
        });

        const oaiRaw = process.env.OPENAI_API_KEY || '';
        oaiRaw.split(',').forEach((k, i) => {
            const trimmed = k.trim();
            if (trimmed && !keys.some(existing => existing.key === trimmed)) {
                keys.push({
                    id: `env-openai-${i}`,
                    source: 'env',
                    provider: 'OpenAI',
                    key: trimmed,
                    status: 'active',
                    addedAt: 'Vercel Env',
                    updatedAt: new Date().toISOString(),
                    note: 'Static Env Var'
                });
            }
        });

        const activeCount = keys.filter(k => k.status !== 'exhausted').length;
        const exhaustedCount = keys.filter(k => k.status === 'exhausted').length;

        res.json({ ok: true, globalKeys: keys, activeCount, exhaustedCount });
    } catch (e) {
        console.error('GET /api/admin/global-api-keys error:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── API: School Settings (Public Branding) ──────────────────────────────────
app.get('/api/school-settings', async (req, res) => {
    try {
        const settings = sqlDb.getSchoolSettings();
        res.json(settings || {});
    } catch (e) {
        console.error('GET /api/school-settings error:', e.message);
        res.status(500).json({});
    }
});

app.post('/api/school-settings', async (req, res) => {
    try {
        const settings = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ ok: false, error: 'Invalid settings payload' });
        }
        sqlDb.setSchoolSettings(settings);
        console.log('[school-settings] Saved. Name:', settings.name, '| Has logo:', !!settings.logo);
        res.json({ ok: true });
    } catch (e) {
        console.error('POST /api/school-settings error:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── API: System Config ───────────────────────────────────────────────────────
app.get('/api/admin/config/:key', async (req, res) => {
    try {
        const value = sqlDb.getConfig(req.params.key);
        res.json({ ok: true, key: req.params.key, value });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/admin/config', async (req, res) => {
    try {
        const { key, value } = req.body;
        sqlDb.setConfig(key, value);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── API: Database (Metadata Only by default in MySQL) ────────────────────────
app.get('/api/db', async (req, res) => {
    try {
        const loadAll = req.query.full === 'true';
        const data = await readDB(loadAll);
        if (data) {
            // Ensure array properties exist for frontend compatibility
            if (data.questions === undefined) data.questions = [];
            if (data.results === undefined) data.results = [];
            return res.json(data);
        }
        return res.status(404).json({ error: 'Database not found' });
    } catch (e) {
        console.error('GET /api/db error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// Granular Questions API
app.get('/api/questions', async (req, res) => {
    try {
        const options = {
            mapel: req.query.mapel,
            rombel: req.query.rombel,
            search: req.query.search,
            limit: parseInt(req.query.limit) || 50,
            offset: parseInt(req.query.offset) || 0
        };
        const items = sqlDb.getQuestions(options);
        const total = sqlDb.getQuestionsCount(options);
        return res.json({ items, total, limit: options.limit, offset: options.offset });
    } catch (e) {
        console.error('GET /api/questions error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// Granular Students API
app.get('/api/students', async (req, res) => {
    try {
        // For simplicity, returning all students for now, but lazy-loaded from readDB
        const students = sqlDb.getAllStudents();
        return res.json(students);
    } catch (e) {
        console.error('GET /api/students error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/db', async (req, res) => {
    try {
        const payload = req.body;
        if (Array.isArray(payload.results) && payload.results.length > 0) {
            // Bulk insert results directly in standard payload format
            await writeResults(payload.results);
        }
        const { results, ...dbOnly } = payload;
        await writeDB(dbOnly);
        return res.json({ ok: true });
    } catch (e) {
        console.error('POST /api/db error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// ─── API: Upload Image to Local Storage ──────────────────────────────────────
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image provided' });
        }

        const file = req.file;
        const rawFileName = file.originalname || 'image.jpg';
        const fileExt = path.extname(rawFileName) || '.jpg';
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${fileExt}`;

        // Simpan ke folder images lokal di dalam APP
        const imagesDir = path.join(rootPath, 'images');
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        const localPath = path.join(imagesDir, fileName);
        fs.writeFileSync(localPath, file.buffer);

        const url = `/images/${fileName}`;
        console.log(`[STORAGE] ✅ Gambar disimpan lokal: ${localPath}`);
        return res.json({ ok: true, url });
    } catch (e) {
        console.error('POST /api/upload-image error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});
// ─── API: Upload School Logo ──────────────────────────────────────────────────
app.post('/api/upload-logo', upload.single('logo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, error: 'No logo file provided' });
        }

        const file = req.file;
        const rawFileName = file.originalname || 'logo.png';
        const fileExt = path.extname(rawFileName) || '.png';

        // Simpan sebagai school_logo (dengan timestamp untuk cache-busting)
        const logoFileName = `school_logo${fileExt}`;
        const logoPath = path.join(rootPath, logoFileName);
        const legacyLogoPath = path.join(rootPath, 'logo.png');

        // Simpan versi timestamped
        fs.writeFileSync(logoPath, file.buffer);

        // Simpan/Timpa logo.png (branding utama)
        try {
            fs.writeFileSync(legacyLogoPath, file.buffer);
            console.log(`[LOGO] ✅ logo.png overwritten at: ${legacyLogoPath}`);

            // Juga coba timpa di folder dist/APP jika ada (untuk build yang sudah jadi)
            const distPath = path.join(baseDir, 'dist', 'APP', 'logo.png');
            if (fs.existsSync(distPath)) {
                fs.writeFileSync(distPath, file.buffer);
                console.log(`[LOGO] ✅ logo.png overwritten in dist/APP: ${distPath}`);
            }
        } catch (err) {
            console.warn('[LOGO] Gagal menimpa logo.png:', err.message);
        }

        const logoUrl = `/${logoFileName}?v=${Date.now()}`;
        const logoUrlBase = `/${logoFileName}`;
        console.log(`[LOGO] ✅ Logo disimpan di: ${logoPath}. URL for UI: ${logoUrl}`);

        // Simpan URL logo ke database
        const currentSettings = sqlDb.getSchoolSettings() || {};
        currentSettings.logoUrl = logoUrl;
        sqlDb.setSchoolSettings(currentSettings);

        return res.json({ ok: true, url: logoUrl, urlBase: logoUrlBase });
    } catch (e) {
        console.error('POST /api/upload-logo error:', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/results', async (req, res) => {
    try {
        const options = {
            studentId: req.query.studentId,
            mapel: req.query.mapel,
            rombel: req.query.rombel,
            limit: parseInt(req.query.limit) || 100,
            offset: parseInt(req.query.offset) || 0
        };
        // 'withRetry' helper not available in this build; call readResults directly
        const results = await readResults(options);

        // Return with metadata if granular
        if (req.query.limit || req.query.offset || req.query.studentId) {
            const total = USE_SUPABASE ? null : sqlDb.getResultsCount(options);
            return res.json({ items: results, total, limit: options.limit, offset: options.offset });
        }

        return res.json(results);
    } catch (e) {
        console.error('GET /api/results error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/results', async (req, res) => {
    try {
        const incoming = req.body;
        if (!Array.isArray(incoming)) return res.status(400).json({ error: 'Array required' });
        await writeResults(incoming);
        return res.json({ ok: true, count: incoming.length });
    } catch (e) {
        console.error('POST /api/results error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// ─── Activity Logs (GET + DELETE) ───────────────────────────────────────────
app.get('/api/logs', async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
        // Use initialized supabase client if available, otherwise create one
        const sb = supabase || createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '');
        if (!sb) return res.json({ ok: true, items: [] });

        const { data, error } = await sb.from('cbt_logs').select('*').order('created_at', { ascending: false }).range(0, limit - 1);
        if (error) {
            console.warn('[GET /api/logs] Supabase error:', error.message || error);
            return res.json({ ok: true, items: [] });
        }
        return res.json({ ok: true, items: data || [] });
    } catch (e) {
        console.error('GET /api/logs error:', e.message);
        return res.json({ ok: true, items: [] });
    }
});

app.delete('/api/logs', async (req, res) => {
    try {
        const sb = supabase || createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '');
        if (!sb) return res.json({ ok: true });
        const { error } = await sb.from('cbt_logs').delete().neq('id', 0);
        if (error) {
            console.warn('[DELETE /api/logs] Supabase error:', error.message || error);
            return res.json({ ok: false, error: error.message || String(error) });
        }
        return res.json({ ok: true });
    } catch (e) {
        console.error('DELETE /api/logs error:', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Manajemen Nilai API ───────────────────────────────────────────────────────
app.get('/api/grades', async (req, res) => {
    try {
        const { mapel, rombel } = req.query;
        const grades = sqlDb.getGrades(mapel || null, rombel || null);
        res.json(grades);
    } catch (e) {
        console.error('GET /api/grades error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/grades', async (req, res) => {
    try {
        const incoming = req.body;
        const gradesArr = Array.isArray(incoming) ? incoming : [incoming];
        for (const g of gradesArr) {
            sqlDb.upsertGrade(g);
        }
        res.json({ success: true, count: gradesArr.length });
    } catch (e) {
        console.error('POST /api/grades error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/live-exams', async (req, res) => {
    try {
        let liveExams = await readLiveExams();
        if (!Array.isArray(liveExams)) liveExams = [];
        const now = Date.now();

        // Return:
        // 1. Fresh exams (updated within 5 minutes) - for current active students
        // 2. Admin-saved checkpoints (any age, if adminSavedProgress.answers exists) - for restore after reload
        const result = liveExams.filter(exam => {
            const updatedAt = exam.updatedAt ? new Date(exam.updatedAt).getTime() : 0;
            const isFresh = !Number.isNaN(updatedAt) && (now - updatedAt) < 5 * 60 * 1000;

            // Check if this has a valid admin-saved checkpoint
            const hasAdminCheckpoint = exam.adminSavedProgress &&
                Array.isArray(exam.adminSavedProgress.answers) &&
                exam.adminSavedProgress.answers.length > 0;

            return isFresh || hasAdminCheckpoint;
        });

        const fresh = liveExams.filter(exam => {
            const updatedAt = exam.updatedAt ? new Date(exam.updatedAt).getTime() : 0;
            return !Number.isNaN(updatedAt) && (now - updatedAt) < 5 * 60 * 1000;
        });
        const withCheckpoint = result.filter(e => e.adminSavedProgress && Array.isArray(e.adminSavedProgress.answers) && e.adminSavedProgress.answers.length > 0);

        // console.log('[GET /api/live-exams] Total:', liveExams.length, '| Fresh (<5min):', fresh.length, '| With admin checkpoint:', withCheckpoint.length, '| Returned:', result.length);
        return res.json(result);
    } catch (e) {
        console.error('[GET /api/live-exams] Error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// New API endpoint: GET saved exam for specific student & mapel (for restore)
app.get('/api/saved-exam/:studentId/:mapel', async (req, res) => {
    try {
        const { studentId, mapel } = req.params;
        const rombel = req.query.rombel;

        console.log('[GET /api/saved-exam] studentId:', studentId, 'mapel:', mapel, 'rombel:', rombel);

        let liveExams = await readLiveExams();
        if (!Array.isArray(liveExams)) liveExams = [];

        const norm = v => String(v || '').trim().toLowerCase();
        const nid = norm(studentId);
        const nmp = norm(mapel);
        const nrb = rombel ? norm(rombel) : null;

        // Find exact match with admin-saved checkpoint
        const exam = liveExams.find(e =>
            norm(e.studentId) === nid &&
            norm(e.mapel) === nmp &&
            (!nrb || norm(e.rombel) === nrb) &&
            e.adminSavedProgress &&
            Array.isArray(e.adminSavedProgress.answers) &&
            e.adminSavedProgress.answers.length > 0
        );

        if (exam) {
            console.log('[GET /api/saved-exam] ✅ Found:', { currentIdx: exam.adminSavedProgress.currentIdx, answerCount: exam.adminSavedProgress.answers.length });
            return res.json({ ok: true, exam });
        }

        console.log('[GET /api/saved-exam] No checkpoint found');
        return res.json({ ok: false, exam: null });
    } catch (e) {
        console.error('[GET /api/saved-exam] Error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/live-exam', async (req, res) => {
    try {
        const exam = req.body;
        console.log('[POST /api/live-exam] Received:', { studentId: exam?.studentId, mapel: exam?.mapel });
        if (!exam || typeof exam !== 'object') {
            console.warn('[POST /api/live-exam] Invalid exam object');
            return res.status(400).json({ error: 'Object required' });
        }
        await insertLiveExamSingle(exam);
        console.log('[POST /api/live-exam] Saved successfully');
        return res.json({ ok: true });
    } catch (e) {
        console.error('[POST /api/live-exam] Error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/result', async (req, res) => {
    try {
        const result = req.body;
        if (!result || typeof result !== 'object') return res.status(400).json({ error: 'Invalid payload' });
        await insertResultSingle(result);
        return res.json({ ok: true, count: 1 });
    } catch (e) {
        console.error('POST /api/result error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// ─── API: Import Word ─────────────────────────────────────────────────────────
app.post('/api/import-word', upload.single('file'), async (req, res) => {
    try {
        console.log('📥 Import Word request received');
        console.log('📄 File info:', req.file ? { name: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype } : 'No file');

        if (!req.file) {
            console.log('❌ No file provided in request');
            return res.status(400).json({ error: 'No file provided' });
        }

        // Validate file type
        const allowedMimes = [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
            'application/msword', // .doc
            'application/octet-stream' // Sometimes Word files are sent as this
        ];

        if (!allowedMimes.includes(req.file.mimetype) && !req.file.originalname.match(/\.(doc|docx)$/i)) {
            console.log('❌ Invalid file type:', req.file.mimetype, req.file.originalname);
            return res.status(400).json({
                error: 'File harus berupa dokumen Word (.doc atau .docx)'
            });
        }

        // Validate file size (minimum 1KB to avoid empty files)
        if (req.file.size < 1024) {
            console.log('❌ File too small:', req.file.size, 'bytes');
            return res.status(400).json({
                error: 'File terlalu kecil atau kosong'
            });
        }

        const metadata = {
            subject: req.body.subject || '',
            class: req.body.class || '',
            type: req.body.type || 'single'
        };
        console.log('📋 Metadata:', metadata);

        const result = await parseWordDocument(req.file.buffer, metadata);
        console.log('📊 Parse result:', { success: result.success, count: result.count, error: result.error });

        if (!result.success) {
            console.log('❌ Parsing failed:', result.error);
            return res.status(400).json({ error: result.error });
        }

        let addedCount = 0;
        for (const q of result.questions) {
            try {
                sqlDb.addQuestion(q);
                addedCount++;
            } catch (err) {
                console.error('[IMPORT WORD] Failed to add individual question:', err.message);
            }
        }

        console.log(`✅ Successfully imported ${addedCount} questions.`);
        return res.json({
            ok: true,
            imported: result.count,
            questions: result.questions,
            warnings: result.warnings || []
        });
    } catch (e) {
        console.error('❌ POST /api/import-word error:', e.message);
        console.error('❌ Stack trace:', e.stack);
        return res.status(500).json({ error: e.message });
    }
});

/**
 * Agregasi semua API key yang tersedia dari berbagai sumber:
 * 1. Environment Variables (Static & Dynamic GLOBAL_*)
 * 2. Supabase Table (global_api_keys)
 * 3. Local database.json (globalSettings & Teacher profiles)
 */
// ─── API: User Logs ──────────────────────────────────────────────────────────
app.get('/api/logs', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const logs = sqlDb.getLogs(limit);
        res.json({ ok: true, items: logs });
    } catch (e) {
        console.error('GET /api/logs error:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/logs', async (req, res) => {
    try {
        const { userId, userName, role, activity } = req.body;
        sqlDb.addLog(userId, userName, role, activity);
        res.json({ ok: true });
    } catch (e) {
        console.error('POST /api/logs error:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.delete('/api/logs', async (req, res) => {
    try {
        sqlDb.clearLogs();
        res.json({ ok: true });
    } catch (e) {
        console.error('DELETE /api/logs error:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

async function discoverAllAPIKeys(provider, teacherId = null) {
    const providerMap = {
        'google': ['gemini', 'google'],
        'openai': ['openai', 'chatgpt'],
        'openrouter': ['openrouter'],
        'deepseek': ['deepseek']
    };
    const searchTerms = providerMap[provider] || [provider];

    let allKeys = [];

    // 1. Static Env Vars
    if (provider === 'google') {
        const raw = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
        allKeys = [...allKeys, ...raw.split(',').map(k => k.trim()).filter(k => k)];
    } else if (provider === 'openai') {
        const raw = process.env.OPENAI_API_KEY || '';
        allKeys = [...allKeys, ...raw.split(',').map(k => k.trim()).filter(k => k)];
    } else if (provider === 'openrouter') {
        const raw = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || process.env.OPEN_ROUTER_KEY || '';
        allKeys = [...allKeys, ...raw.split(',').map(k => k.trim()).filter(k => k)];
    } else if (provider === 'deepseek') {
        const raw = process.env.DEEPSEEK_API_KEY || process.env.DEEP_SEEK_API_KEY || '';
        allKeys = [...allKeys, ...raw.split(',').map(k => k.trim()).filter(k => k)];
    }

    // 2. Dynamic GLOBAL_ Env Vars
    Object.keys(process.env).forEach(envKey => {
        if (envKey.startsWith('GLOBAL_') && envKey.includes('_APIKEY')) {
            const isMatch = searchTerms.some(term => envKey.toLowerCase().includes(term.toLowerCase()));
            if (isMatch) {
                const val = process.env[envKey];
                if (val) allKeys.push(val.trim());
            }
        }
    });

    // 3. Database (Local or Supabase)
    const db = (await readDB()) || { globalSettings: { apiKeys: [] }, students: [], globalAPIKeysStatus: {} };
    const statusMap = db.globalAPIKeysStatus || {};

    // Helper to check if key is exhausted in database with smart lockout
    const isExhausted = (k) => {
        const hash = k.substring(k.length - 10);
        const entry = statusMap[hash];
        if (!entry || entry.status !== 'exhausted') return false;

        const exhaustedAt = entry.exhaustedAt ? new Date(entry.exhaustedAt).getTime() : 0;
        const now = Date.now();

        // Smart lockout logic:
        // 1. If it's a 402/Quota issue (Insufficient Balance), lock for 1 hour
        // 2. If it's a 429 Rate Limit issue, lock for 5 minutes
        // 3. Default (unknown) lock for 2 minutes

        let waitTime = 120000; // Default 2m
        const note = (entry.note || '').toLowerCase();

        if (note.includes('quota') || note.includes('balance') || note.includes('insufficient') || note.includes('402')) {
            waitTime = 3600000; // 1 hour
        } else if (note.includes('limit') || note.includes('429') || note.includes('503') || note.includes('busy') || note.includes('service unavailable')) {
            waitTime = 300000; // 5 minutes
        }

        if (now - exhaustedAt > waitTime) {
            console.log(`[AI] Auto-reviving key ...${hash} (Lockout expired after ${waitTime / 1000}s)`);
            return false;
        }

        return true;
    };

    // From globalSettings
    if (db.globalSettings && Array.isArray(db.globalSettings.apiKeys)) {
        db.globalSettings.apiKeys.forEach(entry => {
            const providerValue = String(entry.provider || '').toLowerCase();
            const isMatch = searchTerms.some(term => providerValue.includes(term.toLowerCase()));
            const key = entry.key ? String(entry.key).trim() : '';
            if (isMatch && key && !isExhausted(key)) {
                allKeys.push(key);
            }
        });
    }

    // From Teacher Profiles
    db.students.forEach(s => {
        if (s.role === 'teacher' && Array.isArray(s.apiKeys)) {
            const normalized = normalizeTeacherApiKeysArray(s.apiKeys);
            normalized.forEach(entry => {
                const providerValue = String(entry.provider || '').toLowerCase();
                const isMatch = searchTerms.some(term => providerValue.includes(term.toLowerCase()));
                const key = entry.key ? String(entry.key).trim() : '';
                if (isMatch && key && !isExhausted(key)) {
                    allKeys.push(key);
                }
            });
        }
    });

    // 4. Supabase Table (Direct lookup if enabled)
    if (USE_SUPABASE && supabase) {
        try {
            const { data } = await supabase.from('global_api_keys').select('*');
            if (data) {
                data.forEach(entry => {
                    const providerValue = String(entry.provider || '').toLowerCase();
                    const isMatch = searchTerms.some(term => providerValue.includes(term.toLowerCase()));
                    const key = entry.key ? String(entry.key).trim() : '';
                    if (isMatch && key && !isExhausted(key)) {
                        allKeys.push(key);
                    }
                });
            }
        } catch (e) {
            console.error('[AI] Supabase key discovery error:', e.message);
        }
    }

    // Final filter by exhausted status hash tracking and deduplicate
    let finalKeys = [...new Set(allKeys)].filter(k => !isExhausted(k));

    // Fisher-Yates Shuffle to distribute load across all available keys
    for (let i = finalKeys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [finalKeys[i], finalKeys[j]] = [finalKeys[j], finalKeys[i]];
    }

    console.log(`[AI] Discover [${provider}]: Found ${finalKeys.length} active keys (Total scanned: ${allKeys.length})`);
    return finalKeys;
}

/**
 * Persistently marks an API key as exhausted or active.
 * Updates local database.json and Supabase if available.
 */
async function markApiKeyStatus(key, status, note = '', provider = '', teacherId = null) {
    if (!key) return;
    const db = await readDB();
    if (!db) return;

    const hash = key.substring(key.length - 10);
    const now = new Date().toISOString();

    console.log(`[AI] Marking key ...${hash} as ${status} (${note}) for ${provider || 'Unknown Provider'} (Teacher: ${teacherId || 'System'})`);

    // 1. Update in globalAPIKeysStatus (for env vars and general tracking)
    if (!db.globalAPIKeysStatus) db.globalAPIKeysStatus = {};
    db.globalAPIKeysStatus[hash] = {
        status: status,
        exhaustedAt: now,
        updatedAt: now,
        note: note,
        provider: provider
    };

    // 2. Update in globalSettings if exists
    if (db.globalSettings && Array.isArray(db.globalSettings.apiKeys)) {
        db.globalSettings.apiKeys.forEach(entry => {
            if (entry.key && entry.key.trim() === key.trim()) {
                entry.status = status;
                entry.updatedAt = now;
                entry.exhaustedAt = now;
                entry.note = note;
                if (provider) entry.provider = provider;
            }
        });
    }

    // 3. Update in teacher profiles if exists
    if (Array.isArray(db.students)) {
        db.students.forEach(s => {
            // If we have a teacherId, we can optimize, otherwise check all teachers
            if ((!teacherId || s.id === teacherId) && s.role === 'teacher' && Array.isArray(s.apiKeys)) {
                s.apiKeys.forEach((entry, idx) => {
                    const entryKey = typeof entry === 'string' ? entry : entry.key;
                    if (entryKey && entryKey.trim() === key.trim()) {
                        if (typeof entry === 'string') {
                            s.apiKeys[idx] = {
                                key: entryKey.trim(),
                                status: status,
                                updatedAt: now,
                                exhaustedAt: now,
                                note: note,
                                provider: provider || 'Unknown'
                            };
                        } else {
                            entry.status = status;
                            entry.updatedAt = now;
                            entry.exhaustedAt = now;
                            entry.note = note;
                            if (provider) entry.provider = provider;
                        }
                    }
                });
            }
        });
    }

    // 4. Update in Supabase if enabled
    if (USE_SUPABASE && supabase) {
        try {
            // Update individual key in global_api_keys table
            const { error: gError } = await supabase
                .from('global_api_keys')
                .update({
                    status: status,
                    updated_at: now,
                    exhausted_at: now,
                    note: note
                })
                .eq('key', key.trim());

            if (gError) {
                console.warn(`[AI] Info: Key not found in global_api_keys table (might be Env Var or Teacher key), skipping direct update.`);
            } else {
                console.log(`[AI] Status updated in Supabase table global_api_keys`);
            }
        } catch (e) {
            console.error('[AI] Supabase individual key update internal error:', e.message);
        }
    }

    // This saves the entire DB state (including updated globalAPIKeysStatus and students) to Supabase
    await writeDB(db);
    console.log(`[AI] Full database state persisted to Supabase/Local storage.`);
}

/**
 * Helper to call Gemini with key rotation and model fallback
 */
async function callGeminiAI(prompt, teacherId = null) {
    const keys = await discoverAllAPIKeys('google', teacherId);

    if (keys.length === 0) throw new Error('API Key Google/Gemini tidak ditemukan atau kuota habis di semua sumber.');

    // Check if user has a preferred model
    const preferredModel = sqlDb.getConfig('gemini_model_preference') || 'auto';

    // Super-charged model list for maximum resilience (including next-gen models)
    let models = [
        { name: 'gemini-3.5-flash', version: 'v1' },
        { name: 'gemini-3.5-pro', version: 'v1' },
        { name: 'gemini-3.5-flash', version: 'v1beta' },
        { name: 'gemini-3.5-pro', version: 'v1beta' },
        { name: 'gemini-3.1-pro', version: 'v1' },
        { name: 'gemini-3.1-flash', version: 'v1' },
        { name: 'gemini-3.1-flash-lite', version: 'v1' },
        { name: 'gemini-3.0-pro', version: 'v1' },
        { name: 'gemini-3.0-flash', version: 'v1' },
        { name: 'gemini-3.1-pro', version: 'v1beta' },
        { name: 'gemini-3.1-flash', version: 'v1beta' },
        { name: 'gemini-3.1-flash-lite', version: 'v1beta' },
        { name: 'gemini-3.0-pro', version: 'v1beta' },
        { name: 'gemini-3.0-flash', version: 'v1beta' },
        { name: 'gemini-2.5-flash', version: 'v1' },
        { name: 'gemini-2.5-pro', version: 'v1' },
        { name: 'gemini-2.5-flash', version: 'v1beta' },
        { name: 'gemini-2.5-pro', version: 'v1beta' },
        { name: 'gemini-2.0-flash', version: 'v1' },
        { name: 'gemini-1.5-flash', version: 'v1' },
        { name: 'gemini-1.5-flash-latest', version: 'v1' },
        { name: 'gemini-1.5-flash-latest', version: 'v1beta' },
        { name: 'gemini-1.5-flash-8b', version: 'v1' },
        { name: 'gemini-2.0-flash-lite-preview-02-05', version: 'v1' },
        { name: 'gemini-2.0-flash-lite-preview-02-05', version: 'v1beta' },
        { name: 'gemini-1.5-pro', version: 'v1' },
        { name: 'gemini-1.5-pro-latest', version: 'v1' },
        { name: 'gemini-1.5-pro-latest', version: 'v1beta' },
        { name: 'gemini-1.0-pro', version: 'v1' }
    ];

    // If a preferred model is selected, move all matching variants to the very top
    if (preferredModel && preferredModel !== 'auto') {
        const preferred = models.filter(m => m.name === preferredModel);
        const others = models.filter(m => m.name !== preferredModel);
        models = [...preferred, ...others];
        console.log(`[AI] Model Preference Applied: ${preferredModel} moved to top priority.`);
    }

    let lastError;
    const sessionBadKeys = new Set();

    try {
        for (const modelObj of models) {
            const { name: model, version } = modelObj;
            for (const key of keys) {
                if (sessionBadKeys.has(key)) continue;

                try {
                    const hash = key.substring(key.length - 10);
                    console.log(`[AI] Trying Gemini: ${model} (${version}) with key: ...${hash}`);

                    const response = await fetch(`https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${key}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        const result = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        console.log(`[AI] ✅ Success with model: ${model}`);
                        return result;
                    }

                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData.error?.message || response.statusText;

                    if (response.status === 429) {
                        lastError = `[Rate Limit / Sistem Sibuk] pada model ${model} (${version}).`;
                        console.warn(`[AI] ⚠️ Gemini rate-limited / busy for model: ${model}`);
                        await markApiKeyStatus(key, 'exhausted', `Gemini Rate Limit / Busy (${model})`, 'Google Gemini', teacherId);
                        sessionBadKeys.add(key);
                        continue;
                    } else if (response.status === 503) {
                        lastError = `[Server Sibuk] pada model ${model} (${version}).`;
                        console.warn(`[AI] ⚠️ Gemini server busy for model: ${model}`);
                        await markApiKeyStatus(key, 'exhausted', `Gemini Server Busy (${model})`, 'Google Gemini', teacherId);
                        sessionBadKeys.add(key);
                        continue;
                    } else if (response.status === 404) {
                        lastError = `${model} (${version}): HTTP 404 - Model tidak ditemukan.`;
                        console.error(`[AI] ❌ Model ${model} not available on ${version}, skipping to next model tier...`);
                        break; // Model tidak ada, lanjut ke model berikutnya
                    } else {
                        lastError = `${model} (${version}): HTTP ${response.status} - ${errMsg}`;
                        console.error(`[AI] ❌ Model ${model} (${version}) error: ${response.status} ${errMsg}`);
                        if (response.status === 400 && (errMsg.includes('API_KEY_INVALID') || errMsg.includes('invalid'))) {
                            await markApiKeyStatus(key, 'exhausted', `Gemini Invalid Key`, 'Google Gemini', teacherId);
                            sessionBadKeys.add(key);
                        }
                    }

                } catch (e) {
                    lastError = e.message;
                    console.error(`[AI] Fetch error with ${model}:`, e.message);
                }
            }
        }
    } catch (e) {
        lastError = e.message;
        console.error(`[AI] Gemini implementation error:`, e.message);
    }
    throw new Error('Gagal menggunakan Gemini: ' + lastError);
}

/**
 * Helper to call OpenAI / ChatGPT
 */
async function callOpenAI(prompt, teacherId = null) {
    const keys = await discoverAllAPIKeys('openai', teacherId);

    console.log('[AI] Discovery [openai]: Found', keys.length, 'active keys');

    if (keys.length === 0) throw new Error('API Key OpenAI tidak ditemukan atau kuota habis di semua sumber.');

    // User requested order: gpt-4o-mini (#1), o1-mini (#2), gpt-4o (#3)
    const models = ['gpt-4o-mini', 'o1-mini', 'gpt-4o'];
    let lastError;
    const sessionBadKeys = new Set();

    for (const model of models) {
        for (const key of keys) {
            // Mid-session skip: skip if key failed in a previous model iteration
            if (sessionBadKeys.has(key)) continue;

            try {
                const hash = key.substring(key.length - 10);
                console.log(`[AI] Trying OpenAI model: ${model} with key: ...${hash}`);
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${key}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: prompt }]
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const result = data.choices?.[0]?.message?.content || '';
                    console.log(`[AI] ✅ Success with OpenAI model: ${model}`);
                    return result;
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || response.statusText;
                const errCode = errData.error?.code || '';

                if (response.status === 402 || errCode === 'insufficient_quota' || errMsg.toLowerCase().includes('quota')) {
                    const reason = 'Quota/Balance Exceeded (402)';
                    lastError = `[${reason}] pada model OpenAI ${model}.`;
                    console.warn(`[AI] ⚠️ OpenAI ${reason} for model: ${model}`);
                    await markApiKeyStatus(key, 'exhausted', `OpenAI ${reason} (${model})`, 'OpenAI', teacherId);
                    sessionBadKeys.add(key); // Mark for skip in this session
                    continue;
                } else if (response.status === 429 || response.status === 503 || errMsg.toLowerCase().includes('rate limit') || errMsg.toLowerCase().includes('too many requests') || errMsg.toLowerCase().includes('service unavailable')) {
                    const reason = response.status === 503 ? 'Server Busy / Service Unavailable (503)' : 'Rate Limit Exceeded (429)';
                    lastError = `[${reason}] pada model OpenAI ${model}.`;
                    console.warn(`[AI] ⚠️ OpenAI ${reason} for model: ${model}`);
                    await markApiKeyStatus(key, 'exhausted', `OpenAI ${reason} (${model})`, 'OpenAI', teacherId);
                    sessionBadKeys.add(key); // Mark for skip in this session
                    continue;
                }

                lastError = `${model}: HTTP ${response.status} - ${errMsg}`;
                console.error(`[AI] ❌ OpenAI model ${model} error: ${response.status} ${errMsg}`);
                if (response.status === 401) {
                    await markApiKeyStatus(key, 'exhausted', 'OpenAI Auth Error', 'OpenAI', teacherId);
                    sessionBadKeys.add(key);
                }
            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with OpenAI ${model}:`, e.message);
            }
        }
    }
    throw new Error('OpenAI gagal: ' + lastError);
}

async function callOpenRouterAI(prompt, teacherId = null) {
    const keys = await discoverAllAPIKeys('openrouter', teacherId);
    console.log('[AI] Discovery [OpenRouter]: Found', keys.length, 'active keys');

    if (keys.length === 0) throw new Error('API Key OpenRouter tidak ditemukan atau kuota habis di semua sumber.');

    const models = [
        'google/gemini-3.5-pro',
        'google/gemini-3.5-flash',
        'google/gemini-3.1-pro-preview',
        'google/gemini-3.1-flash-preview',
        'google/gemini-3.1-flash-lite-preview',
        'google/gemini-3-flash-preview',
        'openai/gpt-5.4-mini',
        'openai/gpt-4o-mini',
        'openai/gpt-4o',
        'anthropic/claude-3.7-sonnet',
        'meta-llama/llama-3.3-70b-instruct:free',
        'google/gemini-2.0-flash-001'
    ];
    let lastError;
    const sessionBadKeys = new Set();

    for (const model of models) {
        for (const key of keys) {
            if (sessionBadKeys.has(key)) continue;

            try {
                const hash = key.substring(key.length - 10);
                console.log(`[AI] Trying OpenRouter model: ${model} with key: ...${hash}`);
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${key}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.3,
                        max_tokens: 8192
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const result = data.choices?.[0]?.message?.content || '';
                    console.log(`[AI] ✅ Success with OpenRouter model: ${model}`);
                    return result;
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || errData.error || response.statusText;

                if (response.status === 402) {
                    lastError = `[Insufficient Balance] pada OpenRouter model ${model}.`;
                    console.warn(`[AI] ⚠️ OpenRouter insufficient balance for model: ${model}`);
                    await markApiKeyStatus(key, 'exhausted', `OpenRouter Insufficient Balance (${model})`, 'OpenRouter', teacherId);
                    sessionBadKeys.add(key);
                    continue;
                } else if (response.status === 429 || response.status === 503) {
                    lastError = `[Rate Limit / Server Sibuk] pada OpenRouter model ${model}.`;
                    console.warn(`[AI] ⚠️ OpenRouter rate-limited / busy for model: ${model}`);
                    await markApiKeyStatus(key, 'exhausted', `OpenRouter Rate Limit / Busy (${model})`, 'OpenRouter', teacherId);
                    sessionBadKeys.add(key);
                    continue;
                }

                lastError = `${model}: HTTP ${response.status} - ${errMsg}`;
                console.error(`[AI] ❌ OpenRouter model ${model} error: ${response.status} ${errMsg}`);
                if (response.status === 401) {
                    await markApiKeyStatus(key, 'exhausted', 'OpenRouter Auth Error', 'OpenRouter', teacherId);
                    sessionBadKeys.add(key);
                }
            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with OpenRouter ${model}:`, e.message);
            }
        }
    }
    throw new Error('OpenRouter gagal: ' + lastError);
}

async function callDeepSeekAI(prompt, teacherId = null) {
    const keys = await discoverAllAPIKeys('deepseek', teacherId);
    console.log('[AI] Discovery [DeepSeek]: Found', keys.length, 'active keys');

    if (keys.length === 0) throw new Error('API Key DeepSeek tidak ditemukan atau kuota habis di semua sumber.');

    const models = ['deepseek-chat', 'deepseek-coder'];
    let lastError;
    const sessionBadKeys = new Set();

    for (const model of models) {
        for (const key of keys) {
            if (sessionBadKeys.has(key)) continue;

            try {
                const hash = key.substring(key.length - 10);
                console.log(`[AI] Trying DeepSeek model: ${model} with key: ...${hash}`);
                const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: prompt }],
                        max_tokens: 8192,
                        temperature: 0.3
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const result = data.choices?.[0]?.message?.content || '';
                    console.log(`[AI] ✅ Success with DeepSeek model: ${model}`);
                    return result;
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || errData.error || response.statusText;

                if (response.status === 402) {
                    lastError = `[Insufficient Balance] pada DeepSeek model ${model}.`;
                    console.warn(`[AI] ⚠️ DeepSeek insufficient balance for model: ${model}`);
                    await markApiKeyStatus(key, 'exhausted', `DeepSeek Insufficient Balance (${model})`, 'DeepSeek', teacherId);
                    sessionBadKeys.add(key);
                    continue;
                } else if (response.status === 429 || response.status === 503) {
                    lastError = `[Rate Limit / Server Sibuk] pada DeepSeek model ${model}.`;
                    console.warn(`[AI] ⚠️ DeepSeek rate-limited / busy for model: ${model}`);
                    await markApiKeyStatus(key, 'exhausted', `DeepSeek Rate Limit / Busy (${model})`, 'DeepSeek', teacherId);
                    sessionBadKeys.add(key);
                    continue;
                }

                lastError = `${model}: HTTP ${response.status} - ${errMsg}`;
                console.error(`[AI] ❌ DeepSeek model ${model} error: ${response.status} ${errMsg}`);
                if (response.status === 401) {
                    await markApiKeyStatus(key, 'exhausted', 'DeepSeek Auth Error', 'DeepSeek', teacherId);
                    sessionBadKeys.add(key);
                }
            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with DeepSeek ${model}:`, e.message);
            }
        }
    }
    throw new Error('DeepSeek gagal: ' + lastError);
}

/**
 * Unified AI caller with fully automatic fallback mechanism
 */
async function callAI(prompt, teacherId = null) {
    const errors = [];
    const tryProvider = async (name, fn) => {
        try {
            const result = await fn();
            return result;
        } catch (e) {
            errors.push(`${name} gagal: ${e.message}`);
            console.warn(`[AI] ${name} failed (${e.message}), automatically falling back...`);
            return null;
        }
    };

    let result = await tryProvider('Gemini', () => callGeminiAI(prompt, teacherId));
    if (result) return result;

    result = await tryProvider('OpenRouter', () => callOpenRouterAI(prompt, teacherId));
    if (result) return result;

    result = await tryProvider('OpenAI', () => callOpenAI(prompt, teacherId));
    if (result) return result;

    result = await tryProvider('DeepSeek', () => callDeepSeekAI(prompt, teacherId));
    if (result) return result;

    if (errors.length === 0) {
        throw new Error('Tidak ada provider AI terkonfigurasi. Silakan tambahkan minimal satu API key.');
    }
    throw new Error('Semua provider AI gagal: ' + errors.join(' | '));
}

/**
 * Fetch an image from a URL and upload it to Supabase Storage
 */
/**
 * Save an external AI image to the local "images" folder
 */
async function saveAIImageLocally(url) {
    if (!url || typeof url !== 'string') return url;

    // Check if it's our internal placeholder URL or a pollinations URL
    const isInternalAI = url.startsWith('https://ai-image.local/prompt/');
    const isPollinations = url.includes('pollinations.ai');

    if (!isInternalAI && !isPollinations && !url.startsWith('http')) return url;

    try {
        let buffer;
        let contentType = 'image/jpeg';
        let fileName = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.jpg`;

        if (isInternalAI) {
            let prompt = decodeURIComponent(url.replace('https://ai-image.local/prompt/', ''));
            console.log(`[STORAGE] Generating internal AI photo for: ${prompt.substring(0, 80)}...`);

            // Clean prompt for real photos
            const photoPrompt = prompt.replace(/vector|minimalist|2d|clean educational|flat|illustration|style|drawing|sketch/gi, '').trim();

            // PRIORITY 1: OpenAI DALL-E (If keys available)
            if (!buffer && process.env.OPENAI_API_KEY) {
                const oaKeys = process.env.OPENAI_API_KEY.split(',').map(k => k.trim()).filter(Boolean);
                // Try both DALL-E 3 and DALL-E 2
                const oaModels = ["dall-e-2", "dall-e-3"];

                oa_loop:
                for (const model of oaModels) {
                    for (let i = 0; i < Math.min(oaKeys.length, 3); i++) {
                        const key = oaKeys[i];
                        try {
                            console.log(`[STORAGE] Trying OpenAI ${model} (Key ${i + 1})...`);
                            const res = await fetch('https://api.openai.com/v1/images/generations', {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    model: model,
                                    prompt: `${photoPrompt}, photograph`,
                                    n: 1,
                                    size: model === "dall-e-3" ? "1024x1024" : "512x512"
                                }),
                                signal: AbortSignal.timeout(25000)
                            });
                            if (res.ok) {
                                const data = await res.json();
                                const imageUrl = data.data?.[0]?.url;
                                if (imageUrl) {
                                    const imgRes = await fetch(imageUrl);
                                    if (imgRes.ok) {
                                        buffer = Buffer.from(await imgRes.arrayBuffer());
                                        contentType = imgRes.headers.get('content-type') || 'image/png';
                                        console.log(`[STORAGE] ✅ OpenAI ${model} SUCCESS!`);
                                        break oa_loop;
                                    }
                                }
                            } else {
                                const err = await res.json().catch(() => ({}));
                                console.warn(`[STORAGE] OpenAI ${model} Error: ${res.status} - ${err.error?.message || ''}`);
                            }
                        } catch (e) { }
                    }
                }
            }

            if (!buffer) {
                try {
                    const enhancedPrompt = `${photoPrompt}, photograph, high resolution`;
                    const pollUrl = `https://pollinations.ai/p/${encodeURIComponent(enhancedPrompt)}?width=1024&height=768&nologo=true`;
                    console.log(`[STORAGE] Trying Pollinations (Priority 2)...`);
                    const res = await fetch(pollUrl, {
                        method: 'GET',
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' },
                        signal: AbortSignal.timeout(30000)
                    });
                    if (res.ok && res.headers.get('content-type')?.includes('image')) {
                        buffer = Buffer.from(await res.arrayBuffer());
                        contentType = res.headers.get('content-type');
                        console.log(`[STORAGE] ✅ Pollinations SUCCESS!`);
                    } else {
                        console.warn(`[STORAGE] Pollinations Error: ${res.status}`);
                    }
                } catch (e) { console.warn(`[STORAGE] Pollinations Error: ${e.message}`); }
            }

            // PRIORITY 3: Random High-Quality Photo (Picsum) - Final Fallback
            if (!buffer) {
                try {
                    console.log(`[STORAGE] Using random photo fallback (Priority 3)...`);
                    const res = await fetch(`https://picsum.photos/1024/768?random=${Date.now()}`);
                    if (res.ok) {
                        buffer = Buffer.from(await res.arrayBuffer());
                        contentType = res.headers.get('content-type') || 'image/jpeg';
                        console.log(`[STORAGE] ✅ Picsum Fallback SUCCESS!`);
                    }
                } catch (e) { console.warn(`[STORAGE] Final fallback failed: ${e.message}`); }
            }
        } else {
            // External URL fetch (Pollinations, etc)
            // External URL fetch (Pollinations, etc)
            console.log(`[STORAGE] Fetching: ${url}`);
            const response = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });

            if (response.ok && response.headers.get('content-type')?.includes('image')) {
                buffer = Buffer.from(await response.arrayBuffer());
                contentType = response.headers.get('content-type');
            } else {
                console.warn(`[STORAGE] External fetch failed or not an image. Returning original URL.`);
                return url; // Don't save if it's not an image
            }
        }

        if (!buffer) return url;

        const imagesDir = path.join(rootPath, 'images');
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

        let ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
        if (ext === 'svg+xml') ext = 'svg';

        if (isInternalAI && !fileName.endsWith('.' + ext)) {
            fileName = fileName.replace(/\.[^.]+$/, '.' + ext);
        }

        const filePath = path.join(imagesDir, fileName);
        fs.writeFileSync(filePath, buffer);
        return `/images/${fileName}`;
    } catch (err) {
        console.error(`[STORAGE] Error saving image:`, err.message);
        return url;
    }
}

/**
 * Scan questions for external AI images and migrate them to Supabase
 */
async function processImagesInQuestions(questions) {
    if (!Array.isArray(questions)) return questions;

    for (const q of questions) {
        // Ensure q.images is always an array
        if (!Array.isArray(q.images)) q.images = [];

        // Handle q.image (legacy singular)
        if (q.image && typeof q.image === 'string' && (q.image.includes('pollinations.ai') || q.image.includes('ai-image.local') || q.image.startsWith('http'))) {
            const newPath = await saveAIImageLocally(q.image);
            q.image = newPath;
            if (!q.images.includes(newPath)) q.images.push(newPath);
        }

        // Handle q.images (array)
        for (let i = 0; i < q.images.length; i++) {
            if (typeof q.images[i] === 'string' && (q.images[i].includes('pollinations.ai') || q.images[i].includes('ai-image.local') || q.images[i].startsWith('http'))) {
                q.images[i] = await saveAIImageLocally(q.images[i]);
            }
        }

        // Handle images embedded in question text (HTML)
        if (q.text && q.text.includes('<img')) {
            // Updated regex to handle both single and double quotes
            const imgRegex = /<img[^>]+src=["']([^"'>]+)["']/gi;
            let match;
            const urlsToReplace = [];
            while ((match = imgRegex.exec(q.text)) !== null) {
                const url = match[1];
                if (url.includes('pollinations.ai') || url.includes('ai-image.local') || url.startsWith('http')) {
                    if (!urlsToReplace.includes(url)) urlsToReplace.push(url);
                }
            }

            for (const oldUrl of urlsToReplace) {
                const newUrl = await saveAIImageLocally(oldUrl);
                // Replace in text - use a global replacement to be safe
                q.text = q.text.split(oldUrl).join(newUrl);

                // Add to thumbnails array for the dashboard
                if (!q.images.includes(newUrl)) {
                    q.images.push(newUrl);
                }
            }
        }

        // Final cleanup: Ensure no duplicates in images array and they are strings
        q.images = [...new Set(q.images.filter(img => typeof img === 'string' && img.trim() !== ''))];
    }
    return questions;
}

/**
 * Scan HTML for external AI images and migrate them to Supabase
 */
async function processImagesInHtml(html) {
    if (!html || typeof html !== 'string' || !html.includes('<img')) return html;

    const imgRegex = /<img[^>]+src=["']([^"'>]+)["']/gi;
    let match;
    const urlsToReplace = [];
    while ((match = imgRegex.exec(html)) !== null) {
        const url = match[1];
        if (url.includes('pollinations.ai') || url.includes('ai-image.local')) {
            urlsToReplace.push(url);
        }
    }

    let processedHtml = html;
    for (const oldUrl of urlsToReplace) {
        const newUrl = await saveAIImageLocally(oldUrl);
        processedHtml = processedHtml.split(oldUrl).join(newUrl);
    }
    return processedHtml;
}

app.post('/api/generate-ai', async (req, res) => {
    const {
        materi,
        jumlah = 5,
        tipe = 'single',
        mapel = '',
        rombel = '',
        typeCounts = {},
        levelCounts = {},
        opsiGambar = 'none',
        teacherId = null
    } = req.body;

    if (!materi) return res.status(400).json({ error: 'Materi is required' });

    const normalizedCounts = {
        single: Number(typeCounts.single) || 0,
        multiple: Number(typeCounts.multiple) || 0,
        text: Number(typeCounts.text) || 0,
        tf: Number(typeCounts.tf) || 0,
        matching: Number(typeCounts.matching) || 0
    };

    const totalFromCounts = Object.values(normalizedCounts).reduce((sum, value) => sum + value, 0);
    const actualJumlah = totalFromCounts > 0 ? totalFromCounts : Number(jumlah) || 5;

    const typeLabels = {
        single: 'pilihan ganda',
        multiple: 'PG kompleks',
        text: 'uraian / esai',
        tf: 'benar/salah',
        matching: 'menjodohkan'
    };
    const typeDescriptions = {
        single: 'pilihan ganda biasa (1 jawaban benar)',
        multiple: 'pilihan ganda kompleks (2-3 jawaban benar dari 4 opsi ABCD)',
        text: 'isian / uraian singkat',
        tf: 'benar/salah (default 3 pernyataan per soal, minimal 1 pernyataan)',
        matching: 'menjodohkan'
    };

    const composition = Object.entries(normalizedCounts)
        .filter(([, value]) => value > 0)
        .map(([key, value]) => `${value} ${typeLabels[key] || key}`)
        .join(', ');

    const levelParts = [];
    const mudah = Number(levelCounts.mudah) || 0;
    const sedang = Number(levelCounts.sedang) || 0;
    const hots = Number(levelCounts.hots) || 0;
    if (mudah > 0) levelParts.push(`${mudah} mudah`);
    if (sedang > 0) levelParts.push(`${sedang} sedang`);
    if (hots > 0) levelParts.push(`${hots} HOTS`);

    let prompt = `Buatkan ${actualJumlah} soal `;
    if (composition) {
        prompt += `dengan komposisi ${composition} `;
    } else {
        prompt += `bertipe ${typeDescriptions[tipe] || 'pilihan ganda'} `;
    }
    prompt += `untuk mata pelajaran ${mapel} kelas ${rombel} tentang: ${materi}. `;
    if (levelParts.length > 0) {
        prompt += `Sebarkan level soal sebagai ${levelParts.join(', ')}. `;
    }

    if (opsiGambar === 'auto') {
        prompt += `\nUNTUK SETIAP SOAL (WAJIB ADA), sertakan ilustrasi gambar otomatis menggunakan tag HTML berikut HANYA di dalam field "text": <br><img src="https://ai-image.local/prompt/[VISUAL_DESCRIPTION]" alt="Ilustrasi AI" style="border-radius: 8px; margin: 15px 0; max-width: 100%;"><br>\nGantikan [VISUAL_DESCRIPTION] dengan deskripsi visual yang sangat detail DALAM BAHASA INGGRIS yang merangkum maksud soal tersebut. 
        Sertakan JUGA URL gambar yang sama ke dalam array "images" di root object JSON untuk soal tersebut. 
        SANGAT PENTING: 
        1. Gunakan gaya "flat vector educational illustration, clean lines, white background". 
        2. Pastikan anatomi manusia benar (HANYA 2 tangan, 2 kaki, 5 jari). HINDARI distorsi limb atau penambahan anggota tubuh yang tidak perlu.
        3. Deskripsi harus fokus pada akurasi teknis bukan artistik. 
        Contoh: "A professional flat vector illustration of a student sitting properly at a desk, simple clean lines, 2 hands visible, educational style, white background". `;
    } else if (opsiGambar === 'placeholder') {
        prompt += `\nUNTUK SETIAP SOAL (WAJIB ADA), sertakan placeholder HTML berikut di field "text": <div style="border: 2px dashed #cbd5e1; border-radius: 8px; padding: 20px; text-align: center; background-color: #f8fafc; margin: 15px 0;"><p style="font-weight: bold; color: #475569; margin: 0;">[Area Ilustrasi: DESKRIPSI_GAMBAR]</p></div>. Ganti DESKRIPSI_GAMBAR dengan nama objek gambar yang relevan. `;
    }

    prompt += '\nBalas HANYA dengan JSON array valid (dimulai dengan [ dan diakhiri dengan ]). JANGAN sertakan markdown, kode blok, preamble, atau penjelasan apapun di atas atau di bawah JSON. ';
    prompt += 'Format objek soal wajib memiliki: "type", "text" (boleh mengandung HTML <img>), "options" (array), "correct" (indeks angka atau array indeks), "images" (WAJIB array string berisi URL gambar). ';

    prompt += 'Contoh format: [{"text":"Pertanyaan?","options":["A","B","C","D"],"correct":0,"mapel":"' + mapel + '","rombel":"' + rombel + '","type":"single","images":[]}]. ';
    prompt += 'SANGAT PENTING: Untuk soal pilihan ganda biasa (type: "single") dan pilihan ganda kompleks (type: "multiple"), jumlah opsi jawaban WAJIB sebanyak 4 buah opsi (A, B, C, D). Tidak boleh lebih atau kurang. ';
    prompt += 'Untuk soal pilihan ganda kompleks (type: "multiple"), gunakan format visual "[ ] kalimat" untuk opsi-opsinya dalam output teks/HTML, namun dalam data JSON "correct" tetap sebagai array indeks (misal: [0, 2]). ';
    prompt += 'Sangat penting: Untuk soal PG Kompleks, berikan TEPAT 4 opsi pilihan (A, B, C, D) dan pastikan ada 2 atau 3 jawaban yang benar. ';
    prompt += 'Contoh JSON: {"type":"multiple","text":"Pertanyaan?","options":["[ ] Opsi A","[ ] Opsi B","[ ] Opsi C","[ ] Opsi D"],"correct":[0,2],"images":["url_gambar_jika_ada"]}. ';
    prompt += 'SANGAT PENTING untuk soal benar/salah (type: "tf"): Field "text" HANYA berisi instruksi (misal: "Tentukan apakah pernyataan berikut Benar atau Salah:"), dan SEMUA pernyataan yang akan dinilai WAJIB masuk ke array "options". Secara default buat 3 pernyataan per soal, namun 1 atau 2 pernyataan juga diperbolehkan. Field "correct" berisi array boolean (true/false) sesuai urutan pernyataan di options. Contoh 3 pernyataan: {"type":"tf","text":"Pilihlah Benar atau Salah:","options":["Pernyataan 1","Pernyataan 2","Pernyataan 3"],"correct":[true,false,true]}. Contoh 1 pernyataan: {"type":"tf","text":"Pilihlah Benar atau Salah:","options":["Pernyataan 1"],"correct":[true]}. JANGAN meletakkan pernyataan di dalam field "text".';
    prompt += 'Untuk soal menjodohkan (matching) SANGAT PENTING: JANGAN gunakan opsi A, B, C, D atau skema pilihan ganda (seperti 1-A, 2-B). Soal menjodohkan WAJIB menggunakan "questions" sebagai array pertanyaan kiri, "answers" sebagai array jawaban kanan (termasuk pengecoh), dan "correct" sebagai array string jawaban yang benar sesuai urutan questions. ';
    prompt += 'Contoh format menjodohkan: {"type":"matching","questions":["Pantun","Gurindam"],"answers":["Rima a-b-a-b","Rima a-a","Pengecoh"],"correct":["Rima a-b-a-b","Rima a-a"]}. ';
    prompt += 'SANGAT PENTING untuk soal uraian/esai (type: "text"): Letakkan pertanyaan di field "text", biarkan "options" sebagai array kosong [], dan WAJIB sertakan kunci jawaban atau contoh jawaban yang benar di field "correct" sebagai string. Contoh: {"type":"text","text":"Apa yang dimaksud dengan ekosistem?","options":[],"correct":"Ekosistem adalah hubungan timbal balik antara makhluk hidup dengan lingkungannya."}.';

    console.log(`[/api/generate-ai] Request: mapel=${mapel}, rombel=${rombel}, jumlah=${actualJumlah}, tipe=${tipe}, opsiGambar=${opsiGambar}`);

    try {
        let text = await callAI(prompt, teacherId);

        // Clean up JSON response
        text = text.replace(/```json\n?|```/g, '').trim();
        const match = text.match(/\[[\s\S]*\]/);

        const parsePlainTextToQuestions = (raw, requestedType) => {
            const lines = raw.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length === 0) return [];

            const isProbablyTf = requestedType === 'tf' || /benar\/?salah|b\/s|b s|benar salah/i.test(raw);
            if (!isProbablyTf) return [];

            const statements = [];
            let questionText = '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (/^nomor soal\b/i.test(line)) continue;
                if (/^(berikut ini|berikut|soal|tentang|mengenai|pilihlah|jawablah)\b/i.test(line)) {
                    continue;
                }
                if (/^pernyataan\s*\d+/i.test(line)) {
                    if (i + 1 < lines.length) {
                        const nextLine = lines[i + 1].trim();
                        if (!/^pernyataan\s*\d+/i.test(nextLine)) {
                            statements.push(nextLine);
                            i++;
                            continue;
                        }
                    }
                    continue;
                }
                if (/^(?:benar|salah|true|false|ya|tidak|yes|no)\b/i.test(line)) continue;
                const numbered = line.replace(/^[0-9]+\.\s*/, '').replace(/^[-*]\s*/, '').trim();
                statements.push(numbered);
            }

            if (statements.length === 0) return [];

            return [{
                type: 'tf',
                text: questionText || 'Tentukan apakah pernyataan berikut Benar atau Salah:',
                options: statements,
                correct: statements.map(() => false),
                mapel,
                rombel
            }];
        };

        let parsed;
        if (!match) {
            console.warn('[/api/generate-ai] AI returned no JSON array. Attempting plain text fallback...');
            const fallback = parsePlainTextToQuestions(text, tipe);
            if (fallback.length > 0) {
                parsed = fallback;
            } else {
                console.error('[/api/generate-ai] AI returned no JSON array. Raw response:', text.substring(0, 200));
                return res.status(500).json({ error: 'AI tidak mengembalikan data soal yang valid. Coba lagi.' });
            }
        } else {
            parsed = JSON.parse(match[0]);
        }

        // Normalize question formats
        let normalizedQuestions = parsed.map(q => fullNormalizeQuestion(q, mapel, rombel));

        // PROCESS IMAGES: Migrate pollination.ai urls to Supabase
        normalizedQuestions = await processImagesInQuestions(normalizedQuestions);

        // Filter out invalid questions
        const originalCount = normalizedQuestions.length;
        normalizedQuestions = normalizedQuestions.filter(q => {
            if (q.type === 'tf') {
                return Array.isArray(q.options) && q.options.length >= 1 && Array.isArray(q.correct) && q.correct.length >= 1;
            }
            if (q.type === 'multiple') {
                return Array.isArray(q.correct) && q.correct.length >= 2 && q.correct.length <= 3;
            }
            return true;
        });
        console.log(`[/api/generate-ai] Filtered ${originalCount - normalizedQuestions.length} invalid questions. Remaining: ${normalizedQuestions.length}`);

        console.log(`[/api/generate-ai] Success: generated ${normalizedQuestions.length} questions`);
        return res.json({ ok: true, questions: normalizedQuestions });
    } catch (e) {
        console.error('[/api/generate-ai] Fatal error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// ─── API: Generate Admin Doc ──────────────────────────────────────────────────
app.post('/api/generate-admin-doc', upload.single('blueprint'), async (req, res) => {
    let { type, mapel, fase, semester, topik, topic, target, schoolName, teacherName, address } = req.body;
    const extraData = { ...req.body };
    type = type || target;
    topik = topik || topic;

    // Ambil Pengaturan Sekolah
    const schoolSettings = sqlDb.getSchoolSettings() || {};
    const effectiveSchoolName = schoolName || schoolSettings.name || 'Nama Sekolah';
    const effectiveAddress = address || schoolSettings.address || '';
    const effectiveTeacherName = teacherName || (schoolSettings.principal ? `Guru (${schoolSettings.principal})` : 'Guru Mata Pelajaran');

    console.log(`[/api/generate-admin-doc] Request: type=${type}, mapel=${mapel}, fase=${fase}, semester=${semester}, topik=${topik}, target=${target}, hasFile=${!!req.file}`);

    // Validation: Mata Pelajaran wajib
    if (!mapel) {
        return res.status(400).json({ error: 'Mata Pelajaran wajib diisi.' });
    }

    // Validation: Input requirements based on type
    const formatLkpd = extraData?.formatLkpd;
    const isLkpdOtomatis = type === 'lkpd' && formatLkpd === 'otomatis';

    if (isLkpdOtomatis) {
        // For LKPD otomatis, file (RPP) is REQUIRED, topik is optional
        if (!req.file) {
            return res.status(400).json({ error: 'File RPP wajib diunggah untuk membuat LKPD Otomatis.' });
        }
    } else {
        // For other types, require either topik or file
        if (!topik && !req.file) {
            return res.status(400).json({ error: 'Mohon masukkan Topik atau Upload File Materi Referensi.' });
        }
    }

    let blueprintText = "";
    if (req.file) {
        try {
            const rawText = await parseBlueprint(req.file.buffer, req.file.originalname);
            blueprintText = rawText.substring(0, 50000); // Increased limit for standalone build
            console.log(`[AI Blueprint] Extracted ${blueprintText.length} characters from ${req.file.originalname}`);
        } catch (parseErr) {
            console.error('[AI Blueprint] Error parsing file:', parseErr.message);
        }
    }

    let promptText = '';
    let docType = '';

    const topicHint = topik ? `materi/topik "${topik}"` : 'materi yang relevan sesuai dokumen referensi';

    if (type === 'atp-cp') {
        docType = `Capaian Pembelajaran (CP) and Alur Tujuan Pembelajaran (ATP)`;
        promptText = `Buatkan rumusan ${docType} untuk mata pelajaran ${mapel} kelas/fase ${fase} semester ${semester} dengan ${topicHint}. Sertakan Elemen, Capaian Pembelajaran, Tujuan Pembelajaran, dan Alur Tujuan Pembelajaran secara sistematis dalam bentuk paragraf atau tabel sesuai standar Kurikulum Merdeka.`;
    } else if (type === 'kktp') {
        docType = `Kriteria Ketercapaian Tujuan Pembelajaran (KKTP)`;
        promptText = `Buatkan rancangan ${docType} (berupa rubrik penilaian/deskripsi ketercapaian) untuk mata pelajaran ${mapel} kelas/fase ${fase} dengan ${topicHint}. Standar pengisian mengikuti Kurikulum Merdeka, cantumkan Interval Nilai dan Deskripsinya.`;
    } else if (type === 'modul-ajar') {
        docType = `Modul Ajar (RPP Plus)`;
        promptText = `Buatkan draf Modul Ajar untuk kelas/fase ${fase} mata pelajaran ${mapel} semester ${semester} mengenai ${topicHint}. Alokasi waktu cadangan: ${extraData?.waktu || '2 x 40 Menit'}. Gunakan Model Pembelajaran: ${extraData?.model || 'Problem Based Learning'}. Berisikan Identitas, Kompetensi Awal, Profil Pelajar Pancasila, Kegiatan Pendahuluan, Kegiatan Inti, Kegiatan Penutup, dan Asesmen secara rinci.`;
    } else if (type === 'rpp') {
        docType = `Rencana Pelaksanaan Pembelajaran (RPP)`;

        const formatRPP = extraData?.formatRpp || 'merdeka';
        let formatInstruction = '';

        if (formatRPP === 'merdeka') {
            formatInstruction = `Gunakan format Kurikulum Merdeka dengan struktur lengkap berikut:
A. CAPAIAN PEMBELAJARAN - Jelaskan elemen dan capaian pembelajaran yang dirujuk dari Kurikulum Merdeka
B. TUJUAN PEMBELAJARAN - Rumuskan tujuan pembelajaran yang terukur dan observable dengan kata kerja operasional
C. MATERI PEMBELAJARAN - Jabarkan materi pokok yang akan diajarkan secara sistematis
D. METODE/MODEL PEMBELAJARAN - Uraikan metode pembelajaran yang digunakan (${extraData?.model || 'Problem Based Learning'})
E. MEDIA DAN SUMBER BELAJAR - Sebutkan media pembelajaran, alat, dan sumber belajar yang relevan
F. LANGKAH-LANGKAH PEMBELAJARAN - Jelaskan kegiatan pembelajaran tahap demi tahap:
   - Pendahuluan (apersepsi, motivasi, penyampaian tujuan) ±5 menit
   - Inti (aktivitas eksplorasi, elaborasi, konfirmasi) ±${extraData?.waktu || '30 menit'}
   - Penutup (kesimpulan, refleksi, tindak lanjut) ±5 menit
G. PENILAIAN (ASESMEN) - Jelaskan strategi, teknik, dan bentuk penilaian yang akan digunakan
H. LEMBAR INSTRUMEN PENILAIAN - Sediakan instrumen penilaian konkret (rubrik, checklist, atau kunci jawaban)
I. REFLEKSI GURU - Berikan template untuk refleksi diri guru pasca pembelajaran
J. LEMBAR KERJA PESERTA DIDIK (LKPD) - Sediakan LKPD interaktif yang mencakup:
   - Identitas peserta didik (nama, kelas, nomor absen, tanggal)
   - Tujuan pembelajaran singkat
   - Alat dan bahan (jika relevan)
   - Langkah-langkah aktivitas/percobaan/diskusi
   - Pertanyaan pemantik dan tugas untuk dikerjakan peserta didik
   - Ruang untuk kesimpulan dan refleksi peserta didik
   Pastikan LKPD dirancang untuk mendukung kegiatan pembelajaran interaktif dan mengembangkan pemikiran kritis peserta didik.

Pastikan setiap bagian jelas, terukur, dan sesuai dengan standar Kurikulum Merdeka.`;
        } else if (formatRPP === 'k13') {
            formatInstruction = 'Gunakan format Kurikulum 2013 dengan komponen: Identitas, Standar Kompetensi, Kompetensi Dasar, Indikator Pencapaian, Tujuan Pembelajaran, Materi Pokok, Metode Pembelajaran, Alokasi Waktu, Langkah-langkah Pembelajaran (Pendahuluan, Inti, Penutup), Media/Alat/Sumber Belajar, dan Penilaian.';
        } else if (formatRPP === 'ringkas') {
            formatInstruction = 'Buat RPP Ringkas dalam format 1 halaman maksimal. Fokus pada hal-hal esensial: Tujuan Pembelajaran singkat, Langkah Pembelajaran (Pendahuluan-Inti-Penutup) secara ringkas, dan Penilaian sederhana. Hindari penjelasan yang terlalu panjang.';
        } else if (formatRPP === 'detail') {
            formatInstruction = 'Buat RPP Detail dan Lengkap dengan penjelasan menyeluruh. Sertakan Identitas, Capaian Pembelajaran, Tujuan Pembelajaran, Indikator Ketercapaian, Materi Pembelajaran, Pendekatan/Strategi Pembelajaran, Langkah-langkah Pembelajaran (Pendahuluan dengan apersepsi, Inti dengan aktivitas detail, Penutup dengan refleksi), Media dan Sumber Belajar, dan Asesmen (Formatif & Sumatif) dengan rubrik penilaian yang jelas.';
        }

        promptText = `Buatkan Rencana Pelaksanaan Pembelajaran (RPP) yang baik dan efektif untuk kelas/fase ${fase} mata pelajaran ${mapel} mengenai ${topicHint}. Alokasi waktu: ${extraData?.waktu || '2 x 40 Menit'}. Gunakan Model Pembelajaran: ${extraData?.model || 'Problem Based Learning'}. ${formatInstruction}`;
    } else if (type === 'prota-promes') {
        docType = `Prota dan Promes`;
        promptText = `Rancang secara ringkas Program Tahunan (Prota) and Program Semester (Promes) pada mata pelajaran ${mapel} fase ${fase} semester ${semester} mengenai ${topicHint}. Total Pekan Efektif yang direncanakan: ${extraData?.pekan || '18'} Pekan.`;
    } else if (type === 'kisi-kisi') {
        docType = `Kisi-kisi Ujian`;
        promptText = `Buatkan ${docType} (Bentuk: ${extraData?.jenis || 'Soal Ujian Tertulis'}) untuk mata pelajaran ${mapel} ${topicHint} fase ${fase}. Sajikan dalam bentuk format matriks yang merinci: Indikator Soal, Level Kognitif (seperti L1/L2/L3 atau C1-C6), and Bentuk Soal.`;
    } else if (type === 'soal-jawaban' || type === 'soal-pintar') {
        docType = `Soal Pintar`;
        const levelInfo = `Komposisi Level: Mudah (${extraData?.levelMudah || 0}), Sedang (${extraData?.levelSedang || 0}), HOTS (${extraData?.levelHots || 0})`;
        promptText = `Buatkan instrumen Soal Pintar (Jenis: ${extraData?.jenis || 'Ulangan Harian'}) untuk mata pelajaran ${mapel} fase ${fase} ${topicHint}. Rincian jumlah dan bentuk soal yang diharapkan adalah: ${extraData?.jumlahPerBentuk || '5 soal Pilihan Ganda'}. ${levelInfo}. Berikan juga pembahasan singkat untuk masing-masing soal.`;

        if (extraData?.opsiGambar === 'placeholder') {
            promptText += `\nUntuk soal yang memerlukan ilustrasi gambar, JANGAN gunakan placeholder gambar biasa. Gunakan blok HTML berikut sebagai "Area Ilustrasi" agar terlihat profesional:\n<div style="border: 2px dashed #cbd5e1; border-radius: 8px; padding: 20px; text-align: center; background-color: #f8fafc; margin: 15px 0;"><i class="fas fa-image" style="font-size: 32px; color: #94a3b8; margin-bottom: 10px; display: block;"></i><p style="font-weight: bold; color: #475569; margin: 0; font-size: 14px;">[Area Ilustrasi: DESKRIPSI_GAMBAR]</p><p style="font-size: 11px; color: #94a3b8; margin-top: 5px;">(Guru dapat menyisipkan gambar spesifik di sini)</p></div>\nGanti teks DESKRIPSI_GAMBAR dengan nama/objek gambar yang relevan (misal: "Struktur Akar Tumbuhan").`;
        } else if (extraData?.opsiGambar === 'auto') {
            promptText += `\nUNTUK SETIAP SOAL (WAJIB ADA), tampilkan gambar asli secara otomatis menggunakan tag HTML ini: <br><img src="https://ai-image.local/prompt/[VISUAL_DESCRIPTION]" alt="Ilustrasi AI" style="border-radius: 8px; margin: 15px 0; max-width: 100%; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); border: 1px solid #e2e8f0;">\nGantikan [VISUAL_DESCRIPTION] dengan deskripsi visual yang sangat detail DALAM BAHASA INGGRIS yang merangkum maksud soal tersebut. 
            INSTRUKSI KETAT:
            1. Gaya harus "clean educational 2D vector graphic, minimalist style, white background".
            2. WAJIB menjaga anatomi manusia tetap normal (2 lengan, 2 kaki, proporsional). JANGAN membuat pose yang terlalu kompleks yang bisa menyebabkan distorsi AI.
            3. Tambahkan keyword "high quality, simple, clear labels if needed" dalam deskripsi tersebut.`;
        }

        if (extraData?.generateKisiKisi) {
            promptText += `\n\nPenting: Berdasarkan soal-soal yang Anda buat, buatkan juga matriks KISI-KISI UJIAN yang menjadi panduannya (Lengkap dengan Indikator Soal dan Level Kognitif) and tampilkan matriks tersebut pada bagian PALING ATAS / AWAL dari dokumen sebelum daftar soal.`;
        }

        if (extraData?.pisahLembar) {
            promptText += `\nPenting: Karena fitur 'Pisahkan Halaman' diaktifkan, Anda WAJIB menyisipkan tag HTML ini: <div style="page-break-before: always;"></div> tepat sebelum judul "KUNCI JAWABAN" dimulai.`;
        } else {
            promptText += `\nPenting: Karena fitur 'Pisahkan Halaman' TIDAK diaktifkan, letakkan bagian "KUNCI JAWABAN" tepat di atas / sebelum bagian "PEMBAHASAN" agar terkumpul rapi di akhir halaman.`;
        }

        if (extraData?.simpanBank) {
            promptText += `\nSANGAT PENTING (INSTRUKSI DATABASE): Pada bagian PALING AKHIR dokumen HTML Anda, sematkan array JSON data soal-soal tersebut HANYA di dalam tag ini persis: <script id="ai-json-data" type="application/json"> [ARRAY_JSON] </script>. ARRAY_JSON adalah format pertanyaan seperti ini: { "text": "Pertanyaan?", "options": ["[ ] A", "[ ] B"], "correct": [0,1], "type": "multiple", "mapel": "${mapel}", "rombel": "${fase}", "images": ["URL_GAMBAR"] }.
WAJIB GUNAKAN TYPE BERIKUT: "single" (PG), "multiple" (PG Kompleks), "text" (Uraian), "tf" (Benar/Salah), "matching" (Menjodohkan). 
SANGAT PENTING: Untuk tipe "single" (PG) dan "multiple" (PG Kompleks), jumlah opsi jawaban di array options WAJIB TEPAT 4 BUAH OPSI (A, B, C, D), tidak boleh lebih maupun kurang.
SANGAT PENTING: Khusus untuk tipe "multiple" (PG Kompleks), gunakan format visual "[ ] kalimat" di dalam array options dan sertakan minimal 2-3 indeks jawaban benar di dalam array "correct".
SANGAT PENTING: Khusus untuk tipe "text" (Uraian), field "correct" WAJIB diisi dengan teks kunci jawaban, dan "options" harus array kosong [].`;
        }
    } else if (type === 'ppt-pintar') {
        docType = `Presentasi PPT Pintar`;
        const slideCount = extraData?.jumlahSlide || '10';
        const gaya = extraData?.gayaPPT || 'modern';
        const audiens = extraData?.audiensPPT || 'siswa';

        promptText = `Buatkan struktur presentasi PowerPoint (PPT) yang menarik dan edukatif tentang ${topicHint} untuk ${audiens} dengan gaya ${gaya}. 
        Buatkan sebanyak ${slideCount} slide.
        
        Sangat Penting: Balas HANYA dengan JSON array di dalam tag <script id="ppt-data" type="application/json"> [ARRAY_JSON] </script>.
        Format ARRAY_JSON: [{"title": "Judul Slide", "items": ["Poin 1", "Poin 2"], "content": "Penjelasan opsional"}, ...].
        Pastikan slide pertama adalah slide judul dan slide terakhir adalah penutup/terima kasih.
        Jangan berikan teks penjelasan lain di luar tag script tersebut.`;
    } else if (type === 'lkpd') {
        docType = `Lembar Kerja Peserta Didik (LKPD)`;

        const formatLKPD = extraData?.formatLkpd || 'diskusi';

        if (formatLKPD === 'otomatis') {
            // LKPD Otomatis dari RPP - Auto-detect jumlah aktivitas dari kegiatan RPP
            docType = `Lembar Kerja Peserta Didik (LKPD) Otomatis dari RPP`;

            promptText = `Anda WAJIB membaca dokumen RPP (Rencana Pelaksanaan Pembelajaran) yang diberikan dengan SANGAT TELITI terlebih dahulu! 
        
TUGAS ANDA: Buatkan sebuah ${docType} yang SEPENUHNYA bersumber dari RPP tersebut, mencakup:
        
1. TUJUAN PEMBELAJARAN: Ambil dari RPP, sesuaikan menjadi bahasa peserta didik.
2. AKTIVITAS/PERCOBAAN/DISKUSI: Buat aktivitas pembelajaran yang dirancang berdasarkan langkah-langkah pembelajaran (Kegiatan Inti) dari RPP. JUMLAH AKTIVITAS disesuaikan otomatis dengan:
   - Jumlah fase/tahapan dalam kegiatan inti RPP
   - Jumlah pembelajaran objectives di RPP
   - Kompleksitas materi dan alokasi waktu
   JANGAN membuat kurang dari 3 aktivitas dan tidak lebih dari 8 aktivitas. Tipe aktivitas menyesuaikan dengan metode pembelajaran dalam RPP.
3. PERTANYAAN PEMANDU: Buat pertanyaan yang mendorong pemahaman sesuai indikator capaian di RPP.
4. RUANG PENGERJAAN: Sediakan tempat siswa menulis jawaban, observasi, atau hasil analisis.
5. KESIMPULAN & REFLEKSI: Dorong siswa merangkum pembelajaran dan merefleksikan pemahaman mereka.

KOMPONEN LKPD YANG WAJIB ADA:
- Identitas peserta didik (Nama, Kelas, No. Absen, Tanggal)
- Tujuan pembelajaran singkat
- Alat dan bahan (jika dari RPP ada percobaan/praktikum)
- Langkah-langkah aktivitas yang jelas, terukur, dan mengikuti urutan dari RPP
- Pertanyaan pemantik dan tugas untuk dikerjakan peserta didik
- Ruang untuk pengamatan/pencatatan/jawaban
- Kesimpulan dan refleksi peserta didik

SANGAT PENTING: 
- Pastikan LKPD ini BENAR-BENAR sesuai dengan isi, metode, alokasi waktu, dan tujuan pembelajaran dari RPP yang diunggah.
- Jangan menambahkan materi/aktivitas yang TIDAK ada dalam RPP.
- Bahasa harus mudah dipahami siswa fase ${fase}.
- Desain LKPD rapi, menarik, dan mendorong keterlibatan siswa aktif dalam pembelajaran.
- Rancang agar LKPD dapat diselesaikan dalam alokasi waktu yang tersedia di RPP.
- AUTO-DETECT jumlah aktivitas: jangan hardcode, sesuaikan dengan kegiatan pembelajaran yang ada di RPP.`;
        } else {
            // LKPD Manual dengan berbagai tipe
            let tipeAktivitas = '';

            if (formatLKPD === 'diskusi') {
                tipeAktivitas = 'Jenis: LKPD Diskusi & Refleksi. Berisi pertanyaan pemandu diskusi, aktivitas brainstorming, dan refleksi pemahaman siswa. Fokus pada pengembangan pemikiran kritis melalui dialog dan tukar pendapat.';
            } else if (formatLKPD === 'eksperimen') {
                tipeAktivitas = 'Jenis: LKPD Eksperimen/Praktikum. Berisi prosedur percobaan yang jelas, tabel pengamatan, analisis hasil, dan pertanyaan yang mendorong siswa menemukan konsep. Sertakan alat dan bahan yang diperlukan.';
            } else if (formatLKPD === 'proyek') {
                tipeAktivitas = 'Jenis: LKPD Berbasis Proyek. Berisi deskripsi proyek, langkah-langkah pengerjaan, kriteria keberhasilan, dan hasil yang diharapkan. Dorong kolaborasi dan kreativitas siswa dalam menghasilkan produk nyata.';
            } else if (formatLKPD === 'pemecahan') {
                tipeAktivitas = 'Jenis: LKPD Pemecahan Masalah. Berisi studi kasus atau masalah nyata, pertanyaan analitis bertingkat, panduan strategi pemecahan, dan aplikasi solusi. Fokus pada HOTS (Higher Order Thinking Skills).';
            } else if (formatLKPD === 'analisis') {
                tipeAktivitas = 'Jenis: LKPD Analisis Data. Berisi data/informasi yang perlu dianalisis (tabel, grafik, artikel, dll), pertanyaan penginvestigasian, lembar kerja untuk analisis, dan kesimpulan. Mengembangkan kemampuan interpretasi dan komunikasi data.';
            }

            promptText = `Buatkan sebuah ${docType} (Student Worksheet) yang komprehensif untuk kelas/fase ${fase} mata pelajaran ${mapel} mengenai ${topicHint}. Alokasi waktu: ${extraData?.waktu || '2 x 40 Menit'}. ${tipeAktivitas}
            LKPD harus menarik, interaktif, dan memuat komponen: 1. Identitas (Nama, Kelas, No. Absen, Tanggal), 2. Tujuan Pembelajaran, 3. Alat dan Bahan (jika relevan), 4. Langkah-langkah Aktivitas / Percobaan / Diskusi, 5. Pertanyaan Pemantik / Tugas, 6. Kesimpulan dan Refleksi.
            Rancang agar siswa aktif berpikir kritis dan berkolaborasi dalam menyelesaikan masalah sesuai materi tersebut.`;
        }
    } else {
        return res.status(400).json({ error: 'Tipe dokumen tidak valid' });
    }

    let blueprintContext = "";
    if (blueprintText) {
        // For LKPD otomatis, treat the file as RPP content
        if (type === 'lkpd' && extraData?.formatLkpd === 'otomatis') {
            blueprintContext = `DOKUMEN RPP (RENCANA PELAKSANAAN PEMBELAJARAN):\n====\n${blueprintText}\n====\nGunakan konten RPP di atas sebagai sumber utama untuk membuat LKPD. Ikuti tujuan pembelajaran, metode, alokasi waktu, dan langkah-langkah pembelajaran yang tercantum dalam RPP ini.\n\n`;
        } else {
            blueprintContext = `REFERENSI DOKUMEN GURU (BLUEPRINT/KISI-KISI):\n====\n${blueprintText}\n====\nSANGAT PENTING: Gunakan teks referensi di atas sebagai satu-satunya panduan materi, indikator, dan bentuk soal. Sesuaikan hasil generate dengan apa yang tertulis dalam dokumen referensi tersebut.\n\n`;
        }
    }

    const fullPrompt = `Identitas Sekolah: ${effectiveSchoolName}${effectiveAddress ? `, ${effectiveAddress}` : ''}. Guru Pengampu: ${effectiveTeacherName}.\n\n${blueprintContext}${promptText}${extraData?.contextAI ? `\n\nKONTEKS INSTRUKSI TAMBAHAN:\n${extraData.contextAI}` : ''}

PERINTAH FORMATTING: 
Tulis output HANYA MENGGUNAKAN tag HTML (tanpa tag <html>, <head>, atau <body>) agar saya bisa langsung menampilkannya di div innerHTML. Gunakan tag <h1>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <p>, dan <table> (untuk data matriks).
Berikan juga CSS inline jika dibutuhkan untuk struktur tabel (seperti: <table border="1" style="width:100%; border-collapse: collapse; text-align: left; margin-bottom: 20px;"><tr><th style="padding: 8px; background: #f1f5f9;">...</th></tr>).
DILARANG memberikan kalimat pembuka atau penutup di luar tag HTML. DILARANG menggunakan markdown block (seperti \`\`\`html). Output harus 100% kode HTML mentah.`;

    try {
        let text = await callAI(fullPrompt, req.body.teacherId || null);

        if (typeof text !== 'string') {
            console.warn('[/api/generate-admin-doc] AI returned non-string response, converting to string.');
            text = String(text || '');
        }

        // Membersihkan markdown wrapper (```html ... ```)
        text = text.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();

        // PROCESS IMAGES: Migrate pollination.ai urls in HTML to Supabase
        try {
            text = await processImagesInHtml(text);
            const imgDebugMatch = text.match(/<img[^>]+src=["']([^"'>]+)["']/gi);
            if (imgDebugMatch) {
                console.log('[/api/generate-admin-doc] Found images in result:', imgDebugMatch.slice(0, 3));
            } else {
                console.log('[/api/generate-admin-doc] No images found in final HTML');
            }
        } catch (imgErr) {
            console.error('[/api/generate-admin-doc] processImagesInHtml failed:', imgErr.message || imgErr);
        }

        let parsedQuestions = null;
        let addedCount = 0;
        const simpanBank = String(extraData?.simpanBank) === 'true';

        if (simpanBank) {
            const match = text.match(/<script id="ai-json-data"[^>]*>([\s\S]*?)<\/script>/i);
            if (match && match[1]) {
                try {
                    parsedQuestions = JSON.parse(match[1].trim());

                    if (!Array.isArray(parsedQuestions)) {
                        throw new Error('AI JSON bank data is not an array');
                    }

                    // Inject basic standard properties and full normalization
                    parsedQuestions = parsedQuestions.map(q => fullNormalizeQuestion(q, mapel, fase));

                    // PROCESS IMAGES: Migrate pollination.ai urls in Bank Soal questions to Supabase
                    parsedQuestions = await processImagesInQuestions(parsedQuestions);

                    addedCount = 0;
                    if (parsedQuestions && parsedQuestions.length > 0) {
                        for (const q of parsedQuestions) {
                            try {
                                sqlDb.addQuestion(q);
                                addedCount++;
                            } catch (err) {
                                console.error('[AI Bank Soal] Failed to add individual question:', err.message);
                            }
                        }
                        console.log(`[AI Bank Soal] Successfully added ${addedCount} questions to database.`);
                    } else {
                        console.warn('[AI Bank Soal] No questions found in parsed AI data.');
                    }

                    // Hilangkan tag script dari HTML render
                    text = text.replace(match[0], '');
                } catch (parseError) {
                    console.error('[AI Bank Soal] Failed to parse generated JSON:', parseError);
                    parsedQuestions = null;
                }
            }
        }

        // Cek apakah ada data script PPT
        let pptSlides = null;
        const pptMatch = text.match(/<script id="ppt-data"[^>]*>([\s\S]*?)<\/script>/i);
        if (pptMatch && pptMatch[1]) {
            try {
                pptSlides = JSON.parse(pptMatch[1].trim());
                // Hilangkan tag script dari HTML render jika ada
                text = text.replace(pptMatch[0], '');
            } catch (err) {
                console.error('[AI PPT] Failed to parse slides:', err);
            }
        }

        console.log(`[/api/generate-admin-doc] Success for ${docType}`);
        return res.json({
            ok: true,
            html: text,
            slides: pptSlides,
            savedToBankSoal: !!parsedQuestions,
            savedCount: typeof addedCount !== 'undefined' ? addedCount : 0
        });
    } catch (e) {
        console.error('[/api/generate-admin-doc] Fatal error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// ─── API: Generate Quizz AI ───────────────────────────────────────────────────
app.post('/api/generate-quizz-ai', async (req, res) => {
    const { topic, count = 5, teacherId = null } = req.body;
    if (!topic) return res.status(400).json({ error: 'Topic is required' });

    const prompt = `Buatkan soal kuis edukatif interaktif bergaya game (seperti Kahoot) tentang topik "${topic}". Jumlah soal: ${count}.\n` +
        `Berikan output dalam format JSON array of objects secara langsung tanpa awalan atau blok markdown (misalnya tanpa \`\`\`json). Properti yang harus ada:\n` +
        `- question: teks pertanyaan\n` +
        `- answers: array [string, string, string, string] berisi persis 4 pilihan jawaban yang salah satunya benar\n` +
        `- correct: indeks (0, 1, 2, atau 3) dari jawaban yang benar\n\n` +
        `Soal harus mendidik, menarik, dan bahasanya ramah untuk siswa.`;

    try {
        let text = await callAI(prompt, teacherId);

        // Clean up JSON response
        text = text.replace(/```json\n?|```/g, '').trim();
        const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (!match) return res.status(500).json({ error: 'No JSON array in AI response' });

        const parsed = JSON.parse(match[0]);
        return res.json({ ok: true, questions: parsed });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ─── API: Kisi-kisi Generate ──────────────────────────────────────────────────
app.post('/api/generate-kisi-kisi', async (req, res) => {
    const { questions, mapel = '', rombel = '', teacherId = null } = req.body;
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: 'Questions are required' });
    }

    const limitedQuestions = questions.slice(0, 50);
    const questionsText = limitedQuestions.map((q, i) => `[${i + 1}] ${q.text} (Type: ${q.type || 'single'})`).join('\n');

    const prompt = `Analisis soal-soal berikut dan buatkan matriks Kisi-kisi Ujian untuk mata pelajaran ${mapel} kelas ${rombel}.\n` +
        `Berikan output dalam format JSON array of objects dengan properti:\n` +
        `- no: nomor urut (1, 2, ...)\n` +
        `- kd: Kompetensi Dasar (analisis dari konten soal)\n` +
        `- materi: materi pokok\n` +
        `- indikator: indikator soal\n` +
        `- level: level kognitif (L1, L2, L3)\n` +
        `- no_soal: nomor soal asli\n` +
        `- bentuk: bentuk soal (PG, PGK, Isian, Menjodohkan)\n\n` +
        `Soal-soal:\n${questionsText}\n\n` +
        `Hanya kembalikan JSON array saja tanpa markdown code block.`;

    try {
        let text = await callAI(prompt, teacherId);

        // Clean up JSON response
        text = text.replace(/```json\n?|```/g, '').trim();
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) return res.status(500).json({ error: 'No JSON array in AI response' });

        const parsed = JSON.parse(match[0]);
        return res.json({ ok: true, kisiKisi: parsed });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ─── API: AI Essay Correction ─────────────────────────────────────────────────
app.post('/api/ai-correct-essay', async (req, res) => {
    const { questionText, studentAnswer, referenceAnswer, teacherId = null } = req.body;

    if (!questionText) {
        return res.status(400).json({ error: 'questionText diperlukan' });
    }
    if (!studentAnswer || studentAnswer.trim() === '') {
        return res.json({ ok: true, score: 0, feedback: 'Siswa tidak memberikan jawaban.' });
    }

    const prompt = `Kamu adalah guru pengoreksi soal esai/uraian yang berpengalaman. Berikan penilaian objektif terhadap jawaban siswa berikut ini.

SOAL:
${questionText}

${referenceAnswer ? `KUNCI JAWABAN / JAWABAN REFERENSI:\n${referenceAnswer}\n\n` : ''}JAWABAN SISWA:
${studentAnswer}

INSTRUKSI PENILAIAN:
- Berikan skor antara 0 sampai 5 (bilangan bulat atau desimal dengan 1 angka di belakang koma).
  - 0 = Tidak menjawab atau jawaban sama sekali tidak relevan
  - 1 = Jawaban sangat kurang, hampir tidak memahami materi
  - 2 = Jawaban kurang, ada sedikit pemahaman tapi banyak yang keliru
  - 3 = Jawaban cukup, memahami sebagian besar konsep tapi ada kekurangan
  - 4 = Jawaban baik, hampir lengkap dan tepat dengan kekurangan minor
  - 5 = Jawaban sangat baik, lengkap, tepat, dan jelas
- Berikan umpan balik SANGAT SINGKAT dan padat (maksimal 10 kata) yang menjelaskan poin utama saja untuk menghemat kuota.
- Jika tidak ada kunci jawaban, nilai berdasarkan kelengkapan, kejelasan, dan relevansi jawaban terhadap soal.

BALAS HANYA dengan JSON format berikut, tanpa teks lain:
{"score": 3.5, "feedback": "Jawaban siswa sudah memahami konsep dasar namun belum menjelaskan secara lengkap."}`;

    try {
        let text = await callAI(prompt, teacherId);
        text = text.replace(/```json\n?|```/g, '').trim();

        // Extract JSON from response
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
            console.error('[/api/ai-correct-essay] No JSON in response:', text.substring(0, 200));
            return res.status(500).json({ error: 'AI tidak memberikan respons yang valid. Coba lagi.' });
        }

        const parsed = JSON.parse(match[0]);
        const rawScore = parseFloat(parsed.score);
        const score = isNaN(rawScore) ? 0 : Math.min(5, Math.max(0, rawScore));
        const feedback = typeof parsed.feedback === 'string' ? parsed.feedback : 'Tidak ada umpan balik.';

        console.log(`[/api/ai-correct-essay] Score: ${score}, Feedback length: ${feedback.length}`);
        return res.json({ ok: true, score, feedback });
    } catch (e) {
        console.error('[/api/ai-correct-essay] Fatal error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/ai-correct-essay-batch', async (req, res) => {
    const { questionText, referenceAnswer, studentAnswers, teacherId = null } = req.body;

    if (!questionText || !Array.isArray(studentAnswers)) {
        return res.status(400).json({ error: 'questionText dan studentAnswers (array) diperlukan' });
    }

    if (studentAnswers.length === 0) {
        return res.json({ ok: true, results: [] });
    }

    const answersListText = studentAnswers.map((ans, i) => {
        const text = (typeof ans === 'string' ? ans : (ans.text || '')).trim();
        return `JAWABAN SISWA ${i + 1}:\n${text || '(Tidak dijawab)'}`;
    }).join('\n\n---\n\n');

    const prompt = `Kamu adalah guru pengoreksi soal esai/uraian yang berpengalaman. Berikan penilaian objektif terhadap ${studentAnswers.length} jawaban siswa untuk SOAL yang sama.

SOAL:
${questionText}

${referenceAnswer ? `KUNCI JAWABAN / JAWABAN REFERENSI:\n${referenceAnswer}\n\n` : ''}DAFTAR JAWABAN SISWA:
${answersListText}

INSTRUKSI PENILAIAN:
- Berikan skor antara 0 sampai 5 untuk SETIAP jawaban (bilangan bulat atau desimal 1 angka di belakang koma).
  - 0 = Tidak menjawab / tidak relevan
  - 5 = Sangat baik dan lengkap
- Berikan umpan balik SANGAT SINGKAT (maksimal 10 kata) untuk setiap jawaban.
- Balas HANYA dengan JSON format berikut:
{
  "results": [
    {"score": 4.5, "feedback": "Penjelasan sangat baik."},
    {"score": 0, "feedback": "Tidak menjawab."}
    ... (sebanyak ${studentAnswers.length} jawaban)
  ]
}`;

    try {
        let text = await callAI(prompt, teacherId);
        text = text.replace(/```json\n?|```/g, '').trim();

        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
            return res.status(500).json({ error: 'AI tidak memberikan respons JSON yang valid.' });
        }

        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed.results)) {
            return res.status(500).json({ error: 'Format hasil AI tidak valid (results array missing).' });
        }

        // Map and validate results
        const finalResults = parsed.results.map(r => {
            const rawScore = parseFloat(r.score);
            return {
                score: isNaN(rawScore) ? 0 : Math.min(5, Math.max(0, rawScore)),
                feedback: typeof r.feedback === 'string' ? r.feedback : 'Tidak ada umpan balik.'
            };
        });

        // Ensure we return exactly as many results as requested (pad with 0s if AI short-changed us)
        while (finalResults.length < studentAnswers.length) {
            finalResults.push({ score: 0, feedback: 'Gagal mendapatkan penilaian AI.' });
        }

        console.log(`[/api/ai-correct-essay-batch] Processed ${studentAnswers.length} answers.`);
        return res.json({ ok: true, results: finalResults.slice(0, studentAnswers.length) });
    } catch (e) {
        console.error('[/api/ai-correct-essay-batch] Fatal error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});


// ─── Helper: Normalize Teacher API Keys ───────────────────────────────────────
function normalizeTeacherApiKeyEntry(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (!trimmed) return null;
        return {
            key: trimmed,
            status: 'active',
            addedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            note: ''
        };
    }
    if (typeof entry === 'object' && entry.key && typeof entry.key === 'string') {
        const trimmed = entry.key.trim();
        if (!trimmed) return null;

        let currentStatus = entry.status === 'exhausted' ? 'exhausted' : 'active';
        let updatedAtTime = entry.updatedAt ? new Date(entry.updatedAt).getTime() : 0;

        // Auto-revive exhausted personal keys after 60 seconds
        if (currentStatus === 'exhausted' && (Date.now() - updatedAtTime > 60000)) {
            currentStatus = 'active';
        }

        return {
            ...entry,
            key: trimmed,
            status: currentStatus,
            addedAt: entry.addedAt || entry.createdAt || new Date().toISOString(),
            updatedAt: entry.updatedAt || new Date().toISOString(),
            note: entry.note || ''
        };
    }
    return null;
}

function normalizeTeacherApiKeysArray(apiKeys = []) {
    return apiKeys
        .map(normalizeTeacherApiKeyEntry)
        .filter(entry => {
            if (!entry || !entry.key) return false;
            // Strict filter for personal keys only
            if (entry.isGlobal === true) return false;
            if (entry.addedAt && entry.addedAt.includes('System')) return false;
            return true;
        });
}

// ─── API: Teacher Add API Key ──────────────────────────────────────────────
app.post('/api/teacher/add-api-key', async (req, res) => {
    const { teacherId, apiKey } = req.body;

    if (!teacherId || !apiKey) {
        return res.status(400).json({ error: 'teacherId dan apiKey diperlukan' });
    }

    try {
        const db = await readDB();

        // Find teacher
        const teacher = db.students.find(s => s.id === teacherId && s.role === 'teacher');
        if (!teacher) {
            return res.status(404).json({ error: 'Guru tidak ditemukan' });
        }

        // Validate API key format (basic check)
        if (apiKey.trim().length < 10) {
            return res.status(400).json({ error: 'API Key tidak valid' });
        }

        // Initialize apiKeys array if not exists
        if (!Array.isArray(teacher.apiKeys)) {
            teacher.apiKeys = [];
        }

        // Check if key already exists (support legacy strings and normalized objects)
        const trimmedKey = apiKey.trim();
        if (teacher.apiKeys.some(entry => {
            if (typeof entry === 'string') return entry.trim() === trimmedKey;
            if (typeof entry === 'object' && entry.key) return entry.key.trim() === trimmedKey;
            return false;
        })) {
            return res.status(409).json({ error: 'API Key ini sudah ada di database' });
        }

        // Add API key to teacher
        teacher.apiKeys.push({
            key: trimmedKey,
            status: 'active',
            addedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            note: ''
        });

        // Save to database
        await writeDB(db);
        console.log(`[TEACHER] API key added untuk guru: ${teacher.name}`);

        // Update realtime state
        updateRealtimeState('teacher-key', teacherId);

        return res.json({
            ok: true,
            message: 'API Key berhasil ditambahkan',
            teacher: teacher.name,
            keyCount: teacher.apiKeys.length
        });

    } catch (err) {
        console.error('[TEACHER API KEY ERROR]:', err.message);
        res.status(500).json({ error: 'Gagal menambahkan API Key: ' + err.message });
    }
});

// ─── API: Teacher Remove API Key ───────────────────────────────────────────
app.post('/api/teacher/remove-api-key', async (req, res) => {
    const { teacherId, keyIndex } = req.body;

    if (!teacherId || keyIndex === undefined) {
        return res.status(400).json({ error: 'teacherId dan keyIndex diperlukan' });
    }

    try {
        const db = await readDB();

        const teacher = db.students.find(s => s.id === teacherId && s.role === 'teacher');
        if (!teacher || !Array.isArray(teacher.apiKeys)) {
            return res.status(404).json({ error: 'Guru atau API Key tidak ditemukan' });
        }

        if (keyIndex < 0 || keyIndex >= teacher.apiKeys.length) {
            return res.status(400).json({ error: 'Index API Key tidak valid' });
        }

        // Remove API key
        const removedKey = teacher.apiKeys.splice(keyIndex, 1)[0];

        // Save to database
        await writeDB(db);
        console.log(`[TEACHER] API key removed untuk guru: ${teacher.name}`);

        // Update realtime state
        updateRealtimeState('teacher-key', teacherId);

        return res.json({
            ok: true,
            message: 'API Key berhasil dihapus',
            teacher: teacher.name,
            keyCount: teacher.apiKeys.length
        });

    } catch (err) {
        console.error('[TEACHER REMOVE KEY ERROR]:', err.message);
        res.status(500).json({ error: 'Gagal menghapus API Key: ' + err.message });
    }
});

// ─── API: Teacher API Keys (Get) ──────────────────────────────────────────
app.get('/api/teacher/api-keys', async (req, res) => {
    const { teacherId } = req.query;

    if (!teacherId) {
        return res.status(400).json({ error: 'teacherId diperlukan' });
    }

    try {
        const db = await readDB();

        // Find teacher
        const teacher = db.students.find(s => s.id === teacherId && s.role === 'teacher');
        if (!teacher) {
            return res.status(404).json({ error: 'Guru tidak ditemukan' });
        }

        // Normalize API keys only
        const normalizedKeys = normalizeTeacherApiKeysArray(teacher.apiKeys || []);

        // Update teacher record if normalization changed anything
        if (normalizedKeys.length !== (teacher.apiKeys || []).length ||
            (teacher.apiKeys || []).some(k => typeof k === 'string' || (typeof k === 'object' && !('status' in k)))) {
            teacher.apiKeys = normalizedKeys;
            await writeDB(db);
        }

        return res.json({
            ok: true,
            apiKeys: normalizedKeys,
            teacher: teacher.name
        });

    } catch (err) {
        console.error('[TEACHER GET KEYS ERROR]:', err.message);
        res.status(500).json({ error: 'Gagal mengambil API Keys: ' + err.message });
    }
});

// ─── API: Real-time API Keys Stats (untuk polling) ─────────────────────────────
app.get('/api/teacher/realtime-stats', async (req, res) => {
    try {
        const { teacherId } = req.query;

        if (!teacherId) {
            return res.status(400).json({ error: 'teacherId diperlukan' });
        }

        const db = await readDB();
        const teacher = db.students.find(s => s.id === teacherId && s.role === 'teacher');

        if (!teacher) {
            return res.status(404).json({ error: 'Guru tidak ditemukan' });
        }

        const normalizedKeys = normalizeTeacherApiKeysArray(teacher.apiKeys || []);
        const activeCount = normalizedKeys.filter(k => k.status !== 'exhausted').length;
        const totalCount = normalizedKeys.length;

        // Get global stats
        const geminiRaw = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
        const geminiKeys = geminiRaw.split(',').map(k => k.trim()).filter(k => k);
        const openaiRaw = process.env.OPENAI_API_KEY || '';
        const openaiKeys = openaiRaw.split(',').map(k => k.trim()).filter(k => k);

        if (!db.globalAPIKeysStatus) db.globalAPIKeysStatus = {};

        const globalActive = [...geminiKeys, ...openaiKeys].filter(k => {
            const hash = k.substring(k.length - 10);
            const status = db.globalAPIKeysStatus[hash];
            return !status || status.status !== 'exhausted';
        }).length;

        const globalTotal = geminiKeys.length + openaiKeys.length;

        return res.json({
            ok: true,
            timestamp: new Date().toISOString(),
            teacherKeys: {
                active: activeCount,
                total: totalCount,
                lastUpdated: realtimeState.lastUpdated[teacherId] || null
            },
            globalKeys: {
                active: globalActive,
                total: globalTotal,
                lastUpdated: realtimeState.globalKeyChanges.timestamp || null
            }
        });
    } catch (err) {
        console.error('[REALTIME STATS ERROR]:', err.message);
        res.status(500).json({ error: 'Gagal mengambil real-time stats: ' + err.message });
    }
});

// ─── API: Get Global API Keys ─────────────────────────────────────────────
app.get('/api/teacher/global-api-keys', async (req, res) => {
    try {
        let keys = [];
        let activeCount = 0;
        let exhaustedCount = 0;

        // 1. PRIMARY: Try to get from Supabase (for Vercel)
        if (USE_SUPABASE) {
            try {
                const { data, error } = await supabase
                    .from('global_api_keys')
                    .select('*')
                    .order('added_at', { ascending: false });

                if (error) throw error;

                keys = data.map(key => ({
                    id: key.id,
                    provider: key.provider,
                    key: key.key,
                    status: key.status,
                    addedAt: key.added_at,
                    updatedAt: key.updated_at,
                    note: key.note
                }));

                activeCount = keys.filter(k => k.status !== 'exhausted').length;
                exhaustedCount = keys.filter(k => k.status === 'exhausted').length;

                console.log(`[ADMIN] Retrieved ${keys.length} global API keys from Supabase`);
            } catch (err) {
                console.error('[ADMIN] Warning: Failed to get from Supabase, falling back to MySQL:', err.message);
                // Fall through to MySQL fallback
            }
        }

        // 2. FALLBACK: Get from MySQL if Supabase failed or not configured
        if (keys.length === 0) {
            const db = await readDB();
            if (!db.globalSettings) db.globalSettings = { apiKeys: [] };
            if (!Array.isArray(db.globalSettings.apiKeys)) db.globalSettings.apiKeys = [];

            keys = db.globalSettings.apiKeys;
            activeCount = keys.filter(k => k.status !== 'exhausted').length;
            exhaustedCount = keys.filter(k => k.status === 'exhausted').length;

            console.log(`[ADMIN] Retrieved ${keys.length} global API keys from MySQL`);
        }

        // 3. AGGREGATE: Personal Teacher/Guru Keys
        const db = await readDB();
        const teacherKeysRaw = [];
        if (db && Array.isArray(db.students)) {
            db.students.forEach(s => {
                if (s.role === 'teacher' && Array.isArray(s.apiKeys)) {
                    const normalized = normalizeTeacherApiKeysArray(s.apiKeys);
                    normalized.forEach(k => {
                        teacherKeysRaw.push({
                            id: `guru-${s.id}-${k.provider}`,
                            provider: k.provider,
                            key: k.key,
                            status: k.status,
                            addedAt: 'Guru: ' + s.name,
                            updatedAt: k.exhaustedAt || new Date().toISOString(),
                            note: 'Personal key'
                        });
                    });
                }
            });
        }

        // 4. AGGREGATE: Environment Variables (as fallback global keys)
        const envKeysRaw = [];
        // Gemini
        const geminiRaw = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
        geminiRaw.split(',').forEach((k, i) => {
            if (k.trim()) {
                const hash = k.trim().substring(k.trim().length - 10);
                const status = (db && db.globalAPIKeysStatus?.[hash]) ? db.globalAPIKeysStatus[hash].status : 'active';
                envKeysRaw.push({
                    id: `env-gemini-${i}`,
                    provider: 'Google Gemini',
                    key: k.trim(),
                    status: status,
                    addedAt: 'Vercel Env',
                    updatedAt: new Date().toISOString(),
                    note: 'Static Env Var'
                });
            }
        });
        // OpenAI
        const oaiRaw = process.env.OPENAI_API_KEY || '';
        oaiRaw.split(',').forEach((k, i) => {
            if (k.trim()) {
                const hash = k.trim().substring(k.trim().length - 10);
                const status = (db && db.globalAPIKeysStatus?.[hash]) ? db.globalAPIKeysStatus[hash].status : 'active';
                envKeysRaw.push({
                    id: `env-openai-${i}`,
                    provider: 'OpenAI',
                    key: k.trim(),
                    status: status,
                    addedAt: 'Vercel Env',
                    updatedAt: new Date().toISOString(),
                    note: 'Static Env Var'
                });
            }
        });

        // Combine all
        const allCombinedRaw = [...keys, ...teacherKeysRaw, ...envKeysRaw];

        // Final normalization for the UI (apply auto-revive)
        const allCombined = allCombinedRaw.map(k => {
            if (k.status === 'exhausted' && k.updatedAt) {
                const updatedAtTime = new Date(k.updatedAt).getTime();
                if (Date.now() - updatedAtTime > 60000) {
                    return { ...k, status: 'active' };
                }
            }
            return k;
        });

        activeCount = allCombined.filter(k => k.status !== 'exhausted').length;
        exhaustedCount = allCombined.filter(k => k.status === 'exhausted').length;

        res.json({
            ok: true,
            globalKeys: allCombined,
            activeCount,
            exhaustedCount
        });
    } catch (err) {
        console.error('[ADMIN GET KEYS ERROR]:', err.message);
        res.status(500).json({ error: 'Gagal mengambil API Keys: ' + err.message });
    }
});

app.post('/api/admin/add-global-key', async (req, res) => {
    const { provider, apiKey, note } = req.body;

    if (!provider || !apiKey) {
        return res.status(400).json({ error: 'provider dan apiKey diperlukan' });
    }

    try {
        const trimmedKey = apiKey.trim();
        let storageMedium = 'MySQL';

        // 1. PRIMARY: Try to save to Supabase (for Vercel)
        if (USE_SUPABASE) {
            try {
                await addGlobalAPIKeyToSupabase(provider, trimmedKey, note);
                storageMedium = 'Supabase';
                console.log(`[ADMIN] Global API key added to Supabase for provider: ${provider}`);
            } catch (err) {
                console.error('[ADMIN] Warning: Failed to add to Supabase, falling back to MySQL:', err.message);
                // Fall through to MySQL fallback
            }
        }

        // 2. FALLBACK: Save to MySQL if Supabase failed or not configured
        if (storageMedium !== 'Supabase') {
            const db = await readDB();
            if (!db.globalSettings) db.globalSettings = { apiKeys: [] };
            if (!Array.isArray(db.globalSettings.apiKeys)) db.globalSettings.apiKeys = [];

            // Check for duplicates in MySQL
            if (db.globalSettings.apiKeys.some(entry => entry.key === trimmedKey)) {
                return res.status(409).json({ error: 'API Key ini sudah ada di daftar Global' });
            }

            db.globalSettings.apiKeys.push({
                provider,
                key: trimmedKey,
                status: 'active',
                addedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                note: note || ''
            });

            await writeDB(db);
            console.log(`[ADMIN] Global API key added to MySQL for provider: ${provider}`);
        }

        // 3. Optional: Push to Vercel (async, don't wait)
        const vercelEnvVar = await pushGlobalAPIKeyToVercel(provider, trimmedKey).catch(err => {
            console.error('[ADMIN] Vercel push error (non-blocking):', err.message);
            return null;
        });

        return res.json({
            ok: true,
            message: 'Global API Key berhasil ditambahkan',
            storage: storageMedium,
            vercelStatus: vercelEnvVar ? `Auto-pushed sebagai ${vercelEnvVar}` : 'Vercel tidak dikonfigurasi'
        });
    } catch (err) {
        console.error('[ADMIN ADD GLOBAL KEY ERROR]:', err.message);
        res.status(500).json({ error: 'Gagal menambahkan Global API Key: ' + err.message });
    }
});

app.post('/api/admin/remove-global-key', async (req, res) => {
    const { keyIndex, keyId, keyValue } = req.body;

    // Accept either keyIndex (MySQL) or keyId (Supabase) or keyValue (direct key match)
    if (keyIndex === undefined && keyId === undefined && !keyValue) {
        return res.status(400).json({ error: 'keyIndex, keyId, atau keyValue diperlukan' });
    }

    try {
        // 1. Try to remove from Supabase first
        if ((keyId !== undefined || keyValue) && USE_SUPABASE) {
            try {
                if (keyId !== undefined) {
                    await removeGlobalAPIKeyFromSupabase(keyId);
                } else if (keyValue) {
                    // Find key by value
                    const { data } = await supabase
                        .from('global_api_keys')
                        .select('id')
                        .eq('key', keyValue)
                        .single();

                    if (data) {
                        await removeGlobalAPIKeyFromSupabase(data.id);
                    }
                }
                console.log(`[ADMIN] Global API key removed from Supabase`);
                return res.json({
                    ok: true,
                    message: 'Global API Key berhasil dihapus dari Supabase'
                });
            } catch (err) {
                console.error('[ADMIN] Warning: Failed to remove from Supabase, trying MySQL:', err.message);
                // Fall through to MySQL fallback
            }
        }

        // 2. FALLBACK: Remove from MySQL
        const db = await readDB();

        if (!db.globalSettings || !Array.isArray(db.globalSettings.apiKeys)) {
            return res.status(404).json({ error: 'Tidak ada API Keys global' });
        }

        if (keyIndex < 0 || keyIndex >= db.globalSettings.apiKeys.length) {
            return res.status(400).json({ error: 'Index API Key tidak valid' });
        }

        const removedKey = db.globalSettings.apiKeys.splice(keyIndex, 1)[0];
        await writeDB(db);

        console.log(`[ADMIN] Global API key removed from MySQL for provider: ${removedKey.provider}`);
        res.json({
            ok: true,
            message: 'Global API Key berhasil dihapus'
        });
    } catch (err) {
        console.error('[ADMIN REMOVE GLOBAL KEY ERROR]:', err.message);
        res.status(500).json({ error: 'Gagal menghapus Global API Key: ' + err.message });
    }
});

// ─── Helper: Push Global API Key to Vercel ───────────────────────────────────
async function pushGlobalAPIKeyToVercel(provider, apiKey) {
    const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
    const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;

    console.log('[VERCEL GLOBAL] VERCEL_TOKEN present:', !!VERCEL_TOKEN);
    console.log('[VERCEL GLOBAL] VERCEL_PROJECT_ID present:', !!VERCEL_PROJECT_ID);

    if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) {
        console.warn('[VERCEL GLOBAL] VERCEL_TOKEN atau VERCEL_PROJECT_ID tidak dikonfigurasi, skipping auto-push');
        return null;
    }

    try {
        console.log(`[VERCEL GLOBAL] Pushing API key untuk provider: ${provider}...`);

        // Generate env var name untuk global key (e.g., GLOBAL_GOOGLE_GEMINI_APIKEY_1)
        const providerSafe = provider.replace(/[^A-Z0-9_]/g, '_').toUpperCase().substring(0, 30);
        const envKeyName = `GLOBAL_${providerSafe}_APIKEY_${Date.now()}`.substring(0, 64);

        console.log(`[VERCEL GLOBAL] Generated env var name: ${envKeyName}`);

        const vercelApi = 'https://api.vercel.com';
        const headers = {
            'Authorization': `Bearer ${VERCEL_TOKEN}`,
            'Content-Type': 'application/json'
        };

        const targets = ['production', 'preview', 'development'];
        console.log(`[VERCEL GLOBAL] Setting env var for targets: ${targets.join(', ')}`);

        const response = await fetch(`${vercelApi}/v9/projects/${VERCEL_PROJECT_ID}/env`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                key: envKeyName,
                value: apiKey,
                target: targets,
                type: 'encrypted'
            })
        });

        console.log('[VERCEL GLOBAL] Env create response status:', response.status);

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            console.log('[VERCEL GLOBAL] Env create error:', JSON.stringify(error, null, 2));

            if (error.code === 'ENV_KEY_ALREADY_EXISTS') {
                console.log(`[VERCEL GLOBAL] ${envKeyName} sudah ada, mencoba update existing entries...`);

                const getRes = await fetch(`${vercelApi}/v9/projects/${VERCEL_PROJECT_ID}/env`, { headers });
                console.log('[VERCEL GLOBAL] Get env vars status:', getRes.status);

                if (!getRes.ok) throw new Error(`Failed to get env vars: ${getRes.statusText}`);

                const data = await getRes.json();
                const existingEnvs = (data.envs || []).filter(e => e.key === envKeyName);

                if (existingEnvs.length === 0) {
                    throw new Error('Env var exists but could not find existing entries');
                }

                for (const existingEnv of existingEnvs) {
                    console.log(`[VERCEL GLOBAL] Updating existing env var ID: ${existingEnv.id}`);
                    const updateRes = await fetch(`${vercelApi}/v9/projects/${VERCEL_PROJECT_ID}/env/${existingEnv.id}`, {
                        method: 'PATCH',
                        headers: headers,
                        body: JSON.stringify({ value: apiKey })
                    });
                    console.log(`[VERCEL GLOBAL] Update response status for ${existingEnv.id}:`, updateRes.status);
                    if (!updateRes.ok) throw new Error(`Failed to update ${existingEnv.id}: ${updateRes.statusText}`);
                }
                console.log(`[VERCEL GLOBAL] ✅ ${envKeyName} updated for existing targets`);
            } else {
                throw new Error(error.message || `HTTP ${response.status}`);
            }
        } else {
            console.log(`[VERCEL GLOBAL] ✅ ${envKeyName} set for all targets`);
        }

        console.log(`[VERCEL GLOBAL] ✅ API key berhasil di-push ke Vercel untuk provider: ${provider}`);
        return envKeyName;

    } catch (err) {
        console.error(`[VERCEL GLOBAL] ❌ Gagal push API key ke Vercel: ${err.message}`);
        // Don't throw - ini adalah bonus feature, jangan error jika gagal
        return null;
    }
}

// ─── Supabase Helpers for Global API Keys ───────────────────────────────────
async function addGlobalAPIKeyToSupabase(provider, key, note = '') {
    if (!USE_SUPABASE || !supabase) {
        throw new Error('Supabase not configured');
    }

    try {
        // Check for duplicates
        const { data: existing, error: checkError } = await supabase
            .from('global_api_keys')
            .select('id')
            .eq('key', key)
            .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
            throw new Error('Duplicate check failed: ' + checkError.message);
        }

        if (existing) {
            throw new Error('API Key sudah ada di Supabase');
        }

        // Insert new key
        const { data, error } = await supabase
            .from('global_api_keys')
            .insert({
                provider,
                key,
                status: 'active',
                note,
                added_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            throw new Error('Insert failed: ' + error.message);
        }

        console.log('[Supabase] Global API key added:', provider);
        return data;
    } catch (err) {
        console.error('[Supabase] Error adding global API key:', err.message);
        throw err;
    }
}

async function removeGlobalAPIKeyFromSupabase(keyId) {
    if (!USE_SUPABASE || !supabase) {
        throw new Error('Supabase not configured');
    }

    try {
        const { error } = await supabase
            .from('global_api_keys')
            .delete()
            .eq('id', keyId);

        if (error) {
            throw new Error('Delete failed: ' + error.message);
        }

        console.log('[Supabase] Global API key removed, ID:', keyId);
    } catch (err) {
        console.error('[Supabase] Error removing global API key:', err.message);
        throw err;
    }
}

// ─── API: Sinkronisasi Supabase (Opsional) ───────────────────────────────────

// Helper membuat Supabase client sementara dari .env
function getSupabaseClient() {
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_KEY;
    if (!sbUrl || !sbKey) {
        throw new Error('SUPABASE_URL dan SUPABASE_KEY belum dikonfigurasi di file .env');
    }
    return createClient(sbUrl, sbKey);
}

// Upload database lokal → Supabase
app.post('/api/sync/upload-to-supabase', async (req, res) => {
    try {
        const sb = getSupabaseClient();

        // Baca database lokal dari MySQL (atau backend aktif)
        let localDb = DEFAULT_DB;
        let localResults = [];
        try {
            const dbProxy = await readDB();
            localDb = {
                globalSettings: dbProxy.globalSettings || {},
                subjects: dbProxy.subjects || [],
                rombels: dbProxy.rombels || [],
                questions: dbProxy.questions || [],
                students: dbProxy.students || [],
                schedules: dbProxy.schedules || [],
                timeLimits: dbProxy.timeLimits || {},
                quizzes: dbProxy.quizzes || []
            };
            localResults = await readResults() || [];
        } catch (e) {
            console.error('Gagal membaca database lokal untuk upload:', e);
        }

        // Upload database utama
        const { error: dbError } = await sb
            .from('cbt_database')
            .upsert({ id: 1, data: localDb, updated_at: new Date() });
        if (dbError) throw new Error('Upload DB error: ' + dbError.message);

        // Upload results
        let uploaded = 0;
        for (const r of localResults) {
            const record = {
                student_id: r.studentId || '',
                mapel: r.mapel || '',
                rombel: r.rombel || '',
                date: r.date || new Date().toISOString(),
                score: typeof r.score === 'string' ? parseFloat(r.score) : (r.score || 0),
                data: r
            };
            const { data: existing } = await sb.from('cbt_results').select('id')
                .match({
                    student_id: record.student_id,
                    mapel: record.mapel,
                    rombel: record.rombel,
                    date: record.date
                })
                .maybeSingle();
            if (existing) {
                await sb.from('cbt_results').update(record).eq('id', existing.id);
            } else {
                await sb.from('cbt_results').insert(record);
            }
            uploaded++;
        }

        console.log(`[SYNC] ✅ Upload ke Supabase: database + ${uploaded} hasil ujian`);
        return res.json({
            ok: true,
            message: `✅ Berhasil upload database dan ${uploaded} hasil ujian ke Supabase.`
        });
    } catch (e) {
        console.error('[SYNC] Upload to Supabase error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// Download database Supabase → lokal
app.post('/api/sync/download-from-supabase', async (req, res) => {
    try {
        const sb = getSupabaseClient();

        const { data: dbData, error: dbError } = await sb
            .from('cbt_database')
            .select('data')
            .eq('id', 1)
            .single();
        if (dbError && dbError.code !== 'PGRST116') throw new Error('Download DB error: ' + dbError.message);

        // Download results
        const { data: resultsData, error: resultsError } = await sb
            .from('cbt_results')
            .select('data')
            .order('created_at', { ascending: false })
            .limit(5000);
        if (resultsError) throw new Error('Download results error: ' + resultsError.message);

        // Simpan ke lokal menggunakan helper DB (MySQL)
        if (dbData && dbData.data) {
            await writeDB(dbData.data);
        }

        const results = resultsData ? resultsData.map(r => r.data).filter(Boolean) : [];
        if (results.length > 0) {
            await writeResults(results);
        }

        console.log(`[SYNC] ✅ Download dari Supabase: database + ${results.length} hasil ujian`);
        return res.json({
            ok: true,
            message: `✅ Berhasil download database dan ${results.length} hasil ujian dari Supabase.`
        });
    } catch (e) {
        console.error('[SYNC] Download from Supabase error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// ─── LIVE QUIZZ ENDPOINTS ─────────────────────────────────────────────────────

app.post('/api/quizz/join', (req, res) => {
    const { studentId, studentName, mapel, rombel } = req.body;
    if (!studentId || !mapel || !rombel) return res.status(400).json({ error: 'Missing data' });
    try {
        sqlDb.upsertQuizzParticipant({ studentId, studentName, mapel, rombel, status: 'waiting' });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/quizz/participants', (req, res) => {
    const { mapel, rombel } = req.query;
    try {
        const participants = sqlDb.getQuizzParticipants(mapel, rombel);
        res.json(participants);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/quizz/status', (req, res) => {
    const { mapel, rombel, status } = req.body;
    try {
        sqlDb.setQuizzStatus(mapel, rombel, status);
        if (status === 'start') {
            try {
                sqlDb.upsertQuizzRoom(mapel, rombel, 'start', 0, Date.now());
                console.log(`[QUIZZ_STATUS] Status set to START for ${mapel}/${rombel}`);
            } catch (e) { console.error("upsertQuizzRoom missing table error ignored."); }
        } else if (status === 'waiting') {
            try {
                sqlDb.upsertQuizzRoom(mapel, rombel, 'waiting', 0, Date.now());
                console.log(`[QUIZZ_STATUS] Status set to WAITING for ${mapel}/${rombel} - room reset`);
            } catch (e) { console.error("upsertQuizzRoom missing table error ignored."); }
        }
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/quizz/check-status', (req, res) => {
    const { studentId, mapel, rombel } = req.query;
    try {
        const participants = sqlDb.getQuizzParticipants(mapel, rombel);
        const me = participants.find(p => p.student_id === studentId);

        // If participant exists, update heartbeat
        if (me) {
            sqlDb.upsertQuizzParticipant({
                studentId,
                studentName: me.student_name,
                mapel,
                rombel,
                status: me.status
            });
        }

        let room;
        try {
            room = sqlDb.getQuizzRoom(mapel, rombel);
        } catch (e) {
            console.error("getQuizzRoom missing table error ignored.");
        }

        res.json({
            status: room ? room.status : (me ? me.status : 'waiting'),
            room_index: room ? room.current_index : 0,
            room_time: room ? room.start_time : 0
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/quizz/room', (req, res) => {
    const { mapel, rombel, status, currentIndex, startTime } = req.body;
    try {
        try {
            sqlDb.upsertQuizzRoom(mapel, rombel, status, currentIndex, startTime);
        } catch (e) { console.error("upsertQuizzRoom missing table error ignored."); }
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/quizz/score', (req, res) => {
    const { studentId, mapel, rombel, score } = req.body;
    try {
        sqlDb.updateQuizzScore(studentId, mapel, rombel, score);
        // Student already marked as answered via updateQuizzScore
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/quizz/mark-answered', (req, res) => {
    const { studentId, mapel, rombel } = req.body;
    try {
        sqlDb.markQuizzAnswered(studentId, mapel, rombel);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/quizz/check-all-answered', (req, res) => {
    const { mapel, rombel } = req.query;
    try {
        const allAnswered = sqlDb.checkAllAnswered(mapel, rombel);
        res.json({ all_answered: allAnswered });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/quizz/reset-answered', (req, res) => {
    const { mapel, rombel } = req.body;
    try {
        sqlDb.resetQuizzAnswered(mapel, rombel);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/quizz/reset', (req, res) => {
    const { mapel, rombel } = req.body;
    try {
        sqlDb.resetQuizzParticipants(mapel, rombel);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── Catch-all ────────────────────────────────────────────────────────────────
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.use('/api', (err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

// ─── Local Init (selalu buat folder jika belum ada) ───────────────────────────
if (!process.env.VERCEL) {
    if (!fs.existsSync(rootPath)) fs.mkdirSync(rootPath, { recursive: true });
    // Buat folder images jika belum ada
    const imagesDir = path.join(rootPath, 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
}

// ─── Cleanup stale live exams (every 5 minutes) ──────────────────────────────
async function cleanupStaleLiveExams() {
    try {
        let liveExams = await readLiveExams();
        if (!Array.isArray(liveExams)) liveExams = [];
        const now = Date.now();
        const fiveMinMs = 5 * 60 * 1000;
        const fresh = liveExams.filter(exam => {
            const updatedAt = exam.updatedAt ? Date.parse(exam.updatedAt) : 0;
            if (Number.isNaN(updatedAt)) return false;
            return (now - updatedAt) < fiveMinMs;
        });
        if (fresh.length !== liveExams.length) {
            console.log(`[Cleanup] Removed ${liveExams.length - fresh.length} stale live exam entries`);
            await writeLiveExams(fresh);
        }
    } catch (err) {
        console.error('[Cleanup] Error cleaning live exams:', err.message);
    }
}

// Run cleanup every 5 minutes
setInterval(cleanupStaleLiveExams, 5 * 60 * 1000);

// ─── Listen (skip on Vercel) ──────────────────────────────────────────────────
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;

    const startApp = async () => {
        try {
            // Jalankan migrasi jika diperlukan
            await autoMigrateIfNeeded();
        } catch (err) {
            console.error('❌ Gagal menjalankan migrasi awal:', err.message);
        }

        console.log(`[INIT] Starting server on port ${PORT}...`);
        app.listen(PORT, '0.0.0.0', () => {
            const { networkInterfaces } = require('os');
            const nets = networkInterfaces();

            // Kumpulkan semua IP jaringan
            const networkIPs = [];
            for (const [name, net] of Object.entries(nets)) {
                for (const iface of net) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        networkIPs.push({ name, address: iface.address });
                    }
                }
            }

            console.log('\n' + '═'.repeat(55));
            console.log('  🎓 DR.CBT - Server Berjalan!');
            console.log('═'.repeat(55));
            console.log(`\n  📡 Akses Lokal    : http://localhost:${PORT}`);

            if (networkIPs.length > 0) {
                console.log('\n  🌐 Akses Jaringan (bagikan ke siswa):');
                for (const { name, address } of networkIPs) {
                    console.log(`     http://${address}:${PORT}  (${name})`);
                }
            } else {
                console.log('\n  ⚠️  Tidak terdeteksi jaringan LAN.');
            }

            console.log('\n  💾 Mode Database  : Supabase (Cloud)');
            console.log(`  📁 Folder APP     : ${rootPath}`);
            console.log(`  🔑 Login Admin    : ADM / admin321`);
            console.log(`  🎓 Developer      : Daniel Widiatmoko`);
            console.log('\n  ℹ️ Menggunakan koneksi cloud Supabase sebagai single source of truth.');
            console.log('\n  ⛔ Tekan Ctrl+C untuk menghentikan server');
            console.log('═'.repeat(55) + '\n');
        });
    };

    startApp();
}

// ─── Process Exit Handlers ────────────────────────────────────────────────────
const handleExit = () => {
    console.log('\n[EXIT] Menutup aplikasi...');
    process.exit();
};

process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);

process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);

// Export Express app so Vercel finds the handler in serverless environment
// CommonJS default export
module.exports = app;
// Also provide named/ESM-friendly exports some builders expect
module.exports.default = app;
module.exports.handler = app;
exports.default = app;
