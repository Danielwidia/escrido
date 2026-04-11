require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Anthropic } = require('@anthropic-ai/sdk');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const pdf = require('pdf-parse');
const PptxGenJS = require('pptxgenjs');

console.log('[SERVER] Starting CBT Online Server...');

// Helper function to parse PPT content from AI response
function parsePPTContent(aiText, extraData = {}, topik = 'Presentasi') {
    const slides = [];

    // Remove markdown formatting if any
    aiText = aiText.replace(/\*\*/g, '').replace(/#/g, '');

    // Split by slide markers
    const slideRegex = /SLIDE\s*\d+[:\-]?\s*([^\n]*)/gi;
    const slideMatches = aiText.match(slideRegex);

    if (!slideMatches || slideMatches.length === 0) {
        // Fallback parsing
        const lines = aiText.split('\n').filter(line => line.trim());
        return [{
            title: extraData?.topikPPT || topik || 'Presentasi',
            content: lines.slice(0, 5).map(line => line.replace(/^[-•*]\s*/, '').trim())
        }];
    }

    // Parse each slide
    for (let i = 0; i < slideMatches.length; i++) {
        const slideMatch = slideMatches[i];
        const titleMatch = slideMatch.match(/SLIDE\s*\d+[:\-]?\s*(.+)/i);

        let title = "Slide " + (i + 1);
        if (titleMatch && titleMatch[1]) {
            title = titleMatch[1].trim();
        }

        // Get content after this slide until next slide or end
        const startIndex = aiText.indexOf(slideMatch) + slideMatch.length;
        const endIndex = (i < slideMatches.length - 1) ? aiText.indexOf(slideMatches[i + 1]) : aiText.length;
        const slideContent = aiText.substring(startIndex, endIndex).trim();

        // Parse bullet points
        const content = slideContent.split('\n')
            .map(line => line.trim())
            .filter(line => line.match(/^[-•*]\s*/) || line.match(/^\d+\.\s*/)) // Include numbered lists
            .map(line => line.replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, '').trim())
            .filter(line => line.length > 0)
            .slice(0, 7); // Max 7 bullet points

        // Even if empty content, we can still add the slide title
        slides.push({ title, content: content.length > 0 ? content : [] });
    }

    // Ensure we have at least some slides
    if (slides.length === 0) {
        slides.push({
            title: extraData?.topikPPT || topik || 'Presentasi',
            content: ['Konten presentasi akan diisi sesuai materi']
        });
    }

    const maxSlides = parseInt(extraData?.jumlahSlide) || 10;
    return slides.slice(0, maxSlides); // Limit to requested number
}
console.log('[ENV] VERCEL_TOKEN present:', !!process.env.VERCEL_TOKEN);
console.log('[ENV] VERCEL_PROJECT_ID present:', !!process.env.VERCEL_PROJECT_ID);
console.log('[ENV] VERCEL_TOKEN value:', process.env.VERCEL_TOKEN ? process.env.VERCEL_TOKEN.substring(0, 10) + '...' : 'null');
console.log('[ENV] VERCEL_PROJECT_ID value:', process.env.VERCEL_PROJECT_ID || 'null');

const app = express();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // Increase limit for blueprints
});
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Reduced for serverless
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const isPkg = typeof process.pkg !== 'undefined';
const baseDir = isPkg ? path.dirname(process.execPath) : __dirname;
const rootPath = isPkg ? path.join(baseDir, 'APP') : (process.env.VERCEL ? process.cwd() : __dirname);

// ─── Logging & Static Middleware ──────────────────────────────────────────────
app.use((req, res, next) => {
    if (!req.url.startsWith('/api') && req.url !== '/' && !req.url.includes('.')) {
        console.log(`[ROUTE] ${req.method} ${req.url}`);
    }
    next();
});

// ─── Extract Teacher Data from Request ────────────────────────────────────────
app.use((req, res, next) => {
    // Extract teacher ID from X-Teacher-ID header or session
    req.teacherId = req.headers['x-teacher-id'] || req.query.teacherId || null;
    req.teacherName = req.headers['x-teacher-name'] || req.query.teacherName || null;
    next();
});

// Serve static files from APP folder (external in .exe, local in dev)
app.use(express.static(rootPath));

// ─── Environment ──────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Local fallback paths
const LOCAL_DATA = path.join(process.cwd(), 'database.json');
const LOCAL_RESULTS = path.join(process.cwd(), 'results.json');

const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);
let supabase = null;

