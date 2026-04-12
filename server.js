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
    timeLimits: {}
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

    const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    const prompt = "Ini adalah foto atau scan dokumen kisi-kisi / soal ujian. Tolong baca dan ekstrak SELURUH teks yang terlihat dalam gambar ini secara akurat. Jika ada tabel, pertahankan strukturnya. Jangan tambahkan komentar, langsung tulis teks yang ada di gambar saja.";

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
                console.warn(`[OCR] Model ${model} failed: ${response.status} - ${errData.error?.message || ''}`);
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
    try {
        if (!fs.existsSync(LOCAL_DATA)) return null;
        return JSON.parse(fs.readFileSync(LOCAL_DATA, 'utf8'));
    } catch { return null; }
}

async function writeDB(obj) {
    if (USE_SUPABASE) {
        const { error } = await supabase
            .from('cbt_database')
            .upsert({ id: 1, data: obj, updated_at: new Date() });
        if (error) throw new Error('Supabase writeDB error: ' + error.message);
        return;
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
/**
 * Helper to call Gemini with key rotation and model fallback
 */
async function callGeminiAI(prompt) {
    const rawKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
    const keys = rawKey.split(',').map(k => k.trim()).filter(k => k);

    console.log('[AI] Key present:', rawKey.length > 0, '| Keys count:', keys.length);

    if (keys.length === 0) throw new Error('GOOGLE_API_KEY / GEMINI_API_KEY tidak dikonfigurasi di Environment Variables');

    // Super-charged model list for maximum resilience (including next-gen models)
    const models = [
        { name: 'gemini-3-flash', version: 'v1beta' },
        { name: 'gemini-3-pro', version: 'v1beta' },
        { name: 'gemini-2.5-flash', version: 'v1beta' },
        { name: 'gemini-2.5-pro', version: 'v1beta' },
        { name: 'gemini-2.0-flash', version: 'v1' },
        { name: 'gemini-1.5-flash', version: 'v1' },
        { name: 'gemini-1.5-flash-latest', version: 'v1beta' },
        { name: 'gemini-1.5-flash-8b', version: 'v1' },
        { name: 'gemini-2.0-flash-lite-preview-02-05', version: 'v1beta' },
        { name: 'gemini-1.5-pro', version: 'v1' },
        { name: 'gemini-1.5-pro-latest', version: 'v1beta' },
        { name: 'gemini-1.0-pro', version: 'v1' }
    ];

    let lastError;
    const timeoutWarning = setTimeout(() => {
        console.warn(`[AI] ⚠️ Gemini takes >8s. On Vercel Hobby, this may timeout (10s limit).`);
    }, 8000);

    try {
        for (const modelObj of models) {
            const { name: model, version } = modelObj;
            for (const key of keys) {
                try {
                    console.log(`[AI] Trying Gemini: ${model} (${version})...`);

                    const response = await fetch(`https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${key}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        const result = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        console.log(`[AI] ✅ Success with model: ${model}`);
                        clearTimeout(timeoutWarning);
                        return result;
                    }

                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData.error?.message || response.statusText;
                    
                    if (response.status === 429) {
                        lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada model ${model} (${version}). Tolong tunggu beberapa menit atau gunakan API Key lain.`;
                        console.warn(`[AI] ⚠️ Quota exceeded for model: ${model}`);
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
    } finally {
        clearTimeout(timeoutWarning);
    }
    throw new Error('Gagal menggunakan Gemini: ' + lastError);
}

/**
 * Helper to call OpenAI / ChatGPT
 */
async function callOpenAI(prompt) {
    const rawKey = process.env.OPENAI_API_KEY || '';
    const keys = rawKey.split(',').map(k => k.trim()).filter(k => k);

    console.log('[AI] OPENAI_API_KEY present:', rawKey.length > 0, '| Keys count:', keys.length);

    if (keys.length === 0) throw new Error('OPENAI_API_KEY tidak dikonfigurasi di Environment Variables');

    const models = ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'];
    let lastError;

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
                
                if (response.status === 429) {
                    lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada model OpenAI ${model}. Tolong isi saldo atau gunakan model lain.`;
                    console.warn(`[AI] ⚠️ OpenAI Quota exceeded for model: ${model}`);
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
    throw new Error('OpenAI gagal: ' + lastError);
}

/**
 * Unified AI caller with fully automatic fallback mechanism
 */
async function callAI(prompt) {
    try {
        return await callOpenAI(prompt);
    } catch (e) {
        console.warn(`[AI] OpenAI failed (${e.message}), automatically falling back to Gemini...`);
        return await callGeminiAI(prompt);
    }
}

app.post('/api/generate-ai', async (req, res) => {
    const {
        materi,
        jumlah = 5,
        tipe = 'single',
        mapel = '',
        rombel = '',
        typeCounts = {},
        levelCounts = {}
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
        tf: 'benar/salah ( 3 pernyataan per soal)',
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
    prompt += 'Balas HANYA dengan JSON array valid tanpa markdown atau kata-kata tambahan. ';
    prompt += 'Contoh format: [{"text":"Pertanyaan?","options":["A","B","C","D"],"correct":0,"mapel":"' + mapel + '","rombel":"' + rombel + '","type":"single"}]. ';
    prompt += 'Untuk soal pilihan ganda kompleks gunakan "correct" sebagai array indeks (0-3 untuk A-D) dengan 2-3 jawaban benar, contoh: {"type":"multiple","options":["A","B","C","D"],"correct":[0,2,3]}. ';
    prompt += 'Untuk soal benar/salah gunakan "options" sebagai daftar minimal 3 pernyataan dan "correct" sebagai array boolean dengan panjang sama seperti options, contoh: {"type":"tf","options":["Pernyataan 1","Pernyataan 2","Pernyataan 3"],"correct":[true,false,true]}. ';
    prompt += 'Untuk soal menjodohkan gunakan "questions" sebagai array pertanyaan, "answers" sebagai array jawaban, dan "correct" sebagai array string yang menunjukkan jawaban untuk setiap pertanyaan, contoh: {"type":"matching","questions":["Pertanyaan 1","Pertanyaan 2"],"answers":["Jawaban A","Jawaban B"],"correct":["Jawaban A","Jawaban B"]}.';

    console.log(`[/api/generate-ai] Request: mapel=${mapel}, rombel=${rombel}, jumlah=${actualJumlah}, tipe=${tipe}, typeCounts=${JSON.stringify(normalizedCounts)}, levelCounts=${JSON.stringify(levelCounts)}`);

    try {
        let text = await callAI(prompt);

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
                text: questionText,
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

        console.log(`[/api/generate-ai] Parsed questions:`, JSON.stringify(parsed, null, 2));

        // Normalize question formats
        let normalizedQuestions = parsed.map(q => {
            const normalized = { ...q };

            // Ensure mapel and rombel are set
            if (!normalized.mapel) normalized.mapel = mapel;
            if (!normalized.rombel) normalized.rombel = rombel;

            // Normalize TF questions
            if (normalized.type === 'tf') {
                const parseBooleanAnswer = value => {
                    if (typeof value === 'boolean') return value;
                    if (typeof value === 'number') return value === 1;
                    if (typeof value !== 'string') return false;
                    const clean = value.toString().trim().toLowerCase();
                    if (['benar', 'true', 't', 'ya', 'yes', '1'].includes(clean)) return true;
                    if (['salah', 'false', 'f', 'tidak', 'no', '0'].includes(clean)) return false;
                    return false;
                };

                const normalizeOptionList = raw => {
                    if (Array.isArray(raw)) {
                        return raw.flatMap(item => {
                            if (typeof item !== 'string') return [];
                            const parts = item.split(/\r?\n|;/).map(s => s.trim()).filter(Boolean);
                            return parts;
                        }).map(s => s.trim()).filter(Boolean);
                    }
                    if (typeof raw === 'string') {
                        return raw.split(/\r?\n|;/).map(s => s.trim()).filter(Boolean);
                    }
                    return [];
                };

                const parseStatementsFromText = text => {
                    const statements = [];
                    const corrects = [];
                    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
                    for (const line of lines) {
                        const match = line.match(/^(?:\d+\.|\-|\*)?\s*(.+?)\s*(?:[\-:–]\s*(Benar|Salah|True|False|T|F|Ya|Tidak|Yes|No)|\((Benar|Salah|True|False|T|F|Ya|Tidak|Yes|No)\))?\s*$/i);
                        if (match) {
                            const stmt = match[1].trim();
                            const answer = match[2] || match[3] || '';
                            if (stmt) {
                                statements.push(stmt);
                                corrects.push(parseBooleanAnswer(answer));
                            }
                        }
                    }
                    return { statements, corrects };
                };

                normalized.options = normalizeOptionList(normalized.options);

                // If options were provided as an array containing a single multiline string,
                // flatten that single item into separate statements.
                if (normalized.options.length === 1 && /\r?\n/.test(normalized.options[0])) {
                    normalized.options = normalized.options[0].split(/\r?\n|;/).map(s => s.trim()).filter(Boolean);
                }

                // Detect statements and answers embedded in options if present
                if (normalized.options.length > 0) {
                    const parsedOptions = [];
                    const parsedCorrects = [];
                    for (const opt of normalized.options) {
                        const match = opt.match(/^(.+?)\s*(?:[\-:–]\s*|\()?(Benar|Salah|True|False|T|F|Ya|Tidak|Yes|No)\)?$/i);
                        if (match) {
                            parsedOptions.push(match[1].trim());
                            parsedCorrects.push(parseBooleanAnswer(match[2] || match[3]));
                        } else {
                            parsedOptions.push(opt);
                            parsedCorrects.push(false);
                        }
                    }
                    normalized.options = parsedOptions;
                    if (!Array.isArray(normalized.correct) || normalized.correct.length !== parsedCorrects.length) {
                        normalized.correct = parsedCorrects;
                    }
                }

                // If options are empty or need stronger parsing, try text field
                if (normalized.options.length === 0 && normalized.text && typeof normalized.text === 'string') {
                    const { statements, corrects } = parseStatementsFromText(normalized.text);
                    if (statements.length >= 3) {
                        normalized.options = statements.slice(0, 3);
                        normalized.correct = corrects.slice(0, 3);
                        normalized.text = '';
                    } else if (statements.length > 0) {
                        normalized.options = statements;
                        normalized.correct = corrects;
                    }
                }

                if (!Array.isArray(normalized.correct)) {
                    normalized.correct = normalized.options.map(() => false);
                } else if (normalized.correct.length !== normalized.options.length) {
                    const correctLength = normalized.correct.length;
                    const optionsLength = normalized.options.length;
                    if (correctLength < optionsLength) {
                        normalized.correct = [
                            ...normalized.correct,
                            ...Array(optionsLength - correctLength).fill(false)
                        ];
                    } else if (correctLength > optionsLength) {
                        normalized.correct = normalized.correct.slice(0, optionsLength);
                    }
                }

                normalized.correct = normalized.correct.map(parseBooleanAnswer);
            }

            // Normalize multiple choice questions
            if (normalized.type === 'multiple') {
                // Ensure 4 options A,B,C,D
                if (!Array.isArray(normalized.options) || normalized.options.length !== 4) {
                    normalized.options = ['A', 'B', 'C', 'D'];
                }
                if (!Array.isArray(normalized.correct)) {
                    normalized.correct = [normalized.correct]; // Convert single to array
                }
                // Ensure 2-3 correct answers
                if (normalized.correct.length < 2) {
                    // Add more correct answers if less than 2
                    const available = [0,1,2,3].filter(i => !normalized.correct.includes(i));
                    while (normalized.correct.length < 2 && available.length > 0) {
                        const idx = available.splice(Math.floor(Math.random() * available.length), 1)[0];
                        normalized.correct.push(idx);
                    }
                } else if (normalized.correct.length > 3) {
                    // Limit to 3 correct answers
                    normalized.correct = normalized.correct.slice(0, 3);
                }
                // Ensure all are numbers 0-3
                normalized.correct = normalized.correct.filter(c => typeof c === 'number' && c >= 0 && c <= 3);
            }

            // Normalize matching questions
            if (normalized.type === 'matching') {
                if (!Array.isArray(normalized.questions)) {
                    normalized.questions = [];
                }
                if (!Array.isArray(normalized.answers)) {
                    normalized.answers = [];
                }
                if (!Array.isArray(normalized.correct)) {
                    // Default: match first questions to first answers
                    normalized.correct = normalized.questions.slice(0, Math.min(normalized.questions.length, normalized.answers.length));
                } else if (normalized.correct.length !== normalized.questions.length) {
                    // Adjust correct array length
                    const questionsLength = normalized.questions.length;
                    if (normalized.correct.length < questionsLength) {
                        // Pad with empty strings or first available answer
                        const padding = Array(questionsLength - normalized.correct.length).fill(normalized.answers[0] || '');
                        normalized.correct = [...normalized.correct, ...padding];
                    } else {
                        normalized.correct = normalized.correct.slice(0, questionsLength);
                    }
                }
                // Ensure all correct values are strings
                normalized.correct = normalized.correct.map(c => String(c));
            }

            // Ensure other required fields
            if (!normalized.images) normalized.images = [];
            if (!normalized.text) normalized.text = '';

            return normalized;
        });

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
    topik = topik || topic; // Compatibility for both field names

    if (!mapel || (!topik && !req.file)) {
        return res.status(400).json({ error: 'Mata Pelajaran wajib diisi. Selain itu, Anda harus menyertakan Topik/Materi atau mengupload File Kisi-kisi.' });
    }

    let blueprintText = "";
    if (req.file) {
        try {
            const rawText = await parseBlueprint(req.file.buffer, req.file.originalname);
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
        promptText = `Buatkan instrumen Soal dan Kunci Jawaban untuk mata pelajaran ${mapel} fase ${fase} ${topicHint}. Rincian jumlah dan bentuk soal yang diharapkan adalah: ${extraData?.jumlahPerBentuk || '5 soal Pilihan Ganda'}. Usahakan tipe soal HOTS (Higher Order Thinking Skills). Berikan juga pembahasan singkat untuk masing-masing soal.`;

        if (extraData?.opsiGambar === 'placeholder') {
            promptText += `\nUntuk soal yang memerlukan ilustrasi gambar, JANGAN gunakan placeholder gambar biasa. Gunakan blok HTML berikut sebagai "Area Ilustrasi" agar terlihat profesional:\n<div style="border: 2px dashed #cbd5e1; border-radius: 8px; padding: 20px; text-align: center; background-color: #f8fafc; margin: 15px 0;"><i class="fas fa-image" style="font-size: 32px; color: #94a3b8; margin-bottom: 10px; display: block;"></i><p style="font-weight: bold; color: #475569; margin: 0; font-size: 14px;">[Area Ilustrasi: DESKRIPSI_GAMBAR]</p><p style="font-size: 11px; color: #94a3b8; margin-top: 5px;">(Guru dapat menyisipkan gambar spesifik di sini)</p></div>\nGanti teks DESKRIPSI_GAMBAR dengan nama/objek gambar yang relevan (misal: "Struktur Akar Tumbuhan").`;
        } else if (extraData?.opsiGambar === 'auto') {
            promptText += `\nUntuk soal yang memerlukan ilustrasi gambar, tampilkan gambar asli secara otomatis dengan memanfaatkan layanan pihak ketiga menggunakan tag HTML ini: <br><img src="https://image.pollinations.ai/prompt/[ENGLISH_VISUAL_DESCRIPTION]?width=500&height=300&nologo=true" alt="Ilustrasi AI" style="border-radius: 8px; margin: 15px 0; max-width: 100%; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); border: 1px solid #e2e8f0;">\nGantikan [ENGLISH_VISUAL_DESCRIPTION] with deskripsi visual yang sangat detail dalam BAHASA INGGRIS yang merangkum maksud soal (misalnya: "detailed educational anatomical cross section diagram of human heart on white background"). Semakin detail instruksinya, gambar akan tampil semakin akurat.`;
        }

        if (extraData?.generateKisiKisi) {
            promptText += `\n\nPenting: Berdasarkan soal-soal yang Anda buat, buatkan juga matriks KISI-KISI UJIAN yang menjadi panduannya (Lengkap dengan Indikator Soal dan Level Kognitif) and tampilkan matriks tersebut pada bagian PALING ATAS / AWAL dari dokumen sebelum daftar soal.`;
        }

        if (extraData?.pisahLembar) {
            promptText += `\nPenting: Karena fitur 'Pisahkan Halaman' diaktifkan, Anda WAJIB menyisipkan tag HTML ini: <div style="page-break-before: always;"></div> tepat sebelum judul "KUNCI JAWABAN" dimulai.`;
        }

        if (extraData?.simpanBank) {
            promptText += `\nSANGAT PENTING (INSTRUKSI DATABASE): Pada bagian PALING AKHIR dokumen dokumen HTML Anda, sematkan array JSON data soal-soal tersebut HANYA di dalam tag ini persis: <script id="ai-json-data" type="application/json"> [ARRAY_JSON] </script>. ARRAY_JSON adalah format pertanyaan seperti ini: { "text": "Pertanyaan?", "options": ["A","B","C","D"], "correct": 0, "type": "single", "mapel": "${mapel}", "rombel": "${fase}" }.\nWAJIB GUNAKAN TYPE BERIKUT: "single" (PG), "multiple" (PG Kompleks), "text" (Uraian), "tf" (Benar/Salah), "matching" (Menjodohkan). Opsi array kosongkan untuk tipe Isian/Benar-Salah/Menjodohkan. Correct dapat berupa indeks jawaban (untuk PG) atau string kunci jawaban.`;
        }
    } else {
        return res.status(400).json({ error: 'Tipe dokumen tidak valid' });
    }

    let blueprintContext = "";
    if (blueprintText) {
        blueprintContext = `REFERENSI DOKUMEN GURU (BLUEPRINT/KISI-KISI):\n====\n${blueprintText}\n====\nSANGAT PENTING: Gunakan teks referensi di atas sebagai satu-satunya panduan materi, indikator, dan bentuk soal. Sesuaikan hasil generate dengan apa yang tertulis dalam dokumen referensi tersebut.\n\n`;
    }

    const fullPrompt = `Identitas Sekolah: ${address || 'SMP Kristen Dorkas'}. Guru Pengampu: ${teacherName || 'Guru SMP Kristen Dorkas'}.\n\n${blueprintContext}${promptText}

PERINTAH FORMATTING: 
Tulis output HANYA MENGGUNAKAN tag HTML (tanpa tag <html>, <head>, atau <body>) agar saya bisa langsung menampilkannya di div innerHTML. Gunakan tag <h1>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <p>, dan <table> (untuk data matriks).
Berikan juga CSS inline jika dibutuhkan untuk struktur tabel (seperti: <table border="1" style="width:100%; border-collapse: collapse; text-align: left; margin-bottom: 20px;"><tr><th style="padding: 8px; background: #f1f5f9;">...</th></tr>).
DILARANG memberikan kalimat pembuka atau penutup di luar tag HTML. DILARANG menggunakan markdown block (seperti \`\`\`html). Output harus 100% kode HTML mentah.`;

    try {
        let text = await callAI(fullPrompt);

        // Membersihkan markdown wrapper (```html ... ```) jika AI membocorkannya
        text = text.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();

        // Cek apakah ada script JSON Bank Soal
        let parsedQuestions = null;
        if (extraData?.simpanBank) {
            const match = text.match(/<script id="ai-json-data"[^>]*>([\s\S]*?)<\/script>/i);
            if (match && match[1]) {
                try {
                    parsedQuestions = JSON.parse(match[1].trim());
                    // Tambahkan ke database
                    const db = (await readDB()) || { questions: [] };
                    if (!db.questions) db.questions = [];
                    // Inject basic standard properties
                    parsedQuestions = parsedQuestions.map(q => ({
                        ...q,
                        mapel: q.mapel || mapel,
                        rombel: q.rombel || fase,
                        type: normalizeQuestionType(q.type)
                    }));
                    db.questions = [...db.questions, ...parsedQuestions];
                    await writeDB(db);
                    console.log(`[AI Bank Soal] Successfully saved ${parsedQuestions.length} questions to database.`);

                    // Hilangkan tag script dari HTML render
                    text = text.replace(match[0], '');
                } catch (parseError) {
                    console.error('[AI Bank Soal] Failed to parse generated JSON:', parseError);
                }
            }
        }

        console.log(`[/api/generate-admin-doc] Success for ${docType}`);
        return res.json({ ok: true, html: text, savedToBankSoal: !!parsedQuestions });
    } catch (e) {
        console.error('[/api/generate-admin-doc] Fatal error:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

// ─── API: Kisi-kisi Generate ──────────────────────────────────────────────────
app.post('/api/generate-kisi-kisi', async (req, res) => {
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
        let text = await callAI(prompt);

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