if (USE_SUPABASE) {
    console.log(`✅ Supabase mode: Connected to ${SUPABASE_URL}`);
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
    console.log('⚠️  Supabase not configured – using local JSON files as fallback.');
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
    globalSettings: {
        apiKeys: []
    }
};

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
async function parseBlueprint(fileBuffer, originalName, req) {
    const ext = path.extname(originalName).toLowerCase();
    let text = "";

    try {
        if (ext === '.docx') {
            const result = await mammoth.extractRawText({ buffer: fileBuffer });
            text = result?.value || "";
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
            text = data?.text || "";
        } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
            // Gambar: kirim ke Gemini Vision untuk ekstraksi teks (OCR)
            const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
            const base64Image = fileBuffer.toString('base64');
            text = await extractTextFromImage(base64Image, mimeType, req);
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
async function extractTextFromImage(base64Data, mimeType, req) {
    // Start with global API keys
    const globalKeys = parseApiKeyList(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '');
    let keys = [...globalKeys];

    // Add teacher's personal API keys if available
    if (req && req.teacherId) {
        const teacherKeys = await getTeacherAPIKeys(req.teacherId, req);
        keys = [...teacherKeys, ...keys]; // Teacher keys first for priority
    }

    console.log('[OCR] Gemini: Global keys count:', globalKeys.length, '| Total with teacher keys:', keys.length);

    if (keys.length === 0) {
        console.warn('[OCR] No Gemini key configured, skipping image OCR.');
        return "[Gambar diunggah, tapi API Key Gemini belum dikonfigurasi untuk membaca isinya]";
    }

    const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    const prompt = "Ini adalah foto atau scan dokumen kisi-kisi / soal ujian. Tolong baca dan ekstrak SELURUH teks yang terlihat dalam gambar ini secara akurat. Jika ada tabel, pertahankan strukturnya. Jangan tambahkan komentar, langsung tulis teks yang ada di gambar saja.";

    const exhaustedTeacherKeys = [];

    for (const model of models) {
        for (const key of keys) {
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
                const errMsg = errData.error?.message || response.statusText;

                if (response.status === 429) {
                    console.warn(`[OCR] ⚠️ Quota exceeded for model: ${model}`);
                    if (req && req.teacherId) {
                        const marked = await markTeacherKeyExhausted(req.teacherId, key, `${model} 429`);
                        if (marked) exhaustedTeacherKeys.push(key);
                    }
                    continue; // Quota issue, try next key
                } else {
                    console.warn(`[OCR] Model ${model} failed: ${response.status} - ${errMsg}`);
                }
            } catch (e) {
                console.error(`[OCR] Fetch error with ${model}:`, e.message);
            }
        }
    }
    return "[Gagal mengekstrak teks dari gambar. Pastikan Gemini API Key sudah dikonfigurasi.]";
}

function normalizeQuestionType(type = '') {
    const t = type.toLowerCase().trim();
    if (['single', 'pilihan_ganda', 'pg', 'multiple_choice'].includes(t)) return 'single';
    if (['multiple', 'pg_kompleks', 'complex', 'checkbox'].includes(t)) return 'multiple';
    if (['text', 'uraian', 'isian', 'essay', 'short_answer'].includes(t)) return 'text';
    if (['tf', 'boolean', 'benar_salah', 'true_false', 'bs'].includes(t)) return 'tf';
    if (['matching', 'jodohkan', 'pasangkan', 'pairing', 'match'].includes(t)) return 'matching';
    return 'single';
}

function normalizeTextCorrect(correct) {
    if (correct === undefined || correct === null) return '';
    if (typeof correct === 'string') {
        const trimmed = correct.trim();
        if (!trimmed || trimmed.toLowerCase() === 'undefined' || trimmed.toLowerCase() === 'null') return '';
        return trimmed;
    }
    if (Array.isArray(correct)) {
        const values = correct
            .filter(v => v !== undefined && v !== null)
            .map(v => String(v).trim())
            .filter(v => v && v.toLowerCase() !== 'undefined' && v.toLowerCase() !== 'null');
        return values.join(' || ');
    }
    const result = String(correct).trim();
    return (result.toLowerCase() === 'undefined' || result.toLowerCase() === 'null') ? '' : result;
}

function normalizeQuestion(q, defaultMapel = '', defaultRombel = '', teacherId = null) {
    const normalized = { ...q };

    // Standard metadata
    if (!normalized.mapel) normalized.mapel = defaultMapel;
    if (!normalized.rombel) normalized.rombel = defaultRombel;
    if (!normalized.teacherId) normalized.teacherId = teacherId;
    if (!normalized.id) normalized.id = Date.now() + Math.random().toString(36).substr(2, 6);
    if (!normalized.createdAt) normalized.createdAt = new Date().toISOString();
    if (!normalized.images) normalized.images = [];
    if (!normalized.text) normalized.text = '';

    // Normalize type
    normalized.type = normalizeQuestionType(normalized.type);

    // Normalize specific types
    if (normalized.type === 'tf') {
        // Konversi dari format lama (options + correct array) ke format baru (subQuestions)
        if (!normalized.subQuestions) {
            if (Array.isArray(normalized.options) && Array.isArray(normalized.correct)) {
                // Format lama: options adalah array pernyataan, correct adalah boolean/string array
                normalized.subQuestions = normalized.options.map((stmt, i) => {
                    const ans = normalized.correct[i];
                    let answer = 'Benar';
                    if (ans === false || ans === 'Salah' || ans === 'salah') {
                        answer = 'Salah';
                    }
                    return { statement: stmt, answer };
                });
                // Pastikan tepat 3 pernyataan
                normalized.subQuestions = normalized.subQuestions.slice(0, 3);
                while (normalized.subQuestions.length < 3) {
                    normalized.subQuestions.push({
                        statement: `Pernyataan ${normalized.subQuestions.length + 1}`,
                        answer: 'Benar'
                    });
                }
                // Pastikan correct array sesuai dengan subQuestions
                normalized.correct = normalized.subQuestions.map(sq => sq.answer);
            } else if (normalized.text) {
                // Format fallback: ambil dari text field
                normalized.subQuestions = [
                    { statement: normalized.text, answer: normalized.correct || 'Benar' }
                ];
            } else {
                // Inisialisasi default jika meraba
                normalized.subQuestions = [
                    { statement: 'Pernyataan 1', answer: 'Benar' },
                    { statement: 'Pernyataan 2', answer: 'Benar' },
                    { statement: 'Pernyataan 3', answer: 'Benar' }
                ];
            }
        }
        // Validasi: subQuestions harus tepat 3 item
        if (Array.isArray(normalized.subQuestions) && normalized.subQuestions.length !== 3) {
            normalized.subQuestions = normalized.subQuestions.slice(0, 3);
            while (normalized.subQuestions.length < 3) {
                normalized.subQuestions.push({
                    statement: `Pernyataan ${normalized.subQuestions.length + 1}`,
                    answer: 'Benar'
                });
            }
        }
        // Pastikan correct array sesuai dengan subQuestions
        if (Array.isArray(normalized.subQuestions)) {
            normalized.correct = normalized.subQuestions.map(sq => sq.answer);
            // Untuk kompatibilitas dengan frontend, isi juga options
            normalized.options = normalized.subQuestions.map(sq => sq.statement);
        }
    } else if (normalized.type === 'matching') {
        if (!Array.isArray(normalized.questions)) normalized.questions = [];
        if (!Array.isArray(normalized.answers)) normalized.answers = [];

        const qLen = normalized.questions.length;
        if (!Array.isArray(normalized.correct)) {
            normalized.correct = Array(qLen).fill(normalized.answers[0] || '');
        } else {
            const corr = normalized.correct.map(c => String(c));
            while (corr.length < qLen) corr.push(normalized.answers[0] || '');
            normalized.correct = corr.slice(0, qLen);
        }
    } else if (normalized.type === 'multiple') {
        if (!Array.isArray(normalized.options)) normalized.options = [];

        // TEPAT 4 opsi (tidak boleh kurang, tidak boleh lebih)
        if (normalized.options.length < 4) {
            while (normalized.options.length < 4) normalized.options.push(`Opsi ${String.fromCharCode(65 + normalized.options.length)}`);
        } else if (normalized.options.length > 4) {
            // Potong jika lebih dari 4 opsi
            normalized.options = normalized.options.slice(0, 4);
            console.warn('[normalizeQuestion] Trimmed multiple options to 4 items and removed extras beyond D');
        }

        let corr = [];
        if (Array.isArray(normalized.correct)) {
            corr = normalized.correct;
        } else if (typeof normalized.correct === 'string') {
            corr = normalized.correct.split(',').map(s => s.trim());
        } else if (typeof normalized.correct === 'number') {
            corr = [normalized.correct];
        }

        normalized.correct = corr.map(c => {
            if (typeof c === 'string' && /^[A-E]$/i.test(c)) return c.toUpperCase().charCodeAt(0) - 65;
            const n = parseInt(c);
            return isNaN(n) ? null : n;
        }).filter(c => c !== null && c >= 0 && c < normalized.options.length);

        normalized.correct = [...new Set(normalized.correct)];

        // MAKSIMAL 3 jawaban benar untuk multiple choice
        if (normalized.correct.length > 3) {
            normalized.correct = normalized.correct.slice(0, 3);
        }

        if (normalized.correct.length === 0) normalized.correct = [0];
        if (normalized.correct.length === 1) {
            // Jika hanya 1 jawaban benar, ubah ke tipe single
            normalized.type = 'single';
            normalized.correct = normalized.correct[0];
        }
    } else if (normalized.type === 'single') {
        if (!Array.isArray(normalized.options)) normalized.options = [];
        if (normalized.options.length < 4) {
            while (normalized.options.length < 4) normalized.options.push(`Opsi ${String.fromCharCode(65 + normalized.options.length)}`);
        } else if (normalized.options.length > 4) {
            normalized.options = normalized.options.slice(0, 4);
            console.warn('[normalizeQuestion] Trimmed single options to 4 items and removed extras beyond D');
        }

        if (Array.isArray(normalized.correct)) {
            if (normalized.correct.length > 1) {
                normalized.type = 'multiple';
            } else {
                normalized.correct = normalized.correct[0] || 0;
            }
        }

        if (typeof normalized.correct === 'string' && /^[A-E]$/i.test(normalized.correct)) {
            normalized.correct = normalized.correct.toUpperCase().charCodeAt(0) - 65;
        } else {
            normalized.correct = parseInt(normalized.correct) || 0;
        }

        if (normalized.correct < 0 || normalized.correct >= normalized.options.length) normalized.correct = 0;
    } else if (normalized.type === 'text') {
        normalized.correct = normalizeTextCorrect(normalized.correct);
    }

    return normalized;
}

function normalizeQuestionCorrect(question) {
    return normalizeQuestion(question);
}

function parseApiKeyList(raw) {
    return String(raw || '')
        .split(',')
        .map(k => k.trim())
        .filter(k => k);
}

function logProviderSkip(providerName) {
    console.warn(`[AI] Skipping ${providerName}: no API key configured.`);
    return null;
}

// ─── Data Layer (Supabase Native + Fallback) ──────────────────────────────────
async function readDB() {
    if (USE_SUPABASE) {
        const { data, error } = await supabase
            .from('cbt_database')
            .select('data')
            .eq('id', 1)
            .single();
        if (error && error.code !== 'PGRST116') {
            console.error('Supabase readDB error:', error);
        }
        let dbObj = data ? data.data : null;
        if (dbObj) {
            // Also fetch results separately and merge them into the database object
            try {
                const results = await readResults();
                dbObj.results = results || [];
            } catch (e) {
                console.error('Error fetching results in readDB:', e.message);
                if (!dbObj.results) dbObj.results = [];
            }
        }
        return dbObj;
    }
    if (process.env.VERCEL) {
        throw new Error('Supabase configuration is required on Vercel. Local JSON database is not supported.');
    }
    try {
        if (!fs.existsSync(LOCAL_DATA)) return null;
        return JSON.parse(fs.readFileSync(LOCAL_DATA, 'utf8'));
    } catch { return null; }
}

async function writeDB(obj) {
    if (USE_SUPABASE) {
        const questionCount = Array.isArray(obj.questions) ? obj.questions.length : 0;
        const studentCount = Array.isArray(obj.students) ? obj.students.length : 0;
        const resultCount = Array.isArray(obj.results) ? obj.results.length : 0;

        console.log(`[Supabase] writeDB starting: questions=${questionCount}, students=${studentCount}, results=${resultCount}`);
        try {
            const { data, error } = await supabase
                .from('cbt_database')
                .upsert({ id: 1, data: obj, updated_at: new Date() });

            if (error) {
                console.error('[Supabase] writeDB failed:', error);
                throw new Error('Supabase writeDB error: ' + error.message);
            }

            console.log('[Supabase] writeDB success:', Array.isArray(data) ? `rows=${data.length}` : 'ok');
            return;
        } catch (err) {
            console.error('[Supabase] writeDB exception:', err);
            throw err;
        }
    }
    if (process.env.VERCEL) {
        throw new Error('Supabase configuration is required on Vercel. Local JSON database is not supported.');
    }
    fs.writeFileSync(LOCAL_DATA, JSON.stringify(obj, null, 2), 'utf8');
}

async function readResults() {
    if (USE_SUPABASE) {
        const { data, error } = await supabase
            .from('cbt_results')
            .select('data')
            .order('created_at', { ascending: false });
        if (error) {
            console.error('Supabase readResults error:', error);
            return [];
        }
        return data.map(row => row.data);
    }
    if (process.env.VERCEL) {
        throw new Error('Supabase configuration is required on Vercel. Local JSON database is not supported.');
    }
    try {
        if (!fs.existsSync(LOCAL_RESULTS)) return [];
        return JSON.parse(fs.readFileSync(LOCAL_RESULTS, 'utf8'));
    } catch { return []; }
}

async function writeResults(results) {
    if (USE_SUPABASE) {
        // Separate deleted and active results
        const toDelete = results.filter(r => r.deleted === true);
        const active = results.filter(r => r.deleted !== true);

        // 1. Physically delete from Supabase if marked for deletion
        if (toDelete.length > 0) {
            console.log(`🗑️ Deleting ${toDelete.length} results from Supabase...`);
            for (const r of toDelete) {
                const { error } = await supabase
                    .from('cbt_results')
                    .delete()
                    .match({
                        student_id: r.studentId || '',
                        mapel: r.mapel || '',
                        rombel: r.rombel || '',
                        date: r.date || ''
                    });
                if (error) console.error('Supabase deletion error:', error.message);
            }
        }

        // 2. Sync active results (Manual Upsert logic to handle custom/composite unique constraints)
        if (active.length > 0) {
            for (const r of active) {
                const record = {
                    student_id: r.studentId || '',
                    mapel: r.mapel || '',
                    rombel: r.rombel || '',
                    date: r.date || new Date().toISOString(),
                    score: typeof r.score === 'string' ? parseFloat(r.score) : (r.score || 0),
                    data: r
                };

                // Check for existing record by identity match (to simulate upsert if index is missing)
                const { data: existing } = await supabase
                    .from('cbt_results')
                    .select('id')
                    .match({
                        student_id: record.student_id,
                        mapel: record.mapel,
                        rombel: record.rombel,
                        date: record.date
                    })
                    .maybeSingle();

                if (existing) {
                    const { error } = await supabase.from('cbt_results').update(record).eq('id', existing.id);
                    if (error) console.error(`Supabase update error for student ${record.student_id}:`, error.message);
                } else {
                    const { error } = await supabase.from('cbt_results').insert(record);
                    if (error) console.error(`Supabase insert error for student ${record.student_id}:`, error.message);
                }
            }
        }
        return;
    }
    if (process.env.VERCEL) {
        throw new Error('Supabase configuration is required on Vercel. Local JSON database is not supported.');
    }
    fs.writeFileSync(LOCAL_RESULTS, JSON.stringify(results, null, 2), 'utf8');
}

async function insertResultSingle(resultObj) {
    if (USE_SUPABASE) {
        if (resultObj.deleted) {
            const { error } = await supabase
                .from('cbt_results')
                .delete()
                .match({
                    student_id: resultObj.studentId || '',
                    mapel: resultObj.mapel || '',
                    rombel: resultObj.rombel || '',
                    date: resultObj.date || ''
                });
            if (error) throw new Error('Supabase insertResultSingle(delete) error: ' + error.message);
        } else {
            const record = {
                student_id: resultObj.studentId || '',
                mapel: resultObj.mapel || '',
                rombel: resultObj.rombel || '',
                date: resultObj.date || new Date().toISOString(),
                score: typeof resultObj.score === 'string' ? parseFloat(resultObj.score) : (resultObj.score || 0),
                data: resultObj
            };

            // Manual Upsert Logic (Check existence first to bypass conflict spec issues)
            const { data: existing, error: fetchError } = await supabase
                .from('cbt_results')
                .select('id')
                .match({
                    student_id: record.student_id,
                    mapel: record.mapel,
                    rombel: record.rombel,
                    date: record.date
                })
                .maybeSingle();

            if (fetchError) throw new Error(`Supabase lookup error: ${fetchError.message}`);

            if (existing) {
                // Update existing record
                const { error: updateError } = await supabase
                    .from('cbt_results')
                    .update(record)
                    .eq('id', existing.id);
                if (updateError) throw new Error(`Supabase update error: ${updateError.message}`);
            } else {
                // Insert new record
                const { error: insertError } = await supabase
                    .from('cbt_results')
                    .insert(record);
                if (insertError) throw new Error(`Supabase insert error: ${insertError.message}`);
            }
        }
    } else {
        if (process.env.VERCEL) {
            throw new Error('Supabase configuration is required on Vercel. Local JSON database is not supported.');
        }
        const merged = mergeResults(await readResults(), [resultObj]);
        fs.writeFileSync(LOCAL_RESULTS, JSON.stringify(merged, null, 2), 'utf8');
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

// ─── API: Database ────────────────────────────────────────────────────────────
app.get('/api/db', async (req, res) => {
    try {
        const data = await readDB();
        if (data) return res.json(data);
        return res.status(404).json({ error: 'Database not found' });
    } catch (e) {
        console.error('GET /api/db error:', e.message);
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

// ─── API: Results ─────────────────────────────────────────────────────────────
app.get('/api/results', async (req, res) => {
    try {
        return res.json(await readResults());
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
        if (!req.file) return res.status(400).json({ error: 'No file provided' });
        const metadata = { subject: req.body.subject || '', class: req.body.class || '', type: req.body.type || 'single' };
        const result = await parseWordDocument(req.file.buffer, metadata);
        if (!result.success) return res.status(400).json({ error: result.error });
        const db = (await readDB()) || { ...DEFAULT_DB };
        db.questions = [...(db.questions || []), ...result.questions];
        await writeDB(db);
        return res.json({ ok: true, imported: result.count, questions: result.questions, warnings: result.warnings || [] });
    } catch (e) {
        console.error('POST /api/import-word error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// ─── API: AI Generate ─────────────────────────────────────────────────────────
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

/**
 * Helper to initialize and manage global API keys status tracking
 */
async function markGlobalKeyExhausted(key, note = '') {
    try {
        const db = await readDB();
        if (!db.globalAPIKeysStatus) {
            db.globalAPIKeysStatus = {};
        }

        const keyHash = key.substring(key.length - 10); // Use last 10 chars as identifier

        db.globalAPIKeysStatus[keyHash] = {
            status: 'exhausted',
            exhaustedAt: new Date().toISOString(),
            note: note || '429 Quota Exceeded',
            fullKey: key
        };

        await writeDB(db);
        console.log(`[AI] Marked global API key as exhausted: ${keyHash}`);
        return true;
    } catch (e) {
        console.warn('[AI] markGlobalKeyExhausted error:', e.message);
        return false;
    }
}

async function markTeacherKeyExhausted(teacherId, key, note = 'Quota 429 detected') {
    try {
        const db = await readDB();
        if (!db.students) return false;

        const teacher = db.students.find(s => s.id === teacherId && s.role === 'teacher');
        if (!teacher || !Array.isArray(teacher.apiKeys)) return false;

        const normalized = normalizeTeacherApiKeysArray(teacher.apiKeys);
        let changed = false;
        const now = new Date().toISOString();

        teacher.apiKeys = normalized.map(entry => {
            if (entry.key === key && entry.status !== 'exhausted') {
                changed = true;
                return {
                    ...entry,
                    status: 'exhausted',
                    updatedAt: now,
                    note
                };
            }
            return entry;
        });

        if (changed) {
            await writeDB(db);
            console.log(`[AI] Marked teacher API key as exhausted: ${key} for teacher ${teacherId}`);
        }

        return changed;
    } catch (e) {
        console.warn('[AI] markTeacherKeyExhausted error:', e.message);
        return false;
    }
}

/**
 * Helper to get teacher API keys from database and process.env
 */
/**
 * Helper to get teacher API keys from database and process.env
 * Now with case-insensitive matching and alternate prefix support
 */
async function getTeacherAPIKeys(teacherId, req) {
    if (!teacherId) return [];

    try {
        const db = await readDB();
        let studentKeys = [];

        // 1. Get from database
        if (db.students) {
            const teacher = db.students.find(s => s.id === teacherId && s.role === 'teacher');
            if (teacher && Array.isArray(teacher.apiKeys)) {
                const normalized = normalizeTeacherApiKeysArray(teacher.apiKeys);
                if (normalized.length !== teacher.apiKeys.length || teacher.apiKeys.some(k => typeof k === 'string' || (typeof k === 'object' && !('status' in k)))) {
                    teacher.apiKeys = normalized;
                    await writeDB(db);
                }
                studentKeys = normalized.filter(entry => entry.status !== 'exhausted').map(entry => entry.key);
            }
        }

        // 2. Scan process.env for keys (Case-Insensitive)
        const teacherSafe = String(teacherId).replace(/[^A-Z0-9_]/g, '_').toUpperCase();
        const envPrefix = `TEACHER_${teacherSafe}_APIKEY_`;
        const envPrefixAlt = `TEACHER_${teacherSafe}_APIKEY`; // No trailing underscore

        const envKeys = Object.keys(process.env)
            .filter(k => {
                const uk = k.toUpperCase();
                return uk.startsWith(envPrefix) || uk === envPrefixAlt;
            })
            .map(k => process.env[k])
            .filter(v => v && typeof v === 'string' && v.trim().length > 10);

        // Combine and unique
        const allKeys = [...new Set([...studentKeys, ...envKeys])];

        if (allKeys.length > 0) {
            console.log(`[AI] Found ${allKeys.length} active API keys for teacher: ${teacherId} (DB: ${studentKeys.length}, ENV: ${envKeys.length}, Prefixes: ${envPrefix}, ${envPrefixAlt})`);
        } else {
            // Log sample of ENV keys to help debug if none found
            const envSample = Object.keys(process.env).slice(0, 10).join(', ');
            console.log(`[AI] No teacher API keys found for ${teacherId}. Checked prefixes: ${envPrefix}, ${envPrefixAlt}. ENV Sample: ${envSample}`);
        }

        return allKeys;
    } catch (e) {
        console.warn(`[AI] Error fetching teacher API keys for ${teacherId}:`, e.message);
        return [];
    }
}

/**
 * Helper to get Global API Keys from Database OR Environment Variables
 */
async function getGlobalAPIKeys(providerPrefix = '') {
    const keys = [];
    const sourceInfo = { db: 0, env: 0 };

    try {
        // 1. Get from Database
        const db = await readDB();
        if (db.globalSettings && Array.isArray(db.globalSettings.apiKeys)) {
            db.globalSettings.apiKeys.forEach(entry => {
                const entryProvider = String(entry.provider || '').toLowerCase();
                const targetProvider = String(providerPrefix || '').toLowerCase();

                if (!providerPrefix || entryProvider.includes(targetProvider)) {
                    if (entry.key && entry.status !== 'exhausted') {
                        keys.push(entry.key);
                        sourceInfo.db++;
                    }
                }
            });
        }

        // 2. Get from Environment Variables (Legacy/Fallback)
        let envRaw = '';
        if (providerPrefix.toLowerCase().includes('gemini')) {
            envRaw = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
        } else if (providerPrefix.toLowerCase().includes('openai')) {
            envRaw = process.env.OPENAI_API_KEY || '';
        } else if (providerPrefix.toLowerCase().includes('openrouter')) {
            envRaw = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || process.env.OPEN_ROUTER_KEY || '';
        } else if (providerPrefix.toLowerCase().includes('grok')) {
            envRaw = process.env.XAI_API_KEY || process.env.GROK_API_KEY || '';
        } else if (providerPrefix.toLowerCase().includes('groq')) {
            envRaw = process.env.GROQ_API_KEY || '';
        } else if (providerPrefix.toLowerCase().includes('huggingface')) {
            envRaw = process.env.HUGGINGFACE_API_KEY || process.env.HF_API_KEY || '';
        } else if (providerPrefix.toLowerCase().includes('anthropic')) {
            envRaw = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '';
        } else if (providerPrefix.toLowerCase().includes('mistral')) {
            envRaw = process.env.MISTRAL_API_KEY || '';
        } else if (providerPrefix.toLowerCase().includes('cohere')) {
            envRaw = process.env.COHERE_API_KEY || '';
        } else if (providerPrefix.toLowerCase().includes('together')) {
            envRaw = process.env.TOGETHER_API_KEY || '';
        } else if (providerPrefix.toLowerCase().includes('deepseek')) {
            envRaw = process.env.DEEPSEEK_API_KEY || process.env.DEEP_SEEK_API_KEY || '';
        } else if (providerPrefix.toLowerCase().includes('vercel')) {
            envRaw = process.env.VERCEL_AI_API_KEY || process.env.AI_GATEWAY_API_KEY || '';
        }

        const envKeys = parseApiKeyList(envRaw);
        envKeys.forEach(k => {
            if (!keys.includes(k)) {
                keys.push(k);
                sourceInfo.env++;
            }
        });

        if (keys.length > 0) {
            console.log(`[AI] Global keys for ${providerPrefix}: ${keys.length} (DB: ${sourceInfo.db}, ENV: ${sourceInfo.env})`);
        }
    } catch (e) {
        console.warn(`[AI] Error fetching global keys for ${providerPrefix}:`, e.message);
    }

    return keys;
}

/**
 * Unified helper to get ALL available keys (Teacher + Global)
 */
async function getAllAvailableKeys(providerName, teacherId, req) {
    const teacherKeys = await getTeacherAPIKeys(teacherId, req);
    const globalKeys = await getGlobalAPIKeys(providerName);

    // Teacher keys get priority (added first)
    const combined = [...new Set([...teacherKeys, ...globalKeys])];

    // Log the discovery process for debugging
    const idSource = req?.headers?.['x-teacher-id'] ? 'Headers' : (req?.body?.teacherId ? 'Body' : 'None');
    console.log(`[AI] aggregate[${providerName}]: Teacher[${teacherId}] found from ${idSource}. Keys: ${teacherKeys.length} | Global keys: ${globalKeys.length} | Total available: ${combined.length}`);

    return {
        keys: combined,
        teacherKeysSet: new Set(teacherKeys),
        globalKeysCount: globalKeys.length,
        teacherKeysCount: teacherKeys.length
    };
}

/**
 * Helper to push teacher API keys to Vercel automatically
 * This allows Vercel to use teacher's API keys for AI generation
 */
async function pushTeacherAPIKeyToVercel(teacherId, apiKey) {
    const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
    const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;

    console.log('[VERCEL DEBUG] VERCEL_TOKEN present:', !!VERCEL_TOKEN);
    console.log('[VERCEL DEBUG] VERCEL_PROJECT_ID present:', !!VERCEL_PROJECT_ID);

    if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) {
        console.warn('[VERCEL] VERCEL_TOKEN atau VERCEL_PROJECT_ID tidak dikonfigurasi, skipping auto-push');
        return null;
    }

    try {
        console.log(`[VERCEL] Pushing API key untuk teacher: ${teacherId}...`);

        // Generate env var name untuk teacher (e.g., TEACHER_DORKAS_APIKEY_1)
        const teacherSafe = teacherId.replace(/[^A-Z0-9_]/g, '_').substring(0, 30);
        const envKeyName = `TEACHER_${teacherSafe}_APIKEY_${Date.now()}`.substring(0, 50);

        console.log(`[VERCEL] Generated env var name: ${envKeyName}`);

        const vercelApi = 'https://api.vercel.com';
        const headers = {
            'Authorization': `Bearer ${VERCEL_TOKEN}`,
            'Content-Type': 'application/json'
        };

        const targets = ['production', 'preview', 'development'];
        console.log(`[VERCEL] Setting env var for targets: ${targets.join(', ')}`);

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

        console.log('[VERCEL] Env create response status:', response.status);

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            console.log('[VERCEL] Env create error:', JSON.stringify(error, null, 2));

            if (error.code === 'ENV_KEY_ALREADY_EXISTS') {
                console.log(`[VERCEL] ${envKeyName} sudah ada, mencoba update existing entries...`);

                const getRes = await fetch(`${vercelApi}/v9/projects/${VERCEL_PROJECT_ID}/env`, { headers });
                console.log('[VERCEL] Get env vars status:', getRes.status);

                if (!getRes.ok) throw new Error(`Failed to get env vars: ${getRes.statusText}`);

                const data = await getRes.json();
                const existingEnvs = (data.envs || []).filter(e => e.key === envKeyName);

                if (existingEnvs.length === 0) {
                    throw new Error('Env var exists but could not find existing entries');
                }

                for (const existingEnv of existingEnvs) {
                    console.log(`[VERCEL] Updating existing env var ID: ${existingEnv.id}`);
                    const updateRes = await fetch(`${vercelApi}/v9/projects/${VERCEL_PROJECT_ID}/env/${existingEnv.id}`, {
                        method: 'PATCH',
                        headers: headers,
                        body: JSON.stringify({ value: apiKey })
                    });
                    console.log(`[VERCEL] Update response status for ${existingEnv.id}:`, updateRes.status);
                    if (!updateRes.ok) throw new Error(`Failed to update ${existingEnv.id}: ${updateRes.statusText}`);
                }
                console.log(`[VERCEL] ✅ ${envKeyName} updated for existing targets`);
            } else {
                throw new Error(error.message || `HTTP ${response.status}`);
            }
        } else {
            console.log(`[VERCEL] ✅ ${envKeyName} set for all targets`);
        }

        console.log(`[VERCEL] ✅ API key berhasil di-push ke Vercel untuk ${teacherId}`);
        return envKeyName;

    } catch (err) {
        console.error(`[VERCEL] ❌ Gagal push API key ke Vercel: ${err.message}`);
        // Don't throw - ini adalah bonus feature, jangan error jika gagal
        return null;
    }
}

/**
 * Helper to call Gemini with key rotation and model fallback
 * Now includes teacher's personal API keys for quota pooling
 */
async function callGeminiAI(prompt, req) {
    const { keys, teacherKeysSet } = await getAllAvailableKeys('Gemini', req?.teacherId, req);

    if (keys.length === 0) {
        return logProviderSkip('Gemini');
    }

    // Super-charged model list for maximum resilience (including next-gen models)
    const models = [
        { name: 'gemini-3-flash', version: 'v1beta' },
        { name: 'gemini-3-pro', version: 'v1beta' },
        { name: 'gemini-2.5-flash', version: 'v1beta' },
        { name: 'gemini-2.5-pro', version: 'v1beta' },
        { name: 'gemini-3-flash', version: 'v1' },
        { name: 'gemini-3-pro', version: 'v1' },
        { name: 'gemini-2.5-flash', version: 'v1' },
        { name: 'gemini-2.5-pro', version: 'v1' },
        { name: 'gemini-2.0-flash', version: 'v1' },
        { name: 'gemini-1.5-flash', version: 'v1' },
        { name: 'gemini-1.5-flash-latest', version: 'v1beta' },
        { name: 'gemini-1.5-flash-latest', version: 'v1' },
        { name: 'gemini-1.5-flash-8b', version: 'v1' },
        { name: 'gemini-2.0-flash-lite-preview-02-05', version: 'v1' },
        { name: 'gemini-2.0-flash-lite-preview-02-05', version: 'v1beta' },
        { name: 'gemini-1.5-pro-latest', version: 'v1' },
        { name: 'gemini-1.5-pro', version: 'v1' },
        { name: 'gemini-1.5-pro-latest', version: 'v1beta' },
        { name: 'gemini-1.0-pro', version: 'v1' }
    ];

    let lastError;
    const exhaustedTeacherKeys = [];

    {
        for (const modelObj of models) {
            const { name: model, version } = modelObj;
            for (const key of keys) {
                try {
                    console.log(`[AI] Trying Gemini: ${model} (${version})...`);

                    const response = await fetch(`https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${key}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }],
                            generationConfig: {
                                maxOutputTokens: 8192,
                                temperature: 0.3
                            }
                        })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        const result = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        console.log(`[AI] ✅ Success with model: ${model}`);
                        return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                    }

                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData.error?.message || response.statusText;

                    if (response.status === 429) {
                        lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada model ${model} (${version}). Tolong tunggu beberapa menit atau gunakan API Key lain.`;
                        console.warn(`[AI] ⚠️ Quota exceeded for model: ${model}`);
                        if (req && req.teacherId && teacherKeysSet.has(key)) {
                            const marked = await markTeacherKeyExhausted(req.teacherId, key, `${model} ${version} 429`);
                            if (marked) exhaustedTeacherKeys.push(key);
                        } else if (!teacherKeysSet.has(key)) {
                            // This is a global key
                            const marked = await markGlobalKeyExhausted(key, `${model} ${version} 429`);
                            if (marked) console.log(`[AI] Marked global Gemini key as exhausted: ${key.substring(0, 10)}...`);
                        }
                        continue; // Quota issue, try next key
                    } else if (response.status === 404) {
                        lastError = `${model} (${version}): HTTP 404 - Model tidak ditemukan atau tidak tersedia untuk endpoint ini.`;
                        console.error(`[AI] ❌ Model ${model} not available on ${version}`);
                        break; // Model not exist, move to next model
                    } else {
                        lastError = `${model} (${version}): HTTP ${response.status} - ${errMsg}`;
                        console.error(`[AI] ❌ Model ${model} (${version}) error: ${response.status} ${errMsg}`);
                    }

                } catch (e) {
                    lastError = e.message;
                    console.error(`[AI] Fetch error with ${model}:`, e.message);
                }
            }
        }
    }

    const errMessage = /kuota|quota|limit|habis/i.test(lastError || '')
        ? 'Semua kuota Gemini saat ini habis. Coba lagi nanti atau tambahkan API Key di dashboard API Keys.'
        : (lastError || 'Gagal menggunakan Gemini');
    const err = new Error(errMessage);
    err.exhaustedKeys = exhaustedTeacherKeys;
    throw err;
}

/**
 * Helper to call OpenAI / ChatGPT
 */
async function callOpenAI(prompt, req) {
    const { keys, teacherKeysSet } = await getAllAvailableKeys('OpenAI', req?.teacherId, req);

    if (keys.length === 0) return logProviderSkip('OpenAI');

    const models = ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'];
    let lastError;
    const exhaustedTeacherKeys = [];

    for (const model of models) {
        for (const key of keys) {
            try {
                console.log(`[AI] Trying OpenAI model: ${model} with key: ${key.substring(0, 10)}...`);

                const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
                    console.log(`[AI] ✅ Success with OpenAI model: ${model}`);
                    return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || response.statusText;

                if (response.status === 429) {
                    lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada model OpenAI ${model}. Tolong isi saldo atau gunakan model lain.`;
                    console.warn(`[AI] ⚠️ OpenAI Quota exceeded for model: ${model}`);
                    if (req && req.teacherId && teacherKeysSet.has(key)) {
                        const marked = await markTeacherKeyExhausted(req.teacherId, key, `OpenAI ${model} 429`);
                        if (marked) {
                            exhaustedTeacherKeys.push(key);
                            console.log(`[AI] Marked OpenAI key as exhausted for teacher ${req.teacherId}`);
                        }
                    } else if (!teacherKeysSet.has(key)) {
                        // This is a global key
                        const marked = await markGlobalKeyExhausted(key, `OpenAI ${model} 429`);
                        if (marked) console.log(`[AI] Marked global OpenAI key as exhausted: ${key.substring(0, 10)}...`);
                    }
                    continue;
                } else {
                    lastError = `${model}: HTTP ${response.status} - ${errMsg}`;
                    console.error(`[AI] ❌ Model OpenAI ${model} error: ${response.status} ${errMsg}`);
                }

            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with OpenAI ${model}:`, e.message);
            }
        }
    }
    throw new Error(lastError || 'Gagal menggunakan OpenAI');
}

async function callOpenRouterAI(prompt, req) {
    const { keys, teacherKeysSet } = await getAllAvailableKeys('OpenRouter', req?.teacherId, req);

    if (keys.length === 0) return logProviderSkip('OpenRouter');

    const models = [
        'google/gemini-2.5-pro-exp-03-25:free',
        'google/gemini-2.0-flash-exp:free',
        'google/gemini-flash-1.5:free',
        'meta-llama/llama-3.3-70b-instruct:free',
        'deepseek/deepseek-r1:free',
        'deepseek/deepseek-chat:free',
        'qwen/qwen2.5-72b-instruct:free',
        'nvidia/llama-3.1-nemotron-70b-instruct:free',
        'mistralai/mistral-small-24b-instruct-2501:free',
    ];
    let lastError;
    const exhaustedTeacherKeys = [];

    for (const model of models) {
        for (const key of keys) {
            try {
                console.log(`[AI] Trying OpenRouter model: ${model} with key: ${key.substring(0, 10)}...`);

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
                    return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || response.statusText;

                if (response.status === 429) {
                    lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada OpenRouter model ${model}.`;
                    console.warn(`[AI] ⚠️ OpenRouter quota exceeded for model: ${model}`);
                    if (req && req.teacherId && teacherKeysSet.has(key)) {
                        const marked = await markTeacherKeyExhausted(req.teacherId, key, `OpenRouter ${model} 429`);
                        if (marked) {
                            exhaustedTeacherKeys.push(key);
                            console.log(`[AI] Marked OpenRouter key as exhausted for teacher ${req.teacherId}`);
                        }
                    } else if (!teacherKeysSet.has(key)) {
                        // This is a global key
                        const marked = await markGlobalKeyExhausted(key, `OpenRouter ${model} 429`);
                        if (marked) console.log(`[AI] Marked global OpenRouter key as exhausted: ${key.substring(0, 10)}...`);
                    }
                    continue;
                }

                lastError = `${model}: HTTP ${response.status} - ${errMsg}`;
                console.error(`[AI] ❌ OpenRouter model ${model} error: ${response.status} ${errMsg}`);
            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with OpenRouter ${model}:`, e.message);
            }
        }
    }

    throw new Error(lastError || 'Gagal menggunakan OpenRouter');
}

async function callOpenAIImage(prompt, req) {
    const rawKey = process.env.OPENAI_API_KEY || '';
    const keys = rawKey.split(',').map(k => k.trim()).filter(k => k);

    if (keys.length === 0) throw new Error('OPENAI_API_KEY tidak dikonfigurasi di Environment Variables');

    let lastError;
    for (const key of keys) {
        try {
            console.log(`[AI] Trying OpenAI image generation with key: ${key.substring(0, 10)}...`);
            const response = await fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: 'dall-e-3',
                    prompt: prompt,
                    size: '1024x1024',
                    quality: 'standard',
                    n: 1
                })
            });

            const data = await response.json();
            if (response.ok && data.data && Array.isArray(data.data) && data.data[0]?.url) {
                // Fetch the image from URL and convert to base64
                try {
                    const imageResponse = await fetch(data.data[0].url);
                    if (imageResponse.ok) {
                        const arrayBuffer = await imageResponse.arrayBuffer();
                        const base64 = Buffer.from(arrayBuffer).toString('base64');
                        return `data:image/png;base64,${base64}`;
                    }
                } catch (fetchError) {
                    console.warn('[AI] Failed to fetch image from URL:', fetchError.message);
                }
                // Fallback: return the URL directly if fetch fails
                return data.data[0].url;
            }

            const errMsg = data.error?.message || response.statusText || 'Unknown error';
            if (response.status === 429) {
                lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada OpenAI Images. ${errMsg}`;
                console.warn('[AI] ⚠️ OpenAI Images quota exceeded:', errMsg);
                continue;
            }

            lastError = `Image generation HTTP ${response.status}: ${errMsg}`;
            console.error('[AI] ❌ OpenAI Images error:', errMsg);
        } catch (e) {
            lastError = e.message;
            console.error('[AI] Fetch Error OpenAI Images:', e.message);
        }
    }

    throw new Error('OpenAI image generation gagal: ' + lastError);
}

async function attachGeneratedImagesToQuestions(questions, req) {
    const results = [];
    for (const q of questions) {
        if (q.images && Array.isArray(q.images) && q.images.length > 0 && q.images.every(src => typeof src === 'string' && src.trim())) {
            results.push(q);
            continue;
        }

        const promptText = (typeof q.imagePrompt === 'string' && q.imagePrompt.trim()) ? q.imagePrompt.trim() : (typeof q.text === 'string' ? q.text.trim() : '');
        if (!promptText) {
            results.push(q);
            continue;
        }

        try {
            const imageBase64 = await callOpenAIImage(`Ilustrasi untuk soal berikut: ${promptText}. Buat gambar ilustratif yang jelas dan sesuai konteks materi pelajaran.`);
            q.images = [imageBase64];
        } catch (e) {
            console.warn('[/api/generate-ai] Gagal Open AI Images, fallback ke Pollinations:', e.message);
            const promptEncoded = encodeURIComponent(promptText + " educational illustration graphic detail");
            q.images = [`https://image.pollinations.ai/prompt/${promptEncoded}?width=800&height=600&nologo=true`];
        }

        results.push(q);
    }
    return results;
}

/**
 * Fungsi untuk mengambil hanya bagian JSON dari respon AI yang kotor
 */
function cleanAIResponse(text) {
    try {
        // First try: extract from script tag if available
        const scriptMatch = text.match(/<script[^>]*id\s*=\s*["']?ai-json-data["']?[^>]*>([\s\S]*?)<\/script>/i);
        if (scriptMatch && scriptMatch[1]) {
            return scriptMatch[1].trim();
        }

        // Second try: extract and combine all JSON arrays from categorized format
        const jsonArrays = [];
        const lines = text.split('\n');
        let currentArray = null;

        for (const line of lines) {
            const trimmed = line.trim();

            // Check if this is a category header (contains "Soal)" )
            if (trimmed.includes(' Soal)') && !trimmed.includes('[') && !trimmed.includes('{')) {
                // Start of new category, reset current array
                currentArray = null;
                continue;
            }

            // Look for JSON array start
            if (trimmed.startsWith('[') && currentArray === null) {
                currentArray = trimmed;
            } else if (currentArray !== null) {
                currentArray += line;
            }

            // Check if we have a complete array
            if (currentArray && currentArray.includes(']')) {
                try {
                    const parsed = JSON.parse(currentArray);
                    if (Array.isArray(parsed)) {
                        jsonArrays.push(...parsed);
                    }
                } catch (e) {
                    // Not a valid JSON array, continue
                }
                currentArray = null;
            }
        }

        // If we found arrays, return combined array
        if (jsonArrays.length > 0) {
            return JSON.stringify(jsonArrays);
        }

        // Fallback: Cari karakter [ dan ] pertama dan terakhir
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1) {
            return text.substring(start, end + 1);
        }

        return text;
    } catch (e) {
        return text;
    }
}

function extractAiJsonData(text) {
    if (!text || typeof text !== 'string') {
        console.log(`[AI Bank Soal] extractAiJsonData: Invalid input`);
        return null;
    }

    console.log(`[AI Bank Soal] extractAiJsonData: Processing text of length ${text.length}`);

    // First try: exact script tag match
    const scriptMatch = text.match(/<script[^>]*id\s*=\s*["']?ai-json-data["']?[^>]*>([\s\S]*?)<\/script>/i);
    if (scriptMatch && scriptMatch[1]) {
        console.log(`[AI Bank Soal] extractAiJsonData: Found script tag, content length: ${scriptMatch[1].trim().length}`);
        return scriptMatch[1].trim();
    }
    console.log(`[AI Bank Soal] extractAiJsonData: No script tag found`);

    // Second try: look for JSON array at the end of the text (last 2000 characters)
    const endText = text.substring(Math.max(0, text.length - 2000));
    const fallbackMatch = endText.match(/(\[\s*\{[\s\S]*?\}\s*\])$/m);
    if (fallbackMatch && fallbackMatch[1]) {
        console.log(`[AI Bank Soal] extractAiJsonData: Found JSON at end of text, length: ${fallbackMatch[1].trim().length}`);
        return fallbackMatch[1].trim();
    }
    console.log(`[AI Bank Soal] extractAiJsonData: No JSON at end of text`);

    // Third try: look for any JSON array in the entire text
    const anyArrayMatch = text.match(/(\[\s*\{[\s\S]*?\}\s*\])/m);
    if (anyArrayMatch && anyArrayMatch[1]) {
        console.log(`[AI Bank Soal] extractAiJsonData: Found JSON anywhere in text, length: ${anyArrayMatch[1].trim().length}`);
        return anyArrayMatch[1].trim();
    }
    console.log(`[AI Bank Soal] extractAiJsonData: No JSON array found anywhere`);

    return null;
}

function extractOptionsFromText(text) {
    const options = [];
    if (!text || typeof text !== 'string') return options;

    const patterns = [
        // Pattern 1: (A) (B) (C) (D) format (most specific)
        /\(([A-D])\)\s*([\s\S]*?)(?=\s*\([A-D]\)|$)/gi,
        // Pattern 2: (1) (2) (3) (4) format
        /\(([1-5])\)\s*([\s\S]*?)(?=\s*\([1-5]\)|$)/gi,
        // Pattern 3: A) B) C) D) or A. B. C. D. format
        /([A-Ea-e])[\.\)]\s*([\s\S]*?)(?=\s*[A-Ea-e][\.\)]\s*|$)/g,
        // Pattern 4: 1. 2. 3. 4. format
        /([1-5])[\.\)]\s*([\s\S]*?)(?=\s*[1-5][\.\)]\s*|$)/g,
        // Pattern 5: *A. *B. *C. *D. (bullet format)
        /[\*•]\s*([A-E])[\.\)]\s*([\s\S]*?)(?=\s*[\*•]\s*[A-E][\.\)]|$)/gi,
        // Pattern 6: Just plain text separated by newline/semicolon
        /([^;\n]+)(?:[;\n]|$)/g
    ];

    for (const pattern of patterns) {
        let match;
        let patternOptions = [];
        while ((match = pattern.exec(text)) !== null && patternOptions.length < 4) {
            let optText = '';

            // Extract the text portion (could be in group 2 or 1 depending on pattern)
            if (match[2]) {
                optText = match[2].trim();
            } else if (match[1] && !/^[A-E1-5]$/i.test(match[1])) {
                // If group 1 is not a letter or number marker, it's the option text itself
                optText = match[1].trim();
            }

            // Clean the option text
            optText = optText
                .replace(/<[^>]*>/g, '')  // Remove HTML tags
                .replace(/&nbsp;/g, ' ')  // HTML entities
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#?\w+;/g, '')  // Other HTML entities
                .replace(/\n+/g, ' ')     // Replace newlines with space
                .trim();

            // Only add if it's meaningful text (and not just empty)
            if (optText && optText.length >= 1) {
                // Check if it's already in options (to avoid duplicates)
                if (!patternOptions.includes(optText)) {
                    patternOptions.push(optText);
                }
            }
        }

        if (patternOptions.length >= 4) {
            return patternOptions.slice(0, 4);  // Found and return
        } else if (patternOptions.length > 0) {
            // Save partial matches and continue trying other patterns
            options.push(...patternOptions);
        }
    }

    return options.slice(0, 4);  // Return best effort
}

/**
 * Parse questions from HTML content as last resort fallback
 */
function parseQuestionsFromHtml(htmlText, mapel, fase) {
    const questions = [];
    if (!htmlText || typeof htmlText !== 'string') return questions;

    console.log(`[AI Bank Soal] parseQuestionsFromHtml: Processing HTML of length ${htmlText.length}`);

    // Look for numbered questions (1., 2., etc.)
    const questionPattern = /(\d+)\.\s*([^?]+)\?([\s\S]*?)(?=\d+\.|$)/g;
    let match;

    while ((match = questionPattern.exec(htmlText)) !== null) {
        const questionNumber = match[1];
        const questionText = match[2].trim() + '?';
        const restOfQuestion = match[3];

        console.log(`[AI Bank Soal] parseQuestionsFromHtml: Found question ${questionNumber}: ${questionText.substring(0, 50)}...`);

        // Try to extract options (A., B., C., D.)
        let options = extractOptionsFromText(restOfQuestion);
        if (options.length < 4) {
            options = extractOptionsFromText(htmlText);
        }

        // Try to find correct answer (usually marked with * or in bold)
        let correct = 0; // default to A
        const correctPatterns = [
            /\*([A-D])\*/i,
            /<strong>\s*([A-D])\s*<\/strong>/i,
            /jawaban:\s*([A-D])/i,
            /benar:\s*([A-D])/i
        ];

        for (const pattern of correctPatterns) {
            const correctMatch = restOfQuestion.match(pattern);
            if (correctMatch) {
                const answer = correctMatch[1].toUpperCase();
                correct = ['A', 'B', 'C', 'D'].indexOf(answer);
                if (correct >= 0) break;
            }
        }

        if (options.length >= 4) {
            const questionType = detectQuestionType(questionText, options);
            const question = {
                text: questionText,
                options: options.slice(0, 4), // Take only first 4 options
                correct: correct,
                type: questionType,
                mapel: mapel,
                rombel: fase,
                level: 'sedang' // default level
            };
            questions.push(question);
            console.log(`[AI Bank Soal] parseQuestionsFromHtml: Successfully parsed ${questionType} question with ${options.length} options`);
        } else {
            console.log(`[AI Bank Soal] parseQuestionsFromHtml: Question ${questionNumber} has only ${options.length} options, skipping`);
        }
    }

    console.log(`[AI Bank Soal] parseQuestionsFromHtml: Total questions parsed: ${questions.length}`);
    return questions;
}

/**
 * Force parse questions from HTML - more aggressive approach
 */
function forceParseQuestionsFromHtml(htmlText, mapel, fase) {
    const questions = [];
    if (!htmlText || typeof htmlText !== 'string') return questions;

    console.log(`[AI Bank Soal] forceParseQuestionsFromHtml: Starting aggressive parsing of ${htmlText.length} chars`);

    const textSet = new Set();  // Track unique questions
    let currentType = 'single'; // Default type, will be updated based on category headers

    // Helper function to detect type from category header
    function detectTypeFromHeader(headerText) {
        const text = headerText.toLowerCase();
        if (text.includes('pilihan ganda') || text.includes('single') || text.includes('pg biasa')) {
            return 'single';
        }
        if (text.includes('pg kompleks') || text.includes('multiple') || text.includes('pilih beberapa')) {
            return 'multiple';
        }
        if (text.includes('benar/salah') || text.includes('tf') || text.includes('true/false')) {
            return 'tf';
        }
        if (text.includes('uraian') || text.includes('esai') || text.includes('text')) {
            return 'text';
        }
        if (text.includes('menjodohkan') || text.includes('matching') || text.includes('pasangkan')) {
            return 'matching';
        }
        return 'single'; // default
    }

    // STRATEGY 0: Check for AI structured format with category headers
    if (htmlText.includes(' Soal)') && htmlText.includes('[') && htmlText.includes('{')) {
        console.log(`[AI Bank Soal] Detected AI structured format, attempting direct JSON extraction...`);

        try {
            // Extract all JSON arrays from the text
            const jsonArrays = [];
            const lines = htmlText.split('\n');

            for (const line of lines) {
                const trimmed = line.trim();

                // Skip category headers
                if (trimmed.includes(' Soal)') && !trimmed.includes('[') && !trimmed.includes('{')) {
                    continue;
                }

                // Look for JSON array start
                if (trimmed.startsWith('[') && jsonArrays.length === 0) {
                    let currentArray = trimmed;
                    let braceCount = 0;
                    let inString = false;
                    let escapeNext = false;

                    // Parse character by character to find complete JSON array
                    for (let i = 0; i < currentArray.length; i++) {
                        const char = currentArray[i];

                        if (escapeNext) {
                            escapeNext = false;
                            continue;
                        }

                        if (char === '\\') {
                            escapeNext = true;
                            continue;
                        }

                        if (char === '"' && !escapeNext) {
                            inString = !inString;
                            continue;
                        }

                        if (!inString) {
                            if (char === '[') braceCount++;
                            else if (char === ']') braceCount--;

                            if (braceCount === 0 && char === ']') {
                                // Found complete array
                                try {
                                    const parsed = JSON.parse(currentArray);
                                    if (Array.isArray(parsed)) {
                                        jsonArrays.push(...parsed);
                                        console.log(`[AI Bank Soal] Extracted ${parsed.length} questions from AI format`);
                                    }
                                } catch (e) {
                                    console.warn(`[AI Bank Soal] Failed to parse JSON array: ${e.message}`);
                                }
                                break;
                            }
                        }
                    }
                }
            }

            // Process extracted questions
            if (jsonArrays.length > 0) {
                console.log(`[AI Bank Soal] Strategy 0: Extracted ${jsonArrays.length} questions from AI structured format`);

                for (const q of jsonArrays) {
                    if (q.text && q.text.trim()) {
                        const normalized = normalizeQuestion(q, mapel, fase);
                        if (normalized.text && normalized.text.trim()) {
                            const textKey = normalized.text.toLowerCase().trim();
                            if (!textSet.has(textKey)) {
                                textSet.add(textKey);
                                questions.push(normalized);
                            }
                        }
                    }
                }

                console.log(`[AI Bank Soal] Strategy 0 result: ${questions.length} valid questions`);
                return questions; // Return early if we successfully extracted from AI format
            }
        } catch (error) {
            console.warn(`[AI Bank Soal] Strategy 0 failed: ${error.message}`);
        }
    }

    // Helper function to detect question type
    function detectQuestionType(questionText, options) {
        const text = questionText.toLowerCase();

        // Check for essay/text questions (contains keywords)
        const essayKeywords = ['jelaskan', 'uraikan', 'deskripsikan', 'apa yang dimaksud', 'sebutkan',
            'berikan contoh', 'tuliskan', 'apa yang terjadi', 'bagaimana cara',
            'mengapa', 'kenapa', 'apa penyebab', 'apa akibat', 'apa fungsi',
            'apa perbedaan', 'apa persamaan', 'apa ciri', 'apa sifat',
            'tentukan', 'hitunglah', 'carilah', 'susunlah', 'buatlah'];

        const hasEssayKeyword = essayKeywords.some(keyword => text.startsWith(keyword) || text.includes(' ' + keyword));
        const isLongQuestion = text.length > 500; // Increased threshold from 120 to 500
        const hasNoOptions = !options || options.length < 2;
        const hasQuestionWords = text.includes('?') || text.includes('apakah') || text.includes('bagaimana');

        // If it has enough options, prioritize single/multiple choice over text
        if (options && options.length >= 4) {
            // Even if long or has question words, if NOT having explicit essay keyword at start, it's PG
            if (!hasEssayKeyword) return 'single';
        }

        if (hasEssayKeyword || (isLongQuestion && hasQuestionWords && hasNoOptions) || hasNoOptions) {
            console.log(`[AI Bank Soal] Detected TEXT question: "${questionText.substring(0, 50)}..." (keyword:${hasEssayKeyword}, long:${isLongQuestion}, noOpts:${hasNoOptions})`);
            return 'text';
        }

        // Check for true/false questions
        const tfKeywords = ['benar atau salah', 'benar/salah', 'true or false', 'true/false',
            'ya atau tidak', 'ya/tidak', 'betul atau salah', 'betul/salah'];
        const hasTfKeyword = tfKeywords.some(keyword => text.includes(keyword));

        const hasTfOptions = options && options.length === 2 &&
            ((options[0].toLowerCase().includes('benar') && options[1].toLowerCase().includes('salah')) ||
                (options[0].toLowerCase().includes('ya') && options[1].toLowerCase().includes('tidak')) ||
                (options[0].toLowerCase().includes('true') && options[1].toLowerCase().includes('false')) ||
                (options[0].toLowerCase().includes('betul') && options[1].toLowerCase().includes('salah')));

        if (hasTfKeyword || hasTfOptions) {
            console.log(`[AI Bank Soal] Detected TF question: "${questionText.substring(0, 50)}..." (keyword:${hasTfKeyword}, tfOpts:${hasTfOptions})`);
            return 'tf';
        }

        // Check for multiple choice (more than one correct answer indicated)
        const multipleKeywords = ['pilih yang benar', 'lebih dari satu', 'banyak jawaban', 'semua yang benar',
            'pilih beberapa', 'jawaban lebih dari satu', 'banyak pilihan benar',
            'pilih yang tepat', 'jawaban benar lebih dari satu'];
        if (multipleKeywords.some(keyword => text.includes(keyword))) {
            console.log(`[AI Bank Soal] Detected MULTIPLE question: "${questionText.substring(0, 50)}..."`);
            return 'multiple';
        }

        // Default to single choice
        console.log(`[AI Bank Soal] Detected SINGLE question: "${questionText.substring(0, 50)}..."`);
        return 'single';
    }

    // Removed global pre-scan for category headers to prevent currentType corruption.
    // Category detection will be handled localized within parsing strategies.


    // STRATEGY 1: Parse from HTML structure (ol/li with nested options)
    console.log(`[AI Bank Soal] Strategy 1: Parsing HTML structure...`);
    try {
        const liPattern = /<li[^>]*>([\s\S]*?)(?=<li[^>]*>|<\/ol[^>]*>|$)/gi;
        let match;
        let strategy1Count = 0;

        while ((match = liPattern.exec(htmlText)) !== null && questions.length < 100) {
            const liContent = match[1];

            let questionText = '';
            const patterns = [
                /<p[^>]*>([\s\S]*?)<\/p>/i,
                /^([^A-D][^.!?]*[.!?])/m,
                /^([\s\S]*?)(?=[A-D]\s*[\.\)]|$)/m
            ];

            for (const pattern of patterns) {
                const textMatch = liContent.match(pattern);
                if (textMatch && textMatch[1]) {
                    questionText = textMatch[1]
                        .replace(/<[^>]*>/g, '')
                        .replace(/&nbsp;/g, ' ')
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/\s+/g, ' ')
                        .trim();

                    if (questionText.length >= 10) break;
                }
            }

            if (!questionText || questionText.length < 10 || textSet.has(questionText)) continue;

            const options = [];
            const optionPatterns = [
                /([A-E1-5])\s*[\.\)]\s*([^A-E1-5\n]+?)(?=[A-E1-5]\s*[\.\)]|$)/gi,
                /<li[^>]*>([\s\S]*?)<\/li>/gi,
                /<strong[^>]*>\s*([A-E1-5])\s*[\.\)]\s*([^<]+?)<\/strong>/gi,
                /\b([A-E1-5])\.\s*([^\n]+?)(?=\b[A-E1-5]\.|$)/gi
            ];

            for (const optPattern of optionPatterns) {
                let optMatch;
                while ((optMatch = optPattern.exec(liContent)) !== null && options.length < 4) {
                    let optText = '';
                    if (optMatch[2]) {
                        optText = optMatch[2].replace(/<[^>]*>/g, '').replace(/&.*?;/g, '').trim();
                    } else if (optMatch[1]) {
                        optText = optMatch[1].replace(/<[^>]*>/g, '').replace(/&.*?;/g, '').trim();
                    }

                    if (optText && optText.length > 1 && !options.includes(optText)) {
                        options.push(optText);
                    }
                }
                if (options.length >= 4) break;
            }

            if (options.length < 4) {
                const afterQuestion = liContent.replace(questionText, '').trim();
                const fallbackOptions = extractOptionsFromText(afterQuestion);
                if (fallbackOptions.length > 0) {
                    fallbackOptions.forEach(opt => {
                        if (options.length < 4 && !options.includes(opt)) {
                            options.push(opt);
                        }
                    });
                }
            }

            // Determine question type dynamically
            let questionType = currentType === 'tf' ? 'tf' : 'single'; // Respect localized header if set, otherwise default
            let minOptions = 4;

            const detectedType = detectQuestionType(questionText, options);

            // Priority 1: If detected as single/multiple and has 4 options, use that
            if (options.length >= 4 && (detectedType === 'single' || detectedType === 'multiple')) {
                questionType = detectedType;
                minOptions = 4;
            } else if (detectedType === 'tf' || (questionType === 'tf' && options.length >= 2)) {
                questionType = 'tf';
                minOptions = 2;
            } else if (detectedType === 'text') {
                questionType = 'text';
                minOptions = 0;
            }
            // Auto-fallback: if it's 'tf' but doesn't have 2 options, it's not tf
            if (questionType === 'tf' && options.length < 2) {
                questionType = 'text';
                minOptions = 0;
            }
            // Auto-fallback: if it's 'single' but has < 4 options, it might be text
            if (questionType === 'single' && options.length < 4) {
                questionType = 'text';
                minOptions = 0;
            }

            if (options.length >= minOptions) {
                textSet.add(questionText);

                const question = {
                    text: questionText,
                    correct: 0,
                    type: questionType,
                    mapel: mapel,
                    rombel: fase,
                    level: 'sedang'
                };

                // Add type-specific fields
                if (questionType === 'text') {
                    // Essay questions don't need options
                    question.correct = '';
                } else if (questionType === 'tf') {
                    // True/False questions need subQuestions array
                    question.subQuestions = [
                        { text: questionText, correct: 0 } // Default to true
                    ];
                    question.options = options.slice(0, 2); // Only 2 options for TF
                } else {
                    // Single/multiple choice questions
                    question.options = options.slice(0, 4);
                }

                questions.push(question);
                strategy1Count++;
                console.log(`[AI Bank Soal] Strategy 1: Added ${questionType} question: "${questionText.substring(0, 50)}..."`);
            }
        }
        console.log(`[AI Bank Soal] Strategy 1 found ${strategy1Count} questions`);
    } catch (e) {
        console.warn(`[AI Bank Soal] HTML structure parsing failed: ${e.message}`);
    }

    // STRATEGY 2: Aggressive regex-based extraction from raw text
    if (questions.length < 10) {
        console.log(`[AI Bank Soal] Strategy 2: Regex extraction from raw text...`);

        const cleanText = htmlText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        let strategy2Count = 0;

        // Pattern: "1. Question text A. Option B. Option C. Option D. Option"
        // Pattern: "1. Question text A. Option B. Option..." or "1. Question text 1. Option 2. Option..."
        const numberedPattern = /(\d+)\.\s+([^A-E1\n]+?)(?=(?:A[\s.]+[^B]+?B[\s.]+[^C]+?C[\s.]+[^D]+?D[\s.]+|1[\s.]+[^2]+?2[\s.]+[^3]+?3[\s.]+[^4]+?4[\s.]+))/gi;
        let match;

        while ((match = numberedPattern.exec(cleanText)) !== null && questions.length < 100) {
            let questionText = match[2].trim();
            if (!textSet.has(questionText) && questionText.length > 10) {

                // Extract options from the context around the match
                const contextStart = match.index + match[0].length;
                const context = cleanText.substring(contextStart, contextStart + 300);
                const options = extractOptionsFromText(context);

                if (options.length >= 2) { // Allow TF questions with 2 options
                    // Determine question type dynamically for Strategy 2
                    let questionType = 'single';
                    const detectedType = detectQuestionType(questionText, options);

                    if (options.length >= 4) {
                        questionType = (detectedType === 'multiple') ? 'multiple' : 'single';
                    } else if (detectedType === 'tf' && options.length >= 2) {
                        questionType = 'tf';
                    } else {
                        questionType = detectedType;
                    }

                    textSet.add(questionText);

                    const question = {
                        text: questionText,
                        correct: 0,
                        type: questionType,
                        mapel: mapel,
                        rombel: fase,
                        level: 'sedang'
                    };

                    // Add type-specific fields
                    if (questionType === 'text') {
                        question.correct = '';
                    } else if (questionType === 'tf') {
                        question.subQuestions = [
                            { text: questionText, correct: 0 }
                        ];
                        question.options = options.slice(0, 2);
                    } else {
                        question.options = options.slice(0, 4);
                    }

                    questions.push(question);
                    strategy2Count++;
                    console.log(`[AI Bank Soal] Strategy 2: Added ${questionType} question: "${questionText.substring(0, 50)}..."`);
                }
            }
        }
        console.log(`[AI Bank Soal] Strategy 2 found ${strategy2Count} questions`);
    }

    // STRATEGY 3: Line-by-line text analysis
    if (questions.length < 10) {
        console.log(`[AI Bank Soal] Strategy 3: Line-by-line analysis...`);

        const cleanText = htmlText.replace(/<[^>]*>/g, ' ').replace(/&.*?;/g, '').trim();
        const lines = cleanText.split(/\n/).map(l => l.trim()).filter(l => l.length > 5);
        let strategy3Count = 0;

        for (let i = 0; i < lines.length && questions.length < 100; i++) {
            const line = lines[i];

            // Check for category header during line-by-line analysis
            if (line.match(/^(A\.|B\.|C\.|D\.|E\.|F\.|G\.|H\.|I\.|J\.|K\.|L\.|M\.|N\.|O\.|P\.|Q\.|R\.|S\.|T\.|U\.|V\.|W\.|X\.|Y\.|Z\.|\d+\.|\-\s*)?(Pilihan Ganda|PG|Multiple Choice|Benar\/Salah|TF|True\/False|Uraian|Esai|Text|Menjodohkan|Matching)/i) ||
                line.match(/(Pilihan Ganda|PG|Multiple Choice|Benar\/Salah|TF|True\/False|Uraian|Esai|Text|Menjodohkan|Matching).*Soal\)/i)) {
                currentType = detectTypeFromHeader(line);
                console.log(`[AI Bank Soal] Strategy 3: Updated currentType to ${currentType} from header: "${line}"`);
                continue;
            }

            // Check if line looks like a question (has question mark or is substantial)
            if ((line.includes('?') || line.split(' ').length > 5) &&
                line.length > 15 &&
                !textSet.has(line) &&
                !line.match(/^[A-E1-5]\s*[\.\)]/)) {

                // Look for options in next 5 lines
                const nextContent = lines.slice(i + 1, i + 6).join(' ');
                const options = extractOptionsFromText(nextContent);

                if (options.length >= 2) { // Allow TF questions with 2 options
                    let questionType = currentType; // Use type from current section

                    // Allow auto-detection to override if specific markers are found
                    const detectedType = detectQuestionType(line, options);

                    // If we are in 'text' (esai) section but found many options, it's actually PG
                    if (questionType === 'text' && options.length >= 4) {
                        questionType = 'single';
                    } else if (questionType !== 'tf' && detectedType === 'tf') {
                        questionType = 'tf';
                    } else if (questionType === 'single' && detectedType === 'text' && options.length < 2) {
                        questionType = 'text';
                    }

                    textSet.add(line);

                    const question = {
                        text: line,
                        correct: 0,
                        type: questionType,
                        mapel: mapel,
                        rombel: fase,
                        level: 'sedang'
                    };

                    // Add type-specific fields
                    if (questionType === 'text') {
                        question.correct = '';
                    } else if (questionType === 'tf') {
                        question.subQuestions = [
                            { text: line, correct: 0 }
                        ];
                        question.options = options.slice(0, 2);
                    } else {
                        question.options = options.slice(0, 4);
                    }

                    questions.push(question);
                    strategy3Count++;
                    console.log(`[AI Bank Soal] Strategy 3: Added ${questionType} question: "${line.substring(0, 50)}..."`);
                }
            }
        }
        console.log(`[AI Bank Soal] Strategy 3 found ${strategy3Count} questions`);
    }

    if (questions.length === 0) {
        console.log(`[AI Bank Soal] ⚠️ No questions found by any strategy`);
    } else if (questions.length < 5) {
        console.warn(`[AI Bank Soal] ⚠️ WARNING: Only ${questions.length} questions found (expected more)`);
    }

    console.log(`[AI Bank Soal] forceParseQuestionsFromHtml: Total ${questions.length} unique questions created`);
    return questions;
}
async function callHuggingFaceAI(prompt, req) {
    const { keys, teacherKeysSet } = await getAllAvailableKeys('HuggingFace', req?.teacherId, req);

    // Using the modern router endpoint for OpenAI compatibility
    const hfApiUrl = process.env.HUGGINGFACE_API_URL || 'https://router.huggingface.co/v1/chat/completions';

    if (keys.length === 0) return logProviderSkip('HuggingFace');

    const models = [
        'mistralai/Mistral-7B-Instruct-v0.3',
        'microsoft/Phi-3-mini-4k-instruct',
        'HuggingFaceH4/zephyr-7b-beta'
    ];

    let lastError;
    const exhaustedTeacherKeys = [];

    for (const model of models) {
        for (const key of keys) {
            try {
                console.log(`[AI] Trying HuggingFace model: ${model} with key: ${key.substring(0, 10)}...`);

                const response = await fetch(hfApiUrl, {
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

                    if (result) {
                        console.log(`[AI] ✅ Success with HuggingFace model: ${model}`);
                        return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                    }
                    console.warn('[AI] HuggingFace returned empty response body.');
                } else {
                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData.error?.message || errData.error || response.statusText;

                    if (response.status === 429 || response.status === 402) {
                        const reason = response.status === 429 ? '429 Quota' : '402 Balance';
                        lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada HuggingFace model ${model} (${reason}).`;
                        console.warn(`[AI] ⚠️ HuggingFace ${reason} for model: ${model}`);

                        if (req && req.teacherId && teacherKeysSet.has(key)) {
                            const marked = await markTeacherKeyExhausted(req.teacherId, key, `HuggingFace ${model} ${response.status}`);
                            if (marked) {
                                exhaustedTeacherKeys.push(key);
                                console.log(`[AI] Marked HuggingFace teacher key as exhausted for teacher ${req.teacherId}`);
                            }
                        } else if (!teacherKeysSet.has(key)) {
                            await markGlobalKeyExhausted(key, `HuggingFace ${model} ${response.status}`);
                            console.log(`[AI] Marked HuggingFace global key as exhausted`);
                        }
                        continue;
                    }

                    lastError = `${model}: HTTP ${response.status} - ${errMsg}`;
                    console.error(`[AI] ❌ HuggingFace model ${model} error: ${response.status} ${errMsg}`);
                }
            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with HuggingFace ${model}:`, e.message);
            }
        }
    }

    throw new Error(lastError || 'Gagal menggunakan HuggingFace');
}

/**
 * Helper to call Anthropic Claude menggunakan official SDK
 */
async function callAnthropicAI(prompt, req) {
    const { keys, teacherKeysSet } = await getAllAvailableKeys('Anthropic', req?.teacherId, req);

    if (keys.length === 0) return logProviderSkip('Anthropic');

    const models = ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'];
    let lastError;
    const exhaustedTeacherKeys = [];

    for (const model of models) {
        for (const key of keys) {
            try {
                console.log(`[AI] Trying Anthropic model: ${model} with key: ${key.substring(0, 10)}...`);

                const anthropic = new Anthropic({
                    apiKey: key,
                });

                const message = await anthropic.messages.create({
                    model: model,
                    max_tokens: 8192,
                    messages: [{ role: 'user', content: prompt }]
                });

                const result = message.content[0].text;
                console.log(`[AI] ✅ Success with Anthropic model: ${model}`);
                return { text: result, exhaustedKeys: exhaustedTeacherKeys };

            } catch (e) {
                // Check for credit balance errors (400 status) and quota errors (429 status)
                if (e.status === 429 || (e.status === 400 && e.message && e.message.includes('credit balance is too low'))) {
                    lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada Anthropic model ${model}.`;
                    console.warn(`[AI] ⚠️ Anthropic quota exceeded for model: ${model}`);
                    if (req && req.teacherId && teacherKeysSet.has(key)) {
                        const marked = await markTeacherKeyExhausted(req.teacherId, key, `Anthropic ${model} ${e.status === 429 ? '429' : 'insufficient credits'}`);
                        if (marked) {
                            exhaustedTeacherKeys.push(key);
                            console.log(`[AI] Marked Anthropic key as exhausted for teacher ${req.teacherId}`);
                        }
                    } else if (!teacherKeysSet.has(key)) {
                        // This is a global key
                        const marked = await markGlobalKeyExhausted(key, `Anthropic ${model} ${e.status === 429 ? '429' : 'insufficient credits'}`);
                        if (marked) console.log(`[AI] Marked global Anthropic key as exhausted: ${key.substring(0, 10)}...`);
                    }
                    continue;
                }

                lastError = `${model}: ${e.message}`;
                console.error(`[AI] ❌ Anthropic model ${model} error:`, e.message);
            }
        }
    }

    throw new Error(lastError || 'Gagal menggunakan Anthropic');
}

/**
 * Helper to call Grok (xAI)
 */
async function callGrokAI(prompt, req) {
    const { keys, teacherKeysSet } = await getAllAvailableKeys('Grok', req?.teacherId, req);

    if (keys.length === 0) return logProviderSkip('Grok');

    const models = ['grok-2-1212', 'grok-2-mini-1212', 'grok-beta'];
    let lastError;
    const exhaustedTeacherKeys = [];

    for (const model of models) {
        for (const key of keys) {
            try {
                console.log(`[AI] Trying Grok model: ${model} with key: ${key.substring(0, 10)}...`);

                const response = await fetch('https://api.x.ai/v1/chat/completions', {
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
                    console.log(`[AI] ✅ Success with Grok model: ${model}`);
                    return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || errData.error || response.statusText;

                if (response.status === 429 || response.status === 402) {
                    const statusStr = response.status === 429 ? 'KUOTA HABIS' : 'SALDO HABIS';
                    lastError = `[${statusStr}] pada Grok model ${model}.`;
                    console.warn(`[AI] ⚠️ Grok ${statusStr} for model: ${model}`);
                    if (req && req.teacherId && teacherKeysSet.has(key)) {
                        const marked = await markTeacherKeyExhausted(req.teacherId, key, `Grok ${model} ${response.status}`);
                        if (marked) {
                            exhaustedTeacherKeys.push(key);
                            console.log(`[AI] Marked Grok teacher key as exhausted for teacher ${req.teacherId}`);
                        }
                    } else if (!teacherKeysSet.has(key)) {
                        await markGlobalKeyExhausted(key, `Grok ${model} ${response.status}`);
                        console.log(`[AI] Marked Grok global key as exhausted`);
                    }
                    continue;
                }

                lastError = `${model}: HTTP ${response.status} - ${errMsg}`;
                console.error(`[AI] ❌ Grok model ${model} error: ${response.status} ${errMsg}`);
            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with Grok ${model}:`, e.message);
            }
        }
    }

    throw new Error(lastError || 'Gagal menggunakan Grok');
}

/**
 * Helper to call Groq (groq.com)
 */
async function callGroqAI(prompt, req) {
    const { keys, teacherKeysSet } = await getAllAvailableKeys('Groq', req?.teacherId, req);

    if (keys.length === 0) return logProviderSkip('Groq');

    const models = ['llama-3.3-70b-versatile', 'llama3-70b-8192', 'mixtral-8x7b-32768'];
    let lastError;
    const exhaustedTeacherKeys = [];

    for (const model of models) {
        for (const key of keys) {
            try {
                console.log(`[AI] Trying Groq model: ${model} with key: ${key.substring(0, 10)}...`);

                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
                    console.log(`[AI] ✅ Success with Groq model: ${model}`);
                    return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || errData.error || response.statusText;

                if (response.status === 429) {
                    lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada Groq model ${model}.`;
                    console.warn(`[AI] ⚠️ Groq quota exceeded for model: ${model}`);
                    if (req && req.teacherId && teacherKeysSet.has(key)) {
                        const marked = await markTeacherKeyExhausted(req.teacherId, key, `Groq ${model} 429`);
                        if (marked) {
                            exhaustedTeacherKeys.push(key);
                            console.log(`[AI] Marked Groq teacher key as exhausted for teacher ${req.teacherId}`);
                        }
                    } else if (!teacherKeysSet.has(key)) {
                        await markGlobalKeyExhausted(key, `Groq ${model} 429`);
                        console.log(`[AI] Marked Groq global key as exhausted`);
                    }
                    continue;
                }

                lastError = `${model}: HTTP ${response.status} - ${errMsg}`;
                console.error(`[AI] ❌ Groq model ${model} error: ${response.status} ${errMsg}`);
            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with Groq ${model}:`, e.message);
            }
        }
    }

    throw new Error(lastError || 'Gagal menggunakan Groq');
}

/**
 * Helper to call Mistral AI
 */
async function callMistralAI(prompt, req) {
    const { keys, teacherKeysSet } = await getAllAvailableKeys('Mistral', req?.teacherId, req);

    if (keys.length === 0) return logProviderSkip('Mistral');

    const models = ['mistral-large-latest', 'mistral-medium', 'mistral-small'];
    let lastError;
    const exhaustedTeacherKeys = [];

    for (const model of models) {
        for (const key of keys) {
            try {
                console.log(`[AI] Trying Mistral model: ${model} with key: ${key.substring(0, 10)}...`);

                const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
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
                    console.log(`[AI] ✅ Success with Mistral model: ${model}`);
                    return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || response.statusText;

                if (response.status === 429) {
                    lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada Mistral model ${model}.`;
                    console.warn(`[AI] ⚠️ Mistral quota exceeded for model: ${model}`);
                    if (req && req.teacherId && teacherKeysSet.has(key)) {
                        const marked = await markTeacherKeyExhausted(req.teacherId, key, `Mistral ${model} 429`);
                        if (marked) {
                            exhaustedTeacherKeys.push(key);
                            console.log(`[AI] Marked Mistral teacher key as exhausted for teacher ${req.teacherId}`);
                        }
                    } else if (!teacherKeysSet.has(key)) {
                        // This is a global key
                        await markGlobalKeyExhausted(key, `Mistral ${model} 429`);
                        console.log(`[AI] Marked Mistral global key as exhausted`);
                    }
                    continue;
                }

                lastError = `${model}: HTTP ${response.status} - ${errMsg}`;
                console.error(`[AI] ❌ Mistral model ${model} error: ${response.status} ${errMsg}`);
            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with Mistral ${model}:`, e.message);
            }
        }
    }

    throw new Error(lastError || 'Gagal menggunakan Mistral');
}

/**
 * Helper to call Cohere
 */
async function callCohereAI(prompt, req) {
    const { keys, teacherKeysSet } = await getAllAvailableKeys('Cohere', req?.teacherId, req);

    if (keys.length === 0) return logProviderSkip('Cohere');

    const models = ['command-r-plus', 'command-r', 'command'];
    let lastError;
    const exhaustedTeacherKeys = [];

    for (const model of models) {
        for (const key of keys) {
            try {
                console.log(`[AI] Trying Cohere model: ${model} with key: ${key.substring(0, 10)}...`);

                const response = await fetch('https://api.cohere.ai/v1/chat', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model,
                        message: prompt,
                        max_tokens: 8192,
                        temperature: 0.3
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const result = data.text || '';
                    console.log(`[AI] ✅ Success with Cohere model: ${model}`);
                    return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.message || response.statusText;

                if (response.status === 429) {
                    lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada Cohere model ${model}.`;
                    console.warn(`[AI] ⚠️ Cohere quota exceeded for model: ${model}`);
                    if (req && req.teacherId && teacherKeysSet.has(key)) {
                        const marked = await markTeacherKeyExhausted(req.teacherId, key, `Cohere ${model} 429`);
                        if (marked) {
                            exhaustedTeacherKeys.push(key);
                            console.log(`[AI] Marked Cohere teacher key as exhausted for teacher ${req.teacherId}`);
                        }
                    } else if (!teacherKeysSet.has(key)) {
                        // This is a global key
                        await markGlobalKeyExhausted(key, `Cohere ${model} 429`);
                        console.log(`[AI] Marked Cohere global key as exhausted`);
                    }
                    continue;
                }

                lastError = `${model}: HTTP ${response.status} - ${errMsg}`;
                console.error(`[AI] ❌ Cohere model ${model} error: ${response.status} ${errMsg}`);
            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with Cohere ${model}:`, e.message);
            }
        }
    }

    throw new Error(lastError || 'Gagal menggunakan Cohere');
}

/**
 * Helper to call Together AI
 */
async function callTogetherAI(prompt, req) {
    const { keys, teacherKeysSet } = await getAllAvailableKeys('Together AI', req?.teacherId, req);

    if (keys.length === 0) return logProviderSkip('Together AI');

    const models = ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mistral-7B-Instruct-v0.1', 'microsoft/WizardLM-2-8x22B'];
    let lastError;
    const exhaustedTeacherKeys = [];

    for (const model of models) {
        for (const key of keys) {
            try {
                console.log(`[AI] Trying Together AI model: ${model} with key: ${key.substring(0, 10)}...`);

                const response = await fetch('https://api.together.xyz/v1/chat/completions', {
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
                    console.log(`[AI] ✅ Success with Together AI model: ${model}`);
                    return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || response.statusText;

                if (response.status === 429) {
                    lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada Together AI model ${model}.`;
                    console.warn(`[AI] ⚠️ Together AI quota exceeded for model: ${model}`);
                    if (req && req.teacherId && teacherKeysSet.has(key)) {
                        const marked = await markTeacherKeyExhausted(req.teacherId, key, `Together AI ${model} 429`);
                        if (marked) {
                            exhaustedTeacherKeys.push(key);
                            console.log(`[AI] Marked Together AI teacher key as exhausted for teacher ${req.teacherId}`);
                        }
                    } else if (!teacherKeysSet.has(key)) {
                        // This is a global key
                        await markGlobalKeyExhausted(key, `Together AI ${model} 429`);
                        console.log(`[AI] Marked Together AI global key as exhausted`);
                    }
                    continue;
                }

                lastError = `${model}: HTTP ${response.status} - ${errMsg}`;
                console.error(`[AI] ❌ Together AI model ${model} error: ${response.status} ${errMsg}`);
            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with Together AI ${model}:`, e.message);
            }
        }
    }

    throw new Error(lastError || 'Gagal menggunakan Together AI');
}

/**
 * Helper to call DeepSeek AI
 */
async function callDeepSeekAI(prompt, req) {
    const { keys, teacherKeysSet } = await getAllAvailableKeys('DeepSeek', req?.teacherId, req);

    if (keys.length === 0) return logProviderSkip('DeepSeek');

    const models = ['deepseek-chat', 'deepseek-coder'];
    let lastError;
    const exhaustedTeacherKeys = [];

    for (const model of models) {
        for (const key of keys) {
            try {
                console.log(`[AI] Trying DeepSeek model: ${model} with key: ${key.substring(0, 10)}...`);

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
                    return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || errData.error || response.statusText;

                if (response.status === 429 || response.status === 402) {
                    const statusStr = response.status === 429 ? 'KUOTA HABIS' : 'SALDO HABIS';
                    lastError = `[${statusStr}] pada DeepSeek model ${model}.`;
                    console.warn(`[AI] ⚠️ DeepSeek ${statusStr} for model: ${model}`);
                    if (req && req.teacherId && teacherKeysSet.has(key)) {
                        const marked = await markTeacherKeyExhausted(req.teacherId, key, `DeepSeek ${model} ${response.status}`);
                        if (marked) {
                            exhaustedTeacherKeys.push(key);
                            console.log(`[AI] Marked DeepSeek teacher key as exhausted for teacher ${req.teacherId}`);
                        }
                    } else if (!teacherKeysSet.has(key)) {
                        // This is a global key
                        await markGlobalKeyExhausted(key, `DeepSeek ${model} ${response.status}`);
                        console.log(`[AI] Marked DeepSeek global key as exhausted`);
                    }
                    continue;
                }

                lastError = `${model}: HTTP ${response.status} - ${errMsg}`;
                console.error(`[AI] ❌ DeepSeek model ${model} error: ${response.status} ${errMsg}`);
            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with DeepSeek ${model}:`, e.message);
            }
        }
    }

    throw new Error(lastError || 'Gagal menggunakan DeepSeek');
}

/**
 * Helper to call Vercel AI Gateway
 * Mendukung banyak model dari berbagai provider lewat satu API key
 * Daftar model: https://vercel.com/ai/models
 */
async function callVercelAI(prompt, req) {
    const { keys, teacherKeysSet } = await getAllAvailableKeys('Vercel', req?.teacherId, req);

    if (keys.length === 0) return logProviderSkip('Vercel AI');

    // Vercel AI Gateway: format model adalah "provider/model-name"
    // Semua model ini bisa diakses lewat satu Vercel AI API key
    const models = [
        'openai/gpt-4o',
        'anthropic/claude-3-5-sonnet-20241022',
        'google/gemini-2.0-flash',
        'meta-llama/llama-3.3-70b-instruct',
        'openai/gpt-4o-mini',
        'anthropic/claude-3-haiku-20240307',
        'google/gemini-1.5-flash',
        'mistral/mistral-large-latest',
        'deepseek/deepseek-chat'
    ];

    // Vercel AI Gateway menggunakan OpenAI-compatible API
    const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

    let lastError;
    const exhaustedTeacherKeys = [];

    for (const model of models) {
        for (const key of keys) {
            try {
                console.log(`[AI] Trying Vercel AI Gateway model: ${model} with key: ${key.substring(0, 10)}...`);

                const response = await fetch(GATEWAY_URL, {
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
                    if (result) {
                        console.log(`[AI] ✅ Success with Vercel AI Gateway model: ${model}`);
                        return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                    }
                    console.warn(`[AI] Vercel AI Gateway returned empty response for model: ${model}`);
                    continue;
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || errData.error || response.statusText;

                if (response.status === 429) {
                    lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada Vercel AI Gateway model ${model}.`;
                    console.warn(`[AI] ⚠️ Vercel AI Gateway quota exceeded for model: ${model}`);
                    if (req && req.teacherId && teacherKeysSet.has(key)) {
                        const marked = await markTeacherKeyExhausted(req.teacherId, key, `Vercel AI ${model} 429`);
                        if (marked) {
                            exhaustedTeacherKeys.push(key);
                            console.log(`[AI] Marked Vercel AI teacher key as exhausted for teacher ${req.teacherId}`);
                        }
                    } else if (!teacherKeysSet.has(key)) {
                        await markGlobalKeyExhausted(key, `Vercel AI ${model} 429`);
                        console.log(`[AI] Marked Vercel AI global key as exhausted`);
                    }
                    continue;
                } else if (response.status === 401 || response.status === 403) {
                    lastError = `Vercel AI Gateway: API Key tidak valid atau tidak punya akses ke model ${model}. Pastikan key diisi di dashboard Vercel.`;
                    console.error(`[AI] ❌ Vercel AI Gateway auth error (${response.status}) for model: ${model}`);
                    break; // Key invalid, stop trying more models with same key
                }

                lastError = `${model}: HTTP ${response.status} - ${errMsg}`;
                console.error(`[AI] ❌ Vercel AI Gateway model ${model} error: ${response.status} ${errMsg}`);

            } catch (e) {
                lastError = e.message;
                console.error(`[AI] Fetch Error with Vercel AI Gateway ${model}:`, e.message);
            }
        }
    }

    throw new Error(lastError || 'Gagal menggunakan Vercel AI Gateway');
}

/**
 * Unified AI caller with fully automatic fallback mechanism
 * Now includes teacher's personal API keys for quota pooling
 */
async function callAI(prompt, req) {
    const errors = [];

    const tryProvider = async (name, fn) => {
        try {
            const result = await fn();
            if (result === null) return null;
            if (typeof result === 'string') {
                return { text: result, exhaustedKeys: [] };
            }
            if (result && typeof result === 'object' && typeof result.text === 'string') {
                return result;
            }
            return { text: String(result || ''), exhaustedKeys: [] };
        } catch (e) {
            errors.push(`${name} gagal: ${e.message}`);
            console.warn(`[AI] ${name} failed (${e.message}), automatically falling back...`);
            return null;
        }
    };

    let result = await tryProvider('Gemini', () => callGeminiAI(prompt, req));
    if (result) return result;

    result = await tryProvider('Vercel AI', () => callVercelAI(prompt, req));
    if (result) return result;

    result = await tryProvider('OpenAI', () => callOpenAI(prompt, req));
    if (result) return result;

    result = await tryProvider('OpenRouter', () => callOpenRouterAI(prompt, req));
    if (result) return result;

    result = await tryProvider('HuggingFace', () => callHuggingFaceAI(prompt, req));
    if (result) return result;

    result = await tryProvider('DeepSeek', () => callDeepSeekAI(prompt, req));
    if (result) return result;

    result = await tryProvider('Anthropic', () => callAnthropicAI(prompt, req));
    if (result) return result;

    result = await tryProvider('Grok', () => callGrokAI(prompt, req));
    if (result) return result;

    result = await tryProvider('Groq', () => callGroqAI(prompt, req));
    if (result) return result;

    result = await tryProvider('Mistral', () => callMistralAI(prompt, req));
    if (result) return result;

    result = await tryProvider('Cohere', () => callCohereAI(prompt, req));
    if (result) return result;

    result = await tryProvider('Together AI', () => callTogetherAI(prompt, req));
    if (result) return result;

    if (errors.length === 0) {
        throw new Error('Tidak ada provider AI terkonfigurasi. Silakan tambahkan minimal satu API key.');
    }
    throw new Error('Semua provider AI gagal: ' + errors.join(' | '));
}

// ─── API: Teacher API Key Management ───────────────────────────────────────────
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

        // Push to Vercel (async, don't wait)
        const vercelEnvVar = await pushTeacherAPIKeyToVercel(teacherId, apiKey.trim());

        return res.json({
            ok: true,
            message: 'API Key berhasil ditambahkan',
            teacher: teacher.name,
            keyCount: teacher.apiKeys.length,
            vercelStatus: vercelEnvVar ? `Auto-pushed sebagai ${vercelEnvVar}` : 'Local only (Vercel tidak dikonfigurasi)'
        });

    } catch (err) {
        console.error('[TEACHER API KEY ERROR]:', err.message);
        res.status(500).json({ error: 'Gagal menambahkan API Key: ' + err.message });
    }
});

// ─── API: Teacher Remove API Key ───────────────────────────────────────────────
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

        // TODO: Remove dari Vercel juga (opsional, complex)

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

// ─── API: Get Teacher API Keys ───────────────────────────────────────────────
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

// ─── API: Get Global API Keys ────────────────────────────────────────────────
app.get('/api/teacher/global-api-keys', async (req, res) => {
    try {
        const globalKeys = [];
        const db = await readDB();
        if (!db.globalAPIKeysStatus) {
            db.globalAPIKeysStatus = {};
        }

        // 1. Get keys from Database (Supabase)
        if (db.globalSettings && Array.isArray(db.globalSettings.apiKeys)) {
            db.globalSettings.apiKeys.forEach((entry, idx) => {
                globalKeys.push({
                    ...entry,
                    addedAt: entry.addedAt || 'Supabase DB',
                    isGlobal: true,
                    isFromDB: true
                });
            });
        }

        // 2. Get Gemini keys from environment
        const geminiRaw = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
        const geminiKeys = geminiRaw.split(',').map(k => k.trim()).filter(k => k);

        geminiKeys.forEach((key, idx) => {
            const keyHash = key.substring(key.length - 10);
            const statusEntry = db.globalAPIKeysStatus[keyHash] || { status: 'active' };

            globalKeys.push({
                key: key,
                provider: 'Google Gemini',
                status: statusEntry.status,
                addedAt: 'System / Environment',
                updatedAt: statusEntry.exhaustedAt || new Date().toISOString(),
                note: statusEntry.note || `Global key #${idx + 1}`,
                isGlobal: true,
                quotaInfo: statusEntry.status === 'exhausted'
                    ? '❌ QUOTA EXHAUSTED - Tidak dapat digunakan'
                    : 'Gemini: 15 requests/min (free tier), unlimited dengan billing'
            });
        });

        // Get OpenAI keys from environment
        const openaiRaw = process.env.OPENAI_API_KEY || '';
        const openaiKeys = openaiRaw.split(',').map(k => k.trim()).filter(k => k);

        openaiKeys.forEach((key, idx) => {
            const keyHash = key.substring(key.length - 10);
            const statusEntry = db.globalAPIKeysStatus[keyHash] || { status: 'active' };

            globalKeys.push({
                key: key,
                provider: 'OpenAI (ChatGPT)',
                status: statusEntry.status,
                addedAt: 'System / Environment',
                updatedAt: statusEntry.exhaustedAt || new Date().toISOString(),
                note: statusEntry.note || `Global key #${idx + 1}`,
                isGlobal: true,
                quotaInfo: statusEntry.status === 'exhausted'
                    ? '❌ QUOTA EXHAUSTED - Tidak dapat digunakan'
                    : 'OpenAI: Rate limits sesuai plan (Standard: 3,500 RPM / 200,000 TPM)'
            });
        });

        const openrouterRaw = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || process.env.OPEN_ROUTER_KEY || '';
        const openrouterKeys = openrouterRaw.split(',').map(k => k.trim()).filter(k => k);

        openrouterKeys.forEach((key, idx) => {
            const keyHash = key.substring(key.length - 10);
            const statusEntry = db.globalAPIKeysStatus[keyHash] || { status: 'active' };

            globalKeys.push({
                key: key,
                provider: 'OpenRouter',
                status: statusEntry.status,
                addedAt: 'System / Environment',
                updatedAt: statusEntry.exhaustedAt || new Date().toISOString(),
                note: statusEntry.note || `Global key #${idx + 1}`,
                isGlobal: true,
                quotaInfo: statusEntry.status === 'exhausted'
                    ? '❌ QUOTA EXHAUSTED - Tidak dapat digunakan'
                    : 'OpenRouter: Rate limits sesuai plan penyedia'
            });
        });

        // Get Groq keys from environment
        const groqRaw = process.env.GROQ_API_KEY || '';
        const groqKeys = groqRaw.split(',').map(k => k.trim()).filter(k => k);

        groqKeys.forEach((key, idx) => {
            const keyHash = key.substring(key.length - 10);
            const statusEntry = db.globalAPIKeysStatus[keyHash] || { status: 'active' };

            globalKeys.push({
                key: key,
                provider: 'Groq',
                status: statusEntry.status,
                addedAt: 'System / Environment',
                updatedAt: statusEntry.exhaustedAt || new Date().toISOString(),
                note: statusEntry.note || `Global key #${idx + 1}`,
                isGlobal: true,
                quotaInfo: statusEntry.status === 'exhausted'
                    ? '❌ QUOTA EXHAUSTED - Tidak dapat digunakan'
                    : 'Groq: Ultra-fast inference (Llama 3, Mixtral)'
            });
        });

        // Get DeepSeek keys from environment
        const deepseekRaw = process.env.DEEPSEEK_API_KEY || '';
        const deepseekKeys = deepseekRaw.split(',').map(k => k.trim()).filter(k => k);

        deepseekKeys.forEach((key, idx) => {
            const keyHash = key.substring(key.length - 10);
            const statusEntry = db.globalAPIKeysStatus[keyHash] || { status: 'active' };

            globalKeys.push({
                key: key,
                provider: 'DeepSeek',
                status: statusEntry.status,
                addedAt: 'System / Environment',
                updatedAt: statusEntry.exhaustedAt || new Date().toISOString(),
                note: statusEntry.note || `Global key #${idx + 1}`,
                isGlobal: true,
                quotaInfo: statusEntry.status === 'exhausted'
                    ? '❌ QUOTA EXHAUSTED - Tidak dapat digunakan'
                    : 'DeepSeek: Rate limits sesuai plan (Free tier tersedia)'
            });
        });

        const exhaustedCount = globalKeys.filter(k => k.status === 'exhausted').length;
        const activeCount = globalKeys.length - exhaustedCount;

        return res.json({
            ok: true,
            globalKeys: globalKeys,
            totalCount: globalKeys.length,
            activeCount: activeCount,
            exhaustedCount: exhaustedCount,
            geminiCount: geminiKeys.length,
            openaiCount: openaiKeys.length,
            openrouterCount: openrouterKeys.length,
            deepseekCount: deepseekKeys.length,
            groqCount: groqKeys.length,
            fallbackNote: 'Global key digunakan sebagai fallback jika personal key tidak tersedia atau kuota habis'
        });
    } catch (err) {
        console.error('[GET GLOBAL KEYS ERROR]:', err.message);
        res.status(500).json({ error: 'Gagal mengambil daftar global key: ' + err.message });
    }
});

// ─── API: Admin Get Global API Keys ──────────────────────────────────────────
/**
 * Helper to read Global API Keys from Supabase
 * Falls back to database.json if Supabase not configured
 */
async function getGlobalAPIKeysFromSupabase() {
    if (USE_SUPABASE && supabase) {
        try {
            const { data, error } = await supabase
                .from('global_api_keys')
                .select('*')
                .order('added_at', { ascending: false });

            if (error && error.code !== 'PGRST116') {
                console.error('[Supabase] Error reading global API keys:', error);
                return null;
            }

            // Helper function to detect provider from API key
            function detectProviderFromKey(key) {
                if (!key) return 'Unknown';
                if (key.startsWith('AIzaSy')) return 'Google Gemini';
                if (key.startsWith('sk-')) return 'OpenAI (ChatGPT)';
                if (key.startsWith('sk-or-v1-') || key.startsWith('sk-or-')) return 'OpenRouter';
                if (key.startsWith('gsk_')) return 'Groq';
                if (key.includes('deepseek')) return 'DeepSeek';
                return 'Unknown';
            }

            const processedData = (data || []).map(async (row) => {
                const detectedProvider = detectProviderFromKey(row.key);

                // If the stored provider doesn't match the detected provider, update it
                if (detectedProvider !== 'Unknown' && row.provider !== detectedProvider) {
                    try {
                        await updateGlobalAPIKeyProviderInSupabase(row.id, detectedProvider);
                        console.log(`[Supabase] Corrected provider for key ${row.key.substring(0, 10)}... from '${row.provider}' to '${detectedProvider}'`);
                        row.provider = detectedProvider; // Update the row for immediate use
                    } catch (updateErr) {
                        console.warn(`[Supabase] Failed to update provider for key ${row.key.substring(0, 10)}...:`, updateErr.message);
                    }
                }

                return {
                    key: row.key,
                    provider: row.provider,
                    status: row.status,
                    addedAt: row.added_at,
                    updatedAt: row.updated_at,
                    note: row.note,
                    vercelEnvVar: row.vercel_env_var
                };
            });

            // Wait for all async operations to complete
            return await Promise.all(processedData);
        } catch (err) {
            console.error('[Supabase] Exception reading global API keys:', err.message);
            return null;
        }
    }
    return null;
}

/**
 * Helper to add Global API Key to Supabase
 */
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

/**
 * Helper to remove Global API Key from Supabase
 */
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

/**
 * Helper to update Global API Key status in Supabase
 */
async function updateGlobalAPIKeyStatusInSupabase(keyId, status, note = '') {
    if (!USE_SUPABASE || !supabase) {
        throw new Error('Supabase not configured');
    }

    try {
        const { error } = await supabase
            .from('global_api_keys')
            .update({
                status,
                note,
                updated_at: new Date().toISOString()
            })
            .eq('id', keyId);

        if (error) {
            throw new Error('Update failed: ' + error.message);
        }

        console.log('[Supabase] Global API key status updated, ID:', keyId, 'status:', status);
    } catch (err) {
        console.error('[Supabase] Error updating global API key status:', err.message);
        throw err;
    }
}

/**
 * Helper to update Global API Key provider in Supabase (for correction)
 */
async function updateGlobalAPIKeyProviderInSupabase(keyId, provider) {
    if (!USE_SUPABASE || !supabase) {
        throw new Error('Supabase not configured');
    }

    try {
        const { error } = await supabase
            .from('global_api_keys')
            .update({
                provider: provider,
                updated_at: new Date().toISOString()
            })
            .eq('id', keyId);

        if (error) {
            throw new Error('Provider update failed: ' + error.message);
        }

        console.log('[Supabase] Global API key provider updated, ID:', keyId, 'provider:', provider);
    } catch (err) {
        console.error('[Supabase] Error updating global API key provider:', err.message);
        throw err;
    }
}

app.get('/api/admin/global-api-keys', async (req, res) => {
    try {
        let globalKeys = [];

        // 1. Try to get from Supabase first
        if (USE_SUPABASE) {
            try {
                const supabaseKeys = await getGlobalAPIKeysFromSupabase();
                if (supabaseKeys) {
                    globalKeys = supabaseKeys.map(k => ({
                        ...k,
                        isGlobal: true,
                        isFromSupabase: true,
                        quotaInfo: k.status === 'exhausted'
                            ? '❌ QUOTA EXHAUSTED - Tidak dapat digunakan'
                            : `${k.provider}: Tersimpan di Supabase`
                    }));
                    console.log('[API] Loaded', globalKeys.length, 'global API keys dari Supabase');
                }
            } catch (err) {
                console.error('[API] Error reading from Supabase, falling back to database.json:', err.message);
            }
        }

        // 2. If Supabase empty/failed, fallback to database.json
        if (globalKeys.length === 0) {
            const db = await readDB();
            if (!db.globalAPIKeysStatus) {
                db.globalAPIKeysStatus = {};
            }

            if (db.globalSettings && Array.isArray(db.globalSettings.apiKeys)) {
                // Helper function to detect provider from API key
                function detectProviderFromKey(key) {
                    if (!key) return 'Unknown';
                    if (key.startsWith('AIzaSy')) return 'Google Gemini';
                    if (key.startsWith('sk-')) return 'OpenAI (ChatGPT)';
                    if (key.startsWith('sk-or-v1-') || key.startsWith('sk-or-')) return 'OpenRouter';
                    if (key.startsWith('gsk_')) return 'Groq';
                    if (key.includes('deepseek')) return 'DeepSeek';
                    return 'Unknown';
                }

                globalKeys = db.globalSettings.apiKeys.map((entry, idx) => {
                    const detectedProvider = detectProviderFromKey(entry.key);

                    // If the stored provider doesn't match the detected provider, update it in database
                    if (detectedProvider !== 'Unknown' && entry.provider !== detectedProvider) {
                        entry.provider = detectedProvider;
                        console.log(`[Database] Corrected provider for key ${entry.key.substring(0, 10)}... from '${entry.provider}' to '${detectedProvider}'`);
                    }

                    return {
                        ...entry,
                        addedAt: entry.addedAt || 'Database JSON',
                        isGlobal: true,
                        isFromDB: true,
                        quotaInfo: entry.status === 'exhausted'
                            ? '❌ QUOTA EXHAUSTED - Tidak dapat digunakan'
                            : `${entry.provider}: Tersimpan di Database JSON`
                    };
                });

                // Save the corrected database back
                await writeDB(db);
            }
        }

        // 3. Get Environment keys (as fallback/supplement)
        const db = await readDB();
        if (!db.globalAPIKeysStatus) {
            db.globalAPIKeysStatus = {};
        }

        // Get Gemini keys from environment
        const geminiRaw = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
        const geminiKeys = geminiRaw.split(',').map(k => k.trim()).filter(k => k);

        geminiKeys.forEach((key, idx) => {
            // Only add if not already in main list
            if (!globalKeys.some(k => k.key === key)) {
                const keyHash = key.substring(key.length - 10);
                const statusEntry = db.globalAPIKeysStatus[keyHash] || { status: 'active' };

                globalKeys.push({
                    key: key,
                    provider: 'Google Gemini',
                    status: statusEntry.status,
                    addedAt: 'System / Environment',
                    updatedAt: statusEntry.exhaustedAt || new Date().toISOString(),
                    note: statusEntry.note || `Global key #${idx + 1}`,
                    isGlobal: true,
                    quotaInfo: statusEntry.status === 'exhausted'
                        ? '❌ QUOTA EXHAUSTED - Tidak dapat digunakan'
                        : 'Gemini: 15 requests/min (free tier), unlimited dengan billing'
                });
            }
        });

        // Get OpenAI keys from environment
        const openaiRaw = process.env.OPENAI_API_KEY || '';
        const openaiKeys = openaiRaw.split(',').map(k => k.trim()).filter(k => k);

        openaiKeys.forEach((key, idx) => {
            if (!globalKeys.some(k => k.key === key)) {
                const keyHash = key.substring(key.length - 10);
                const statusEntry = db.globalAPIKeysStatus[keyHash] || { status: 'active' };

                globalKeys.push({
                    key: key,
                    provider: 'OpenAI (ChatGPT)',
                    status: statusEntry.status,
                    addedAt: 'System / Environment',
                    updatedAt: statusEntry.exhaustedAt || new Date().toISOString(),
                    note: statusEntry.note || `Global key #${idx + 1}`,
                    isGlobal: true,
                    quotaInfo: statusEntry.status === 'exhausted'
                        ? '❌ QUOTA EXHAUSTED - Tidak dapat digunakan'
                        : 'OpenAI: Rate limits sesuai plan (Standard: 3,500 RPM / 200,000 TPM)'
                });
            }
        });

        const openrouterRaw = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || process.env.OPEN_ROUTER_KEY || '';
        const openrouterKeys = openrouterRaw.split(',').map(k => k.trim()).filter(k => k);

        openrouterKeys.forEach((key, idx) => {
            if (!globalKeys.some(k => k.key === key)) {
                const keyHash = key.substring(key.length - 10);
                const statusEntry = db.globalAPIKeysStatus[keyHash] || { status: 'active' };

                globalKeys.push({
                    key: key,
                    provider: 'OpenRouter',
                    status: statusEntry.status,
                    addedAt: 'System / Environment',
                    updatedAt: statusEntry.exhaustedAt || new Date().toISOString(),
                    note: statusEntry.note || `Global key #${idx + 1}`,
                    isGlobal: true,
                    quotaInfo: statusEntry.status === 'exhausted'
                        ? '❌ QUOTA EXHAUSTED - Tidak dapat digunakan'
                        : 'OpenRouter: Rate limits sesuai plan penyedia'
                });
            }
        });

        // Get Groq keys from environment
        const groqRaw = process.env.GROQ_API_KEY || '';
        const groqKeys = groqRaw.split(',').map(k => k.trim()).filter(k => k);

        groqKeys.forEach((key, idx) => {
            if (!globalKeys.some(k => k.key === key)) {
                const keyHash = key.substring(key.length - 10);
                const statusEntry = db.globalAPIKeysStatus[keyHash] || { status: 'active' };

                globalKeys.push({
                    key: key,
                    provider: 'Groq',
                    status: statusEntry.status,
                    addedAt: 'System / Environment',
                    updatedAt: statusEntry.exhaustedAt || new Date().toISOString(),
                    note: statusEntry.note || `Global key #${idx + 1}`,
                    isGlobal: true,
                    quotaInfo: statusEntry.status === 'exhausted'
                        ? '❌ QUOTA EXHAUSTED - Tidak dapat digunakan'
                        : 'Groq: Ultra-fast inference (Llama 3, Mixtral)'
                });
            }
        });

        // Get DeepSeek keys from environment
        const deepseekRaw = process.env.DEEPSEEK_API_KEY || '';
        const deepseekKeys = deepseekRaw.split(',').map(k => k.trim()).filter(k => k);

        deepseekKeys.forEach((key, idx) => {
            if (!globalKeys.some(k => k.key === key)) {
                const keyHash = key.substring(key.length - 10);
                const statusEntry = db.globalAPIKeysStatus[keyHash] || { status: 'active' };

                globalKeys.push({
                    key: key,
                    provider: 'DeepSeek',
                    status: statusEntry.status,
                    addedAt: 'System / Environment',
                    updatedAt: statusEntry.exhaustedAt || new Date().toISOString(),
                    note: statusEntry.note || `Global key #${idx + 1}`,
                    isGlobal: true,
                    quotaInfo: statusEntry.status === 'exhausted'
                        ? '❌ QUOTA EXHAUSTED - Tidak dapat digunakan'
                        : 'DeepSeek: Rate limits sesuai plan (Free tier tersedia)'
                });
            }
        });

        const exhaustedCount = globalKeys.filter(k => k.status === 'exhausted').length;
        const activeCount = globalKeys.length - exhaustedCount;

        return res.json({
            ok: true,
            globalKeys: globalKeys,
            totalCount: globalKeys.length,
            activeCount: activeCount,
            exhaustedCount: exhaustedCount,
            geminiCount: geminiKeys.length,
            openaiCount: openaiKeys.length,
            openrouterCount: openrouterKeys.length,
            deepseekCount: deepseekKeys.length,
            groqCount: groqKeys.length,
            fallbackNote: 'Global key digunakan sebagai fallback jika personal key tidak tersedia atau kuota habis',
            storage: USE_SUPABASE ? 'Supabase' : 'Database JSON'
        });
    } catch (err) {
        console.error('[ADMIN GET GLOBAL KEYS ERROR]:', err.message);
        res.status(500).json({ error: 'Gagal mengambil daftar global key: ' + err.message });
    }
});

/**
 * Helper to push global API key to Vercel automatically
 * This allows production Vercel to use global API keys for AI generation
 */
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

// ─── API: Admin Add Global API Key ───────────────────────────────────────────
app.post('/api/admin/add-global-key', async (req, res) => {
    const { provider, apiKey, note } = req.body;

    if (!provider || !apiKey) {
        return res.status(400).json({ error: 'provider dan apiKey diperlukan' });
    }

    try {
        const trimmedKey = apiKey.trim();
        let storageMedium = 'database.json';

        // 1. PRIMARY: Try to save to Supabase
        if (USE_SUPABASE) {
            try {
                await addGlobalAPIKeyToSupabase(provider, trimmedKey, note);
                storageMedium = 'Supabase';
                console.log(`[ADMIN] Global API key added to Supabase for provider: ${provider}`);
            } catch (err) {
                console.error('[ADMIN] Warning: Failed to add to Supabase, falling back to database.json:', err.message);
                // Fall through to database.json fallback
            }
        }

        // 2. FALLBACK: Save to database.json if Supabase failed or not configured
        if (storageMedium !== 'Supabase') {
            const db = await readDB();
            if (!db.globalSettings) db.globalSettings = { apiKeys: [] };
            if (!Array.isArray(db.globalSettings.apiKeys)) db.globalSettings.apiKeys = [];

            // Check for duplicates in database.json
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
            console.log(`[ADMIN] Global API key added to database.json for provider: ${provider}`);
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

// ─── API: Admin Remove Global API Key ────────────────────────────────────────
app.post('/api/admin/remove-global-key', async (req, res) => {
    const { keyIndex, keyId, keyValue } = req.body;

    // Accept either keyIndex (database.json) or keyId (Supabase) or keyValue (direct key match)
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
                console.log('[ADMIN] Global API key removed from Supabase');
                return res.json({ ok: true, message: 'Global API Key berhasil dihapus dari Supabase' });
            } catch (err) {
                console.error('[ADMIN] Warning: Failed to remove from Supabase, falling back to database.json:', err.message);
                // Fall through to database.json fallback
            }
        }

        // 2. FALLBACK: Remove from database.json
        if (keyIndex !== undefined) {
            const db = await readDB();
            if (!db.globalSettings || !Array.isArray(db.globalSettings.apiKeys)) {
                return res.status(404).json({ error: 'Konfigurasi Global tidak ditemukan' });
            }

            if (keyIndex < 0 || keyIndex >= db.globalSettings.apiKeys.length) {
                return res.status(400).json({ error: 'Index tidak valid' });
            }

            db.globalSettings.apiKeys.splice(keyIndex, 1);
            await writeDB(db);

            console.log('[ADMIN] Global API key removed from database.json');
            return res.json({ ok: true, message: 'Global API Key berhasil dihapus dari database.json' });
        } else if (keyValue) {
            // Remove by value from database.json
            const db = await readDB();
            if (!db.globalSettings || !Array.isArray(db.globalSettings.apiKeys)) {
                return res.status(404).json({ error: 'Konfigurasi Global tidak ditemukan' });
            }

            const idx = db.globalSettings.apiKeys.findIndex(k => k.key === keyValue);
            if (idx < 0) {
                return res.status(404).json({ error: 'API Key tidak ditemukan' });
            }

            db.globalSettings.apiKeys.splice(idx, 1);
            await writeDB(db);

            console.log('[ADMIN] Global API key removed from database.json by value');
            return res.json({ ok: true, message: 'Global API Key berhasil dihapus' });
        }

    } catch (err) {
        console.error('[ADMIN REMOVE GLOBAL KEY ERROR]:', err.message);
        res.status(500).json({ error: 'Gagal menghapus Global API Key: ' + err.message });
    }
});

app.post('/api/generate-ai', async (req, res) => {
    // Extract teacher info from headers if available, with body fallback
    req.teacherId = req.headers['x-teacher-id'] || req.body.teacherId;
    req.teacherName = req.headers['x-teacher-name'] || req.body.teacherName;

    if (req.teacherId) {
        const idSource = req.headers['x-teacher-id'] ? 'Headers' : 'Body';
        console.log(`[AI] /api/generate-ai: Identitas terdeteksi [${req.teacherId}] dari ${idSource}`);
    } else {
        console.log(`[AI] /api/generate-ai: Tidak ada identitas guru terdeteksi (Teacher ID undefined)`);
    }

    const {
        materi,
        jumlah = 5,
        tipe = 'single',
        mapel = '',
        rombel = '',
        typeCounts = {},
        levelCounts = {},
        opsiGambar = 'none'
    } = req.body;

    const imageEnabled = String(opsiGambar || 'none').toLowerCase() === 'auto';

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
        single: 'pilihan ganda biasa (1 jawaban benar, 4 opsi)',
        multiple: 'pilihan ganda kompleks (tepat 4 opsi, 2-3 jawaban benar)',
        text: 'isian / uraian singkat',
        tf: 'benar/salah (tepat 3 pernyataan per soal)',
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

    // --- PROMPT YANG DITINGKATKAN ---
    let prompt = `[INSTRUKSI KRITIS - WAJIB DIIKUTI]
Jika parameter simpanBank bernilai true, maka ANDA HARUS menyertakan tag script JSON di bagian PALING AKHIR respons Anda.
Tag script tersebut diperlukan agar soal dapat disimpan ke database. Tanpa tag tersebut, soal tidak akan tersimpan.

⚠️ PENTING: Jika Anda tidak menyertakan tag script JSON yang diminta, sistem akan mencoba mengekstrak JSON dari respons utama Anda. Namun, ini kurang dapat diandalkan. SELALU sertakan tag script untuk memastikan soal tersimpan dengan benar.

Anda adalah pakar pengembang kurikulum dan pembuat soal ujian profesional. 

⚠️ INSTRUKSI KRITIS JUMLAH SOAL:
Anda WAJIB membuat PERSIS ${actualJumlah} soal dalam JSON array. Tidak boleh kurang, tidak boleh lebih. Contohnya:
- Jika diminta 5 soal → return array dengan TEPAT 5 elemen soal
- Jika diminta 10 soal → return array dengan TEPAT 10 elemen soal
Setiap soal dalam array HARUS valid dan memiliki field "text" yang berisi pertanyaan atau stimulus lengkap.

Buatkan ${actualJumlah} soal berkualitas tinggi sesuai standar Kurikulum Merdeka `;

    if (composition) {
        prompt += `dengan komposisi tipe soal: ${composition}. `;
    } else {
        prompt += `dengan tipe ${typeDescriptions[tipe] || 'pilihan ganda'}. `;
    }

    prompt += `Mata pelajaran: ${mapel}, Fase/Kelas: ${rombel}, Materi: ${materi}.

KRITERIA KUALITAS:
1. BAHASA: Gunakan Bahasa Indonesia formal sesuai PUEBI/EYD. Hindari kalimat ambigu.
2. DISTRAKTOR: Untuk pilihan ganda, buatlah pengecoh yang logis dan homogen (tampak benar bagi yang tidak menguasai materi).
3. MANDIRI: Setiap soal harus berdiri sendiri secara informasi.
4. FIELD TEXT WAJIB: Setiap soal HARUS memiliki field "text" yang tidak boleh kosong atau hanya spasi. Field ini harus berisi pertanyaan lengkap atau stimulus + pertanyaan.`;

    // Peningkatan instruksi HOTS (Higher Order Thinking Skills)
    if (hots > 0) {
        prompt += `
5. HOTS (PENTING): Minimal ${hots} soal harus kategori HOTS. Gunakan stimulus (teks, tabel, kasus, atau kode program) yang menuntut kemampuan analisis (C4), evaluasi (C5), atau kreasi (C6). Soal HOTS tidak boleh sekadar hafalan, melainkan pemecahan masalah.`;
    }

    prompt += `
5. STIMULUS: Jika soal membutuhkan teks bacaan atau stimulus, gabungkan stimulus dan pertanyaan dalam satu field "text" dengan format berikut:
   [STIMULUS]teks bacaan lengkap di sini[/STIMULUS]
   [PERTANYAAN]pertanyaan di sini[/PERTANYAAN]
   
   Contoh:
   "text": "[STIMULUS]Dalam berpikir komputasional, ada beberapa tahap yang harus dilakukan.[/STIMULUS]\n[PERTANYAAN]Tahap pertama dalam berpikir komputasional adalah...?[/PERTANYAAN]",
   "options": ["A. Abstraksi", "B. Dekomposisi", "C. Algoritma", "D. Evaluasi"],
   "correct": 1`;

    if (levelParts.length > 0) {
        prompt += `\nDistribusi tingkat kesulitan: ${levelParts.join(', ')}.`;
    }

    if (imageEnabled) {
        prompt += '\nSertakan field "imagePrompt" yang berisi deskripsi ilustrasi (DALL-E style) untuk setiap soal. Pastikan ilustrasi memperjelas konteks soal. Jika soal tidak memerlukan gambar, biarkan kosong.';
    }
    // Tambahan khusus untuk mata pelajaran Informatika
    if (mapel && mapel.toLowerCase().includes('informatika')) {
        prompt += `\nKhusus Informatika: Sertakan potongan kode atau skenario logika jika relevan. Pastikan indentasi kode dalam JSON menggunakan \\n agar terbaca rapi.`;
    }

    prompt += `\nKhusus untuk tipe soal 'multiple' (Pilihan Ganda Kompleks):
- WAJIB gunakan TEPAT 4 opsi (A, B, C, D). Jangan 5 atau lebih.
- WAJIB ada 2-3 jawaban yang benar (tidak boleh hanya 1, tidak boleh lebih dari 3).
- Buatlah pengecoh yang homogen dan plausibel (tampak benar bagi yang kurang menguasai materi).
- Format "correct" adalah array indeks yang benar, contoh: [0, 2] atau [1, 2, 3].`;

    prompt += `\nKhusus untuk tipe soal 'tf' (Benar/Salah):
- WAJIB buat 1 nomor soal yang berisi TEPAT 3 PERNYATAAN terkait topik yang SAMA.
- Semua 3 pernyataan dalam satu soal harus berhubungan dan membahas aspek berbeda dari topik yang sama.
- Format WAJIB menggunakan struktur ini:
{
  "text": "Tentukan apakah pernyataan berikut benar atau salah!",
  "type": "tf",
  "subQuestions": [
    {"statement": "Pernyataan 1 tentang [Topik]...", "answer": "Benar"},
    {"statement": "Pernyataan 2 tentang [Topik]...", "answer": "Salah"},
    {"statement": "Pernyataan 3 tentang [Topik]...", "answer": "Benar"}
  ],
  "correct": ["Benar", "Salah", "Benar"],
  "options": ["Pernyataan 1 tentang [Topik]...", "Pernyataan 2 tentang [Topik]...", "Pernyataan 3 tentang [Topik]..."]
}
CATATAN PENTING: Jangan buat 5 soal terpisah masing-masing dengan 1 pernyataan. Hanya buat SATU soal yang memiliki 3 pernyataan berhubungan dalam "subQuestions" field. Field "options" diisi untuk kompatibilitas frontend.`;

    prompt += `
PENTING: Untuk tipe single dan multiple, gunakan HANYA 4 opsi A, B, C, D. Jangan sertakan opsi E.
Jika AI menghasilkan opsi E, keluarkan opsi E dan gunakan hanya opsi A-D.
`;

    prompt += `\n\nFormat Output: WAJIB JSON array valid yang berisi PERSIS ${actualJumlah} soal, tanpa penjelasan atau teks lain di luar JSON.
VALIDASI ARRAY: Array harus memiliki TEPAT ${actualJumlah} elemen, tidak boleh kurang. Periksa kembali sebelum submit.

FORMAT OUTPUT YANG WAJIB DIIKUTI:
Kelompokkan soal berdasarkan tipe dengan judul kategori sebagai berikut:

Pilihan Ganda (X Soal)
[Array JSON soal single choice]

Pilihan Ganda Kompleks (X Soal)
[Array JSON soal multiple choice]

Benar/Salah (X Soal)
[Array JSON soal tf]

Esai/Uraian (X Soal)
[Array JSON soal text]

Menjodohkan (X Soal)
[Array JSON soal matching]

Dimana X adalah jumlah soal untuk tipe tersebut. Jika suatu tipe tidak ada soal, jangan tampilkan judul kategorinya.

PENTING: Output HARUS berupa teks plain dengan kategori header diikuti JSON array. JANGAN gunakan format HTML, markdown, atau format lain. Hanya teks plain dengan header kategori dan JSON array.

Contoh output yang BENAR:
Pilihan Ganda (2 Soal)
[{"text":"Apa hasil 2+2?","options":["A. 2","B. 3","C. 4","D. 5"],"correct":2,"type":"single","mapel":"Matematika","rombel":"X","level":"sedang"},{"text":"5x6=?","options":["A. 25","B. 30","C. 35","D. 40"],"correct":1,"type":"single","mapel":"Matematika","rombel":"X","level":"sedang"}]

Contoh output yang SALAH (jangan lakukan ini):
<h2>Pilihan Ganda</h2>
<p>Apa hasil 2+2?</p>
A. 2
B. 3
C. 4
D. 5

Output HARUS plain text dengan header kategori dan JSON array saja.`;

    prompt += `
FORMAT JSON YANG BENAR PER TIPE SOAL:

1. SINGLE (Pilihan Ganda): 
{
  "text": "Pertanyaan lengkap di sini?",
  "options": ["A. Pilihan A", "B. Pilihan B", "C. Pilihan C", "D. Pilihan D"],
  "correct": 0,
  "type": "single",
  "mapel": "${mapel}",
  "rombel": "${rombel}",
  "level": "sedang"
}

2. MULTIPLE (PG Kompleks - 2-3 jawaban benar):
{
  "text": "Pertanyaan lengkap di sini?",
  "options": ["A. Pilihan A", "B. Pilihan B", "C. Pilihan C", "D. Pilihan D"],
  "correct": [0, 2],
  "type": "multiple",
  "mapel": "${mapel}",
  "rombel": "${rombel}",
  "level": "sedang"
}

3. TF (Benar/Salah - TEPAT 3 pernyataan):
{
  "text": "Tentukan apakah pernyataan berikut benar atau salah!",
  "type": "tf",
  "subQuestions": [
    {"statement": "Pernyataan 1 tentang topik...", "answer": "Benar"},
    {"statement": "Pernyataan 2 tentang topik...", "answer": "Salah"},
    {"statement": "Pernyataan 3 tentang topik...", "answer": "Benar"}
  ],
  "correct": ["Benar", "Salah", "Benar"],
  "options": ["Pernyataan 1 tentang topik...", "Pernyataan 2 tentang topik...", "Pernyataan 3 tentang topik..."],
  "mapel": "${mapel}",
  "rombel": "${rombel}",
  "level": "sedang"
}

4. TEXT (Uraian/Essay):
{
  "text": "Jelaskan konsep X secara lengkap!",
  "correct": "",
  "type": "text",
  "mapel": "${mapel}",
  "rombel": "${rombel}",
  "level": "sedang"
}

5. MATCHING (Menjodohkan):
{
  "text": "Menjodohkan kolom A dengan kolom B!",
  "questions": ["Item A1", "Item A2", "Item A3", "Item A4", "Item A5"],
  "answers": ["Item B1", "Item B2", "Item B3", "Item B4", "Item B5"],
  "correct": ["Item B2", "Item B1", "Item B4", "Item B3", "Item B5"],
  "type": "matching",
  "mapel": "${mapel}",
  "rombel": "${rombel}",
  "level": "sedang"
}

PENTING: 
- Field "text" WAJIB diisi dengan pertanyaan lengkap
- Untuk TF: subQuestions HARUS tepat 3 objek, correct HARUS array 3 string
- Untuk single/multiple: options HARUS tepat 4 items, correct sesuai format di atas
- Untuk text: correct HARUS string kosong "", tidak ada options
- Untuk matching: questions dan answers HARUS array 5 items, correct HARUS array 5 string

Contoh output lengkap:
Pilihan Ganda (2 Soal)
[{"text":"Apa hasil 2+2?","options":["2","3","4","5"],"correct":2,"type":"single","mapel":"Matematika","rombel":"X"},{"text":"5x6=?","options":["25","30","35","40"],"correct":1,"type":"single","mapel":"Matematika","rombel":"X"}]

Benar/Salah (1 Soal)
[{"text":"Tentukan benar/salah!","type":"tf","subQuestions":[{"statement":"2+2=4","answer":"Benar"},{"statement":"3+3=5","answer":"Salah"},{"statement":"5+5=10","answer":"Benar"}],"correct":["Benar","Salah","Benar"],"options":["2+2=4","3+3=5","5+5=10"],"mapel":"Matematika","rombel":"X"}]

Esai/Uraian (1 Soal)
[{"text":"Jelaskan hukum Newton!","correct":"","type":"text","mapel":"Matematika","rombel":"X"}]

PENTING untuk tiap tipe soal:
- single (Pilihan Ganda): "correct" adalah indeks integer (0-3). Wajib 4 opsi (A,B,C,D). "text" harus berisi pertanyaan lengkap.
- multiple (PG Kompleks): "correct" adalah array indeks benar MAKSIMAL 3, contoh: [0, 2]. Wajib TEPAT 4 opsi (A,B,C,D), jangan 5 atau lebih. "text" harus berisi pertanyaan lengkap.
- tf (Benar/Salah): "subQuestions" adalah array TEPAT 3 objek dengan "statement" dan "answer" ("Benar" atau "Salah"), "correct" adalah array string ["Benar", "Salah", "Benar"] dengan panjang TEPAT 3. "text" harus ada. "options" diisi untuk kompatibilitas frontend.
- text (Uraian): "correct" HARUS berisi string kosong "". Tidak ada "options" field. "text" harus berisi pertanyaan lengkap.

[INSTRUKSI KRITIS - WAJIB DIIKUTI]
Jika parameter simpanBank bernilai true, maka di bagian PALING AKHIR respons Anda HARUS menyertakan tag script JSON dengan format berikut:
<script id="ai-json-data" type="application/json">
[ARRAY_JSON_GABUNGAN_SEMUA_KATEGORI]
</script>

PENTING: Array dalam tag script HARUS berisi GABUNGAN dari semua array JSON yang ada di atas (dari semua kategori). Jadi jika ada 3 kategori masing-masing dengan 2 soal, maka total array harus berisi 6 soal dalam satu array besar.

Contoh lengkap respons jika simpanBank=true:
Pilihan Ganda (2 Soal)
[{"text":"Soal 1...","options":["A","B","C","D"],"correct":0,"type":"single","mapel":"Matematika","rombel":"Fase D (Kelas 7)","level":"sedang"},{"text":"Soal 2...","options":["A","B","C","D"],"correct":1,"type":"single","mapel":"Matematika","rombel":"Fase D (Kelas 7)","level":"sedang"}]

Benar/Salah (1 Soal)
[{"text":"Soal TF...","type":"tf","subQuestions":[{"statement":"Statement 1","answer":"Benar"}],"correct":["Benar"],"options":["Statement 1"],"mapel":"Matematika","rombel":"Fase D (Kelas 7)"}]

<script id="ai-json-data" type="application/json">
[{"text":"Soal 1...","options":["A","B","C","D"],"correct":0,"type":"single","mapel":"Matematika","rombel":"Fase D (Kelas 7)","level":"sedang"},{"text":"Soal 2...","options":["A","B","C","D"],"correct":1,"type":"single","mapel":"Matematika","rombel":"Fase D (Kelas 7)","level":"sedang"},{"text":"Soal TF...","type":"tf","subQuestions":[{"statement":"Statement 1","answer":"Benar"}],"correct":["Benar"],"options":["Statement 1"],"mapel":"Matematika","rombel":"Fase D (Kelas 7)"}]
</script>

⚠️ PERINGATAN: Tag script HARUS berada di bagian paling akhir respons, setelah JSON array utama. Jika Anda tidak menyertakan tag script ini, sistem akan mencoba mengekstrak JSON secara otomatis, tetapi ini kurang dapat diandalkan. SELALU sertakan tag script untuk memastikan soal tersimpan dengan benar.`;

    console.log(`[/api/generate-ai] Request: mapel=${mapel}, rombel=${rombel}, jumlah=${actualJumlah}, tipe=${tipe}, opsiGambar=${opsiGambar}, imageEnabled=${imageEnabled}, typeCounts=${JSON.stringify(normalizedCounts)}, levelCounts=${JSON.stringify(levelCounts)}`);

    try {
        const aiResult = await callAI(prompt, req);
        let text = aiResult.text || '';
        const exhaustedKeys = aiResult.exhaustedKeys || [];

        // Clean up JSON response using helper
        const jsonText = cleanAIResponse(text);

        let parsed;
        try {
            // Further clean up common JSON issues from AI responses
            const sanitizedJsonText = jsonText
                .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
                .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');  // Quote unquoted keys

            parsed = JSON.parse(sanitizedJsonText);
        } catch (jsonError) {
            console.error('[/api/generate-ai] JSON parsing failed:', jsonError.message);
            console.error('[/api/generate-ai] AI Raw response:', text.substring(0, 1000));
            return res.status(500).json({
                error: 'AI mengembalikan JSON yang tidak valid. Coba lagi atau gunakan provider AI lain.',
                details: jsonError.message
            });
        }

        // Normalize question formats using centralized function
        let normalizedQuestions = parsed.map(q => normalizeQuestion(q, mapel, rombel, req.teacherId));

        normalizedQuestions = normalizedQuestions.filter(q => {
            // For matching questions, check for questions/answers; for others, check for text
            if (q.type === 'matching') {
                return !q.invalid && Array.isArray(q.questions) && q.questions.length > 0;
            }
            return !q.invalid && q.text && q.text.trim();
        });

        // VALIDASI KRITIS: Periksa apakah jumlah soal sesuai dengan permintaan
        const generatedCount = normalizedQuestions.length;
        if (generatedCount < actualJumlah) {
            console.warn(`[/api/generate-ai] WARNING: Generated ${generatedCount} valid questions, but ${actualJumlah} were requested. Some questions from AI response were filtered out.`);
            console.warn(`[/api/generate-ai] This may indicate AI is not following format instructions properly. Consider improving prompt clarity or checking AI provider output.`);
            // Log the parsed but filtered questions for debugging
            const filteredOut = parsed.length - generatedCount;
            if (filteredOut > 0) {
                console.warn(`[/api/generate-ai] Filtered out ${filteredOut} invalid questions out of ${parsed.length} total`);
            }
        } else if (generatedCount > actualJumlah) {
            console.warn(`[/api/generate-ai] WARNING: Generated ${generatedCount} questions but only ${actualJumlah} were requested. Trimming excess questions.`);
            normalizedQuestions = normalizedQuestions.slice(0, actualJumlah);
        }

        if (imageEnabled) {
            try {
                normalizedQuestions = await attachGeneratedImagesToQuestions(normalizedQuestions, req);
            } catch (e) {
                console.warn('[/api/generate-ai] Warning: gagal menambahkan gambar AI ke soal:', e.message);
            }
        }

        console.log(`[/api/generate-ai] Success: generated ${normalizedQuestions.length} questions`);
        return res.json({ ok: true, questions: normalizedQuestions, exhaustedKeys });
    } catch (e) {
        console.error('[/api/generate-ai] Fatal error:', e.message);
        const quotaExhausted = /kuota|quota|limit|habis/i.test(e.message);
        const needsApiKeys = /tidak ada api key|tidak memiliki api key|API Key Gemini/i.test(e.message);
        const exhaustedKeys = Array.isArray(e.exhaustedKeys) ? e.exhaustedKeys : [];
        const allKeysExhausted = /semua.*(provider|api|key|quota|kuota)/i.test(e.message) || needsApiKeys;

        // Enrich error message with redirect hint if all keys exhausted
        let errorMessage = e.message;
        if (allKeysExhausted && !needsApiKeys) {
            errorMessage = '🔴 Semua API Key Anda sudah habis atau tidak dikonfigurasi. Silakan tambahkan API Key baru di halaman API Keys untuk melanjutkan. Anda akan dibawa ke halaman tersebut secara otomatis.';
        }

        return res.status(500).json({
            error: errorMessage,
            quotaExhausted,
            needsApiKeys,
            allKeysExhausted,
            exhaustedKeys,
            redirectToApiKeys: allKeysExhausted && req && req.teacherId
        });
    }
});

// ─── API: Generate Admin Doc ──────────────────────────────────────────────────
app.post('/api/generate-admin-doc', upload.single('blueprint'), async (req, res) => {
    // Extract teacher info from headers if available, with body fallback
    req.teacherId = req.headers['x-teacher-id'] || req.body.teacherId;
    req.teacherName = req.headers['x-teacher-name'] || req.body.teacherName;

    console.log(`[/api/generate-admin-doc] === REQUEST RECEIVED ===`);
    console.log(`[/api/generate-admin-doc] Body keys:`, Object.keys(req.body));
    console.log(`[/api/generate-admin-doc] extraData:`, JSON.stringify(req.body.extraData, null, 2));
    console.log(`[/api/generate-admin-doc] simpanBank value:`, req.body.extraData?.simpanBank);
    console.log(`[/api/generate-admin-doc] simpanBank type:`, typeof req.body.extraData?.simpanBank);

    if (req.teacherId) {
        const idSource = req.headers['x-teacher-id'] ? 'Headers' : 'Body';
        console.log(`[AI] /api/generate-admin-doc: Identitas terdeteksi [${req.teacherId}] dari ${idSource}`);
    } else {
        console.log(`[AI] /api/generate-admin-doc: Tidak ada identitas guru terdeteksi`);
    }

    let { type, mapel, fase, semester, topik, topic, target, schoolName, teacherName, address } = req.body;
    const extraData = { ...req.body };
    type = type || target;
    topik = topik || topic; // Compatibility for both field names

    if (!mapel || (!topik && !req.file)) {
        return res.status(400).json({ error: 'Mata Pelajaran wajib diisi. Selain itu, Anda harus menyertakan Topik/Materi atau mengupload File Kisi-kisi.' });
    }

    let blueprintText = "";
    if (req.file) {
        try {
            const rawText = await parseBlueprint(req.file.buffer, req.file.originalname, req);
            blueprintText = rawText.substring(0, 10000); // Limit context size to 10k chars for speed
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
    } else if (type === 'prota-promes') {
        docType = `Prota dan Promes`;
        promptText = `Rancang secara ringkas Program Tahunan (Prota) and Program Semester (Promes) pada mata pelajaran ${mapel} fase ${fase} semester ${semester} mengenai ${topicHint}. Total Pekan Efektif yang direncanakan: ${extraData?.pekan || '18'} Pekan.`;
    } else if (type === 'kisi-kisi') {
        docType = `Kisi-kisi Ujian`;
        promptText = `Buatkan ${docType} (Bentuk: ${extraData?.jenis || 'Soal Ujian Tertulis'}) untuk mata pelajaran ${mapel} ${topicHint} fase ${fase}. Sajikan dalam bentuk format matriks yang merinci: Indikator Soal, Level Kognitif (seperti L1/L2/L3 atau C1-C6), and Bentuk Soal.`;
    } else if (type === 'soal-jawaban') {
        docType = `Soal dan Kunci Jawaban`;
        promptText = `Buatkan instrumen Soal dan Kunci Jawaban berkualitas tinggi untuk mata pelajaran ${mapel} fase ${fase} ${topicHint}. Rincian jumlah dan bentuk soal: ${extraData?.jumlahPerBentuk || '5 soal Pilihan Ganda'}. 
        PENTING: Soal berlabel HOTS (Higher Order Thinking Skills) HARUS menguji kemampuan analisis (C4), evaluasi (C5), atau kreasi (C6). Gunakan stimulus yang relevan dan menuntut penalaran logis. 
        PENTING: Jika soal didasarkan pada teks bacaan (passage/stimulus), sertakan teks bacaan tersebut secara utuh di dalam konten soal sebelum pertanyaan dimulai. 
        \nUntuk soal uraian tipe text, buatlah kunci jawaban yang sangat singkat: hanya 1 kalimat padat dan jelas, maksimal 5 kata.`;

        if (extraData?.opsiGambar === 'placeholder') {
            promptText += `\nUntuk soal yang memerlukan ilustrasi gambar, JANGAN gunakan placeholder gambar biasa. Gunakan blok HTML berikut sebagai "Area Ilustrasi" agar terlihat profesional:\n<div style="border: 2px dashed #cbd5e1; border-radius: 8px; padding: 20px; text-align: center; background-color: #f8fafc; margin: 15px 0;"><i class="fas fa-image" style="font-size: 32px; color: #94a3b8; margin-bottom: 10px; display: block;"></i><p style="font-weight: bold; color: #475569; margin: 0; font-size: 14px;">[Area Ilustrasi: DESKRIPSI_GAMBAR]</p><p style="font-size: 11px; color: #94a3b8; margin-top: 5px;">(Guru dapat menyisipkan gambar spesifik di sini)</p></div>\nGanti teks DESKRIPSI_GAMBAR dengan nama/objek gambar yang relevan (misal: "Struktur Akar Tumbuhan").`;
        } else if (extraData?.opsiGambar === 'auto') {
            promptText += `\nUntuk soal yang memerlukan ilustrasi gambar, tampilkan gambar asli secara otomatis dengan memanfaatkan layanan pihak ketiga menggunakan tag HTML ini: <br><img src="https://image.pollinations.ai/prompt/[ENGLISH_VISUAL_DESCRIPTION]?width=500&height=300&nologo=true" alt="Ilustrasi AI" style="border-radius: 8px; margin: 15px 0; max-width: 100%; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); border: 1px solid #e2e8f0;">\nGantikan [ENGLISH_VISUAL_DESCRIPTION] with deskripsi visual yang sangat detail dalam BAHASA INGGRIS yang merangkum maksud soal. WAJIB: Ganti SEMUA SPASI pada deskripsi bahasa Inggris tersebut dengan %20 agar link gambar valid (misalnya: "detailed%20educational%20human%20heart"). Jika Anda juga me-generate JSON Database, tambahkan link tersebut dalam array pada properti "images", contoh: {"text": "...", "images": ["https://image.pollinations..."]}.`;
        }

        if (extraData?.generateKisiKisi) {
            promptText += `\n\nPenting: Berdasarkan soal-soal yang Anda buat, buatkan juga matriks KISI-KISI UJIAN yang menjadi panduannya (Lengkap dengan Indikator Soal dan Level Kognitif) and tampilkan matriks tersebut pada bagian PALING ATAS / AWAL dari dokumen sebelum daftar soal.`;
        }

        if (extraData?.pisahLembar) {
            promptText += `\nPenting: Karena fitur 'Pisahkan Halaman' diaktifkan, Anda WAJIB menyisipkan tag HTML ini: <div style="page-break-before: always;"></div> tepat sebelum judul "KUNCI JAWABAN" dimulai.`;
        }

        // NOTE: simpanBank JSON extraction is now handled via a second AI call AFTER
        // the HTML document is generated. No extra instructions needed in the main prompt.
    } else if (type === 'ppt-pintar') {
        docType = `Presentasi PowerPoint Pintar`;
        promptText = `Buatkan rancangan presentasi PowerPoint yang sangat rapi, modern, dan menarik untuk mata pelajaran ${mapel} dengan topik "${extraData?.topikPPT || topik}". Target audiens: ${extraData?.audiensPPT || 'siswa'}. Gaya desain: ${extraData?.gayaPPT || 'modern'}. Jumlah slide: ${extraData?.jumlahSlide || '10'} slide.

Struktur presentasi yang diharapkan:
1. Slide Judul (Title Slide)
2. Slide Daftar Isi (Table of Contents)  
3. Slide-slide konten utama (minimal 6 slide)
4. Slide Kesimpulan
5. Slide Terima Kasih

FORMAT OUTPUT YANG HARUS DIPATUHI:
Untuk setiap slide, gunakan format berikut:

SLIDE [NOMOR]: [JUDUL SLIDE]
- Poin 1
- Poin 2  
- Poin 3
- Poin 4
- Poin 5

Contoh:
SLIDE 1: Selamat Datang di Pembelajaran Matematika
- Pengenalan topik persamaan linear
- Tujuan pembelajaran hari ini
- Materi yang akan dipelajari

SLIDE 2: Daftar Isi
- Pengertian Persamaan Linear
- Cara Menyelesaikan
- Contoh Soal
- Latihan

Pastikan presentasi sesuai dengan Kurikulum Merdeka dan cocok untuk pembelajaran di kelas/fase ${fase}. Buat konten yang edukatif dan menarik.`;
    } else {
        return res.status(400).json({ error: 'Tipe dokumen tidak valid' });
    }

    let blueprintContext = "";
    if (blueprintText) {
        blueprintContext = `REFERENSI DOKUMEN GURU (BLUEPRINT/KISI-KISI):\n====\n${blueprintText}\n====\nSANGAT PENTING: Gunakan teks referensi di atas sebagai satu-satunya panduan materi, indikator, dan bentuk soal. Sesuaikan hasil generate dengan apa yang tertulis dalam dokumen referensi tersebut.\n\n`;
    }

    let formattingCommand = `
PERINTAH FORMATTING: 
Tulis output HANYA MENGGUNAKAN tag HTML (tanpa tag <html>, <head>, atau <body>) agar saya bisa langsung menampilkannya di div innerHTML. Gunakan tag <h1>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <p>, dan <table> (untuk data matriks).
Berikan juga CSS inline jika dibutuhkan untuk struktur tabel (seperti: <table border="1" style="width:100%; border-collapse: collapse; text-align: left; margin-bottom: 20px;"><tr><th style="padding: 8px; background: #f1f5f9;">...</th></tr>).
DILARANG memberikan kalimat pembuka atau penutup di luar tag HTML. DILARANG menggunakan markdown block (seperti \`\`\`html). Output harus 100% kode HTML mentah.`;

    if (type === 'ppt-pintar') {
        formattingCommand = `
PERINTAH FORMATTING PRESENTASI:
DILARANG menggunakan format HTML. Gunakan format plain text persis seperti contoh SLIDE di atas. DILARANG memberikan kalimat pembuka atau penutup di luar daftar SLIDE tersebut.`;
    }

    const fullPrompt = `Identitas Sekolah: ${address || 'SMP Kristen Dorkas'}. Guru Pengampu: ${teacherName || 'Guru SMP Kristen Dorkas'}.\n\n${blueprintContext}${promptText}\n\n${formattingCommand}`;

    try {
        const aiResult = await callAI(fullPrompt, req);
        let text = aiResult.text || '';

        // Membersihkan markdown wrapper (```html ... ```) jika AI membocorkannya
        text = text.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();

        // Special handling for PPT generation
        if (type === 'ppt-pintar') {
            try {
                const pptx = new PptxGenJS();
                const gaya = extraData?.gayaPPT || 'modern';

                // Define Theme Colors
                const themes = {
                    modern: { main: '2563EB', bg: 'FFFFFF', text: '1E293B', accent: 'F1F5F9' },
                    professional: { main: '0F172A', bg: 'F8FAFC', text: '334155', accent: 'E2E8F0' },
                    colorful: { main: '10B981', bg: 'FAFAFA', text: '064E3B', accent: 'D1FAE5' },
                    academic: { main: '92400E', bg: 'FFFBEB', text: '451A03', accent: 'FEF3C7' }
                };
                const theme = themes[gaya] || themes.modern;

                // 1. Define Master TITLE_SLIDE
                pptx.defineSlideMaster({
                    title: 'TITLE_SLIDE',
                    background: { color: theme.bg },
                    objects: [
                        { rect: { x: 0, y: 3.2, w: '100%', h: 0.1, fill: { color: theme.main } } },
                        { rect: { x: 0, y: 0, w: '100%', h: 0.5, fill: { color: theme.accent } } },
                        {
                            text: {
                                text: schoolName || 'SMP Kristen Dorkas',
                                options: { x: 0.5, y: 0.1, w: 9, fontSize: 12, color: theme.main, bold: true, align: 'center' }
                            }
                        }
                    ]
                });

                // 2. Define Master CONTENT_SLIDE
                pptx.defineSlideMaster({
                    title: 'CONTENT_SLIDE',
                    background: { color: theme.bg },
                    objects: [
                        { rect: { x: 0, y: 0, w: '100%', h: 0.8, fill: { color: theme.main } } },
                        { rect: { x: 0, y: 7.1, w: '100%', h: 0.4, fill: { color: theme.accent } } },
                        {
                            text: {
                                text: `${schoolName || 'SMP'} - ${mapel}`,
                                options: { x: 0.5, y: 7.2, w: 9, fontSize: 10, color: theme.main, align: 'right' }
                            }
                        }
                    ],
                    slideNumber: { x: 0.5, y: 7.2, color: theme.main, fontSize: 10 }
                });

                // Parse AI response
                const slides = parsePPTContent(text, extraData, topik);

                pptx.author = teacherName || 'Guru SMP Kristen Dorkas';
                pptx.company = schoolName || 'SMP Kristen Dorkas';

                // Generate slides
                slides.forEach((slideData, idx) => {
                    const isTitle = (idx === 0);
                    const slide = pptx.addSlide({ masterName: isTitle ? 'TITLE_SLIDE' : 'CONTENT_SLIDE' });

                    if (isTitle) {
                        // Title Slide Layout
                        slide.addText(slideData.title, {
                            x: 1, y: 1.5, w: 8, h: 1.5,
                            fontSize: 36, bold: true, color: theme.main,
                            align: 'center', vertical: 'middle'
                        });
                        if (slideData.content && slideData.content.length > 0) {
                            slide.addText(slideData.content.join(' • '), {
                                x: 1, y: 3.5, w: 8, h: 1,
                                fontSize: 16, color: theme.text,
                                align: 'center'
                            });
                        }
                        slide.addText(`Oleh: ${teacherName || 'Guru Pengampu'}`, {
                            x: 1, y: 5, w: 8, h: 0.5,
                            fontSize: 14, italic: true, color: '666666',
                            align: 'center'
                        });
                    } else {
                        // Content Slide Layout
                        slide.addText(slideData.title, {
                            x: 0.5, y: 0.1, w: 9, h: 0.6,
                            fontSize: 24, bold: true, color: 'FFFFFF',
                            align: 'left', vertical: 'middle'
                        });

                        if (slideData.content && slideData.content.length > 0) {
                            const bulletContent = slideData.content.map(c => {
                                return { text: c, options: { bullet: true, indentLevel: 0, margin: 5 } };
                            });

                            slide.addText(bulletContent, {
                                x: 0.8, y: 1.2, w: 8.5, h: 5.5,
                                fontSize: 18, color: theme.text,
                                align: 'left', lineSpacing: 24
                            });
                        }
                    }
                });

                // Generate PPTX file
                const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });

                // Set headers for file download
                const fileName = `Presentasi_${mapel.replace(/[^a-zA-Z0-9]/g, '_')}_${(extraData?.topikPPT || topik).replace(/[^a-zA-Z0-9]/g, '_')}.pptx`;
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
                res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                res.setHeader('Content-Length', pptxBuffer.length);

                console.log(`[/api/generate-admin-doc] PPTX generated successfully: ${fileName}`);
                return res.send(pptxBuffer);

            } catch (pptError) {
                console.error('[/api/generate-admin-doc] PPT generation error:', pptError);
                // Fallback to HTML response if PPT generation fails
                return res.json({
                    ok: true,
                    html: `<h1>Error Generating PPT</h1><p>${pptError.message}</p><p>Fallback content: ${text}</p>`,
                    error: 'PPT generation failed'
                });
            }
        }

        // Cek apakah ada script JSON Bank Soal
        let parsedQuestions = null;
        let bankSaveError = null;
        const shouldSaveToBank = extraData && (extraData.simpanBank === true || String(extraData.simpanBank).toLowerCase() === 'true');

        console.log(`[/api/generate-admin-doc] shouldSaveToBank evaluation:`);
        console.log(`[/api/generate-admin-doc] - extraData exists: ${!!extraData}`);
        console.log(`[/api/generate-admin-doc] - extraData.simpanBank: ${extraData?.simpanBank}`);
        console.log(`[/api/generate-admin-doc] - extraData.simpanBank === true: ${extraData?.simpanBank === true}`);
        console.log(`[/api/generate-admin-doc] - String(extraData.simpanBank).toLowerCase(): ${String(extraData?.simpanBank).toLowerCase()}`);
        console.log(`[/api/generate-admin-doc] - Final shouldSaveToBank: ${shouldSaveToBank}`);

        // DEBUG: Force alert to show server state
        console.log(`\n\n=== DEBUG ALERT FROM SERVER ===`);
        console.log(`simpanBank parameter received: ${extraData?.simpanBank}`);
        console.log(`shouldSaveToBank result: ${shouldSaveToBank}`);
        console.log(`Will attempt bank save: ${shouldSaveToBank ? 'YES' : 'NO'}`);
        console.log(`===============================\n\n`);

        if (shouldSaveToBank) {
            console.log(`[AI Bank Soal] === QUESTION BANK SAVING INITIATED ===`);

            // First, count questions in the HTML for validation
            const htmlQuestionMatches = text.match(/<li[^>]*>/gi) || [];
            const numberedQuestions = text.match(/^\d+\./gm) || [];
            const estimatedQuestionCount = Math.max(htmlQuestionMatches.length, numberedQuestions.length);

            console.log(`[AI Bank Soal] HTML analysis: ${htmlQuestionMatches.length} <li> tags, ${numberedQuestions.length} numbered questions`);
            console.log(`[AI Bank Soal] Estimated question count: ${estimatedQuestionCount}`);

            // STRATEGY 1: Direct HTML parsing (most efficient - no AI cost)
            console.log(`[AI Bank Soal] === STRATEGY 1: Direct HTML Parsing ===`);
            const questionsFromHtml = forceParseQuestionsFromHtml(text, mapel, fase);
            console.log(`[AI Bank Soal] Strategy 1 result: ${questionsFromHtml.length} questions extracted`);

            if (questionsFromHtml.length > 0) {
                // Great! We extracted questions directly from HTML
                console.log(`[AI Bank Soal] ✅ SUCCESS: Extracted ${questionsFromHtml.length} questions via Strategy 1`);

                if (questionsFromHtml.length < estimatedQuestionCount * 0.8) {
                    console.warn(`[AI Bank Soal] ⚠️ WARNING: Extracted ${questionsFromHtml.length} but expected ~${estimatedQuestionCount} (only ${Math.round(questionsFromHtml.length / estimatedQuestionCount * 100)}%)`);
                }

                // Normalize and save
                try {
                    const db = (await readDB()) || { questions: [] };
                    if (!db.questions) db.questions = [];

                    console.log(`[AI Bank Soal] Before normalization: ${questionsFromHtml.length} questions`);

                    let normalizedQuestions = questionsFromHtml.map((q, idx) => {
                        const normalized = normalizeQuestion(q, mapel, fase, req.teacherId);
                        if (idx < 3) console.log(`[AI Bank Soal] Normalized [${idx + 1}]: "${normalized.text.substring(0, 40)}..."`);
                        return normalized;
                    });

                    console.log(`[AI Bank Soal] After normalization: ${normalizedQuestions.length} questions`);

                    // Deduplicate
                    const textSet = new Set();
                    const deduplicatedQuestions = [];
                    normalizedQuestions.forEach((q) => {
                        const textKey = q.text?.toLowerCase().trim();
                        if (textKey && !textSet.has(textKey)) {
                            textSet.add(textKey);
                            deduplicatedQuestions.push(q);
                        }
                    });

                    console.log(`[AI Bank Soal] After deduplication: ${deduplicatedQuestions.length} questions (removed ${normalizedQuestions.length - deduplicatedQuestions.length} duplicates)`);

                    // Filter invalid
                    const validQuestions = deduplicatedQuestions.filter((q, idx) => {
                        const textValid = q.text && q.text.trim().length >= 3;
                        const optionsValid = q.type === 'text' || q.type === 'tf' || (Array.isArray(q.options) && q.options.length >= 4);
                        const tfValid = q.type !== 'tf' || (Array.isArray(q.subQuestions) && q.subQuestions.length >= 1);

                        if (!textValid || !optionsValid || !tfValid) {
                            console.warn(`[AI Bank Soal] Filtering out [${idx + 1}]: text=${textValid}, options=${optionsValid}, tf=${tfValid}, type=${q.type}`);
                            return false;
                        }
                        return true;
                    });

                    console.log(`[AI Bank Soal] After validation: ${validQuestions.length} valid questions`);

                    // Save to database
                    db.questions = [...db.questions, ...validQuestions];
                    await writeDB(db);
                    console.log(`[AI Bank Soal] ✅ Successfully saved ${validQuestions.length} questions to database`);

                    parsedQuestions = validQuestions;
                    bankSaveError = null;

                } catch (error) {
                    console.error(`[AI Bank Soal] Error saving Strategy 1 results: ${error.message}`);
                    bankSaveError = error.message;
                    // Fall through to Strategy 2
                }
            }

            // STRATEGY 2: AI-based extraction (as fallback)
            if (!bankSaveError && (!questionsFromHtml || questionsFromHtml.length === 0)) {
                console.log(`[AI Bank Soal] === STRATEGY 2: AI-based Extraction (Fallback) ===`);
                console.log(`[AI Bank Soal] Strategy 1 extracted 0 questions, attempting AI extraction...`);

                const extractionPrompt = `EKSTRAK ${estimatedQuestionCount}+ SOAL KE JSON ARRAY

Dokumen HTML soal:
${text}

INSTRUKSI:
1. Ekstrak SEMUA soal dari dokumen di atas
2. Format JSON array dengan soal-soal:
{"text":"Pertanyaan","options":["A. ...","B. ...","C. ...","D. ..."],"correct":0,"type":"single"}
3. correct = 0(A), 1(B), 2(C), 3(D)
4. Output HANYA JSON array, tidak ada text lain
5. HARUS ada ${estimatedQuestionCount}+ soal dalam array

OUTPUT:`;

                try {
                    const extractResult = await callAI(extractionPrompt, req);
                    let extractText = (extractResult.text || '').trim();

                    // Clean markdown
                    extractText = extractText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

                    console.log(`[AI Bank Soal] AI response length: ${extractText.length}`);

                    // Parse JSON
                    const arrayStart = extractText.indexOf('[');
                    const arrayEnd = extractText.lastIndexOf(']');

                    if (arrayStart !== -1 && arrayEnd !== -1) {
                        let rawJson = extractText.substring(arrayStart, arrayEnd + 1);

                        // Try parsing with bracket completion if needed
                        let parsed;
                        try {
                            parsed = JSON.parse(rawJson);
                        } catch (e) {
                            // Try adding closing braces
                            let temp = rawJson + ']}';
                            try {
                                parsed = JSON.parse(temp);
                            } catch (e2) {
                                throw e; // throw original error
                            }
                        }

                        if (Array.isArray(parsed) && parsed.length > 0) {
                            console.log(`[AI Bank Soal] AI extracted ${parsed.length} questions`);

                            // Save to database
                            const db = (await readDB()) || { questions: [] };
                            if (!db.questions) db.questions = [];

                            let normalizedQuestions = parsed.map(q => normalizeQuestion(q, mapel, fase, req.teacherId));

                            // Deduplicate
                            const textSet = new Set();
                            const deduplicatedQuestions = [];
                            normalizedQuestions.forEach((q) => {
                                const textKey = q.text?.toLowerCase().trim();
                                if (textKey && !textSet.has(textKey)) {
                                    textSet.add(textKey);
                                    deduplicatedQuestions.push(q);
                                }
                            });

                            // Validate
                            const validQuestions = deduplicatedQuestions.filter(q => {
                                const textValid = q.text && q.text.trim().length >= 3;
                                const optionsValid = q.type === 'text' || q.type === 'tf' || (Array.isArray(q.options) && q.options.length >= 4);
                                const tfValid = q.type !== 'tf' || (Array.isArray(q.subQuestions) && q.subQuestions.length >= 1);
                                return textValid && optionsValid && tfValid;
                            });

                            db.questions = [...db.questions, ...validQuestions];
                            await writeDB(db);
                            console.log(`[AI Bank Soal] ✅ Saved ${validQuestions.length} questions from AI extraction`);

                            parsedQuestions = validQuestions;
                            bankSaveError = null;
                        }
                    }
                } catch (aiError) {
                    console.error(`[AI Bank Soal] Strategy 2 failed: ${aiError.message}`);
                    bankSaveError = aiError.message;
                }
            }

            // Final result logging
            if (bankSaveError) {
                console.error(`[AI Bank Soal] ❌ FINAL ERROR: ${bankSaveError}`);
            } else if (parsedQuestions && parsedQuestions.length > 0) {
                console.log(`[AI Bank Soal] ✅ FINAL SUCCESS: ${parsedQuestions.length} questions saved to bank`);
            } else {
                console.warn(`[AI Bank Soal] ⚠️ No questions were saved`);
            }
        }


        console.log(`[/api/generate-admin-doc] Success for ${docType}`);

        // Final validation: Check if saved questions match expectations
        const htmlTags = (text.match(/<li[^>]*>/gi) || []).length;
        const numberedItems = (text.match(/^\d+\./gm) || []).length;
        const expectedCount = Math.max(htmlTags, numberedItems);
        const actualSaved = Array.isArray(parsedQuestions) ? parsedQuestions.length : 0;

        if (shouldSaveToBank && actualSaved < expectedCount) {
            console.warn(`[/api/generate-admin-doc] ⚠️ FINAL WARNING: Only ${actualSaved} questions saved to bank, but HTML analysis shows ${expectedCount} expected questions`);
            console.warn(`[/api/generate-admin-doc] ⚠️ This indicates incomplete question extraction`);
        } else if (shouldSaveToBank && actualSaved >= expectedCount) {
            console.log(`[/api/generate-admin-doc] ✅ Question extraction complete: ${actualSaved} questions saved (expected: ${expectedCount})`);
        }

        return res.json({
            ok: true,
            html: text,
            savedToBankSoal: !!parsedQuestions,
            requestedSaveToBankSoal: shouldSaveToBank,
            savedQuestionsCount: actualSaved,
            expectedQuestionsCount: expectedCount,
            bankSaveError
        });
    } catch (e) {
        console.error('[/api/generate-admin-doc] Fatal error:', e.message);
        const quotaExhausted = /kuota|quota|limit|habis/i.test(e.message);
        const needsApiKeys = /tidak ada api key|tidak memiliki api key|API Key Gemini/i.test(e.message);
        const allKeysExhausted = /semua.*(provider|api|key|quota|kuota)/i.test(e.message) || needsApiKeys;
        return res.status(500).json({
            error: e.message,
            quotaExhausted,
            needsApiKeys,
            allKeysExhausted,
            redirectToApiKeys: allKeysExhausted
        });
    }
});

// ─── API: Kisi-kisi Generate ──────────────────────────────────────────────────
app.post('/api/generate-kisi-kisi', async (req, res) => {
    // Extract teacher info from headers if available, with body fallback
    req.teacherId = req.headers['x-teacher-id'] || req.body.teacherId;
    req.teacherName = req.headers['x-teacher-name'] || req.body.teacherName;

    if (req.teacherId) {
        const idSource = req.headers['x-teacher-id'] ? 'Headers' : 'Body';
        console.log(`[AI] /api/generate-kisi-kisi: Identitas terdeteksi [${req.teacherId}] dari ${idSource}`);
    }

    const { questions, mapel = '', rombel = '' } = req.body;
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
        const aiResult = await callAI(prompt, req);
        let text = aiResult.text || '';

        // Clean up JSON response using helper
        const jsonText = cleanAIResponse(text);

        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        } catch (jsonError) {
            console.error('[/api/generate-kisi-kisi] JSON parsing failed:', jsonError.message);
            return res.status(500).json({ error: 'Format JSON dari AI tidak valid.' });
        }

        return res.json({ ok: true, kisiKisi: parsed });
    } catch (e) {
        const quotaExhausted = /kuota|quota|limit|habis/i.test(e.message);
        const needsApiKeys = /tidak ada api key|tidak memiliki api key|API Key Gemini/i.test(e.message);
        const allKeysExhausted = /semua.*(provider|api|key|quota|kuota)/i.test(e.message) || (needsApiKeys && !quotaExhausted);

        let errorMessage = e.message;
        if (allKeysExhausted && !needsApiKeys) {
            errorMessage = '🔴 Semua API Key Anda sudah habis atau tidak dikonfigurasi. Silakan tambahkan API Key baru di halaman API Keys untuk melanjutkan. Anda akan dibawa ke halaman tersebut secara otomatis.';
        }

        return res.status(500).json({
            error: errorMessage,
            quotaExhausted,
            needsApiKeys,
            allKeysExhausted,
            redirectToApiKeys: allKeysExhausted && req && req.teacherId
        });
    }
});

// ─── API: IPs ─────────────────────────────────────────────────────────────────
app.get('/api/ips', (req, res) => {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    const ips = [];
    for (const ifaces of Object.values(nets))
        for (const iface of ifaces)
            if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    res.json(ips);
});

// ─── Catch-all ────────────────────────────────────────────────────────────────
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.use('/api', (err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

// ─── Local Init (Skip on Vercel to avoid Read-Only system error) ────────────────
if (!USE_SUPABASE && !process.env.VERCEL) {
    if (!fs.existsSync(LOCAL_DATA)) fs.writeFileSync(LOCAL_DATA, JSON.stringify(DEFAULT_DB, null, 2));
    if (!fs.existsSync(LOCAL_RESULTS)) fs.writeFileSync(LOCAL_RESULTS, '[]');
}

// ─── Listen (skip on Vercel) ──────────────────────────────────────────────────
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
        const { networkInterfaces } = require('os');
        const nets = networkInterfaces();

        console.log(`\n🚀 CBT Exam Server Running!`);
        console.log(`📡 Local Access   : http://localhost:${PORT}`);

        // Display all available network IPs
        for (const [name, net] of Object.entries(nets)) {
            for (const iface of net) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    console.log(`🌐 Network (${name}): http://${iface.address}:${PORT}`);
                }
            }
        }

        console.log(`\n   Database Mode : ${USE_SUPABASE ? 'Supabase Cloud' : 'Local JSON Disk'}`);
        console.log(`   Assets Folder : ${isPkg ? 'External /APP' : 'Local Root'}`);
        console.log(`   Admin Login   : Username 'ADM', Password 'admin321'`);
        console.log(`\n(Tekan Ctrl+C untuk menghentikan server)\n`);
    });
}

module.exports = app;
