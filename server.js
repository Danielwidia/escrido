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

function normalizeQuestionCorrect(question) {
    const normalized = { ...question };
    if (normalized.type === 'text') {
        normalized.correct = normalizeTextCorrect(normalized.correct);
    }
    return normalized;
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
        const { error } = await supabase
            .from('cbt_database')
            .upsert({ id: 1, data: obj, updated_at: new Date() });
        if (error) throw new Error('Supabase writeDB error: ' + error.message);
        return;
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
 * Helper to get teacher API keys from database
 */
async function getTeacherAPIKeys(teacherId, req) {
    try {
        const db = await readDB();
        if (!db.students) return [];

        const teacher = db.students.find(s => s.id === teacherId && s.role === 'teacher');
        if (!teacher || !Array.isArray(teacher.apiKeys)) return [];

        const normalized = normalizeTeacherApiKeysArray(teacher.apiKeys);
        if (normalized.length !== teacher.apiKeys.length || teacher.apiKeys.some(k => typeof k === 'string' || (typeof k === 'object' && !('status' in k)))) {
            teacher.apiKeys = normalized;
            await writeDB(db);
        }

        const validKeys = normalized.filter(entry => entry.status !== 'exhausted').map(entry => entry.key);
        if (validKeys.length > 0) {
            console.log(`[AI] Found ${validKeys.length} active API keys from teacher: ${teacher.name}`);
        }
        return validKeys;
    } catch (e) {
        console.warn('[AI] Error fetching teacher API keys:', e.message);
        return [];
    }
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
    // Start with global API keys
    const globalKeys = parseApiKeyList(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '');

    // Add teacher's personal API keys if available
    let teacherKeys = [];
    if (req && req.teacherId) {
        teacherKeys = await getTeacherAPIKeys(req.teacherId, req);
    }

    const keys = [...teacherKeys, ...globalKeys]; // Teacher keys first for priority
    const teacherKeysSet = new Set(teacherKeys);

    console.log('[AI] Gemini: Global keys count:', globalKeys.length, '| Teacher keys count:', teacherKeys.length, '| Total:', keys.length);

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
    } finally {
        clearTimeout(timeoutWarning);
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
    // Start with global API keys
    const globalKeys = parseApiKeyList(process.env.OPENAI_API_KEY || '');

    // Add teacher's personal API keys if available
    let teacherKeys = [];
    if (req && req.teacherId) {
        teacherKeys = await getTeacherAPIKeys(req.teacherId, req);
    }

    const keys = [...teacherKeys, ...globalKeys]; // Teacher keys first for priority
    const teacherKeysSet = new Set(teacherKeys);

    console.log('[AI] OpenAI: Global keys count:', globalKeys.length, '| Teacher keys count:', teacherKeys.length, '| Total:', keys.length);

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
                        messages: [{ role: 'user', content: prompt }]
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
    // Start with global API keys
    const globalKeys = parseApiKeyList(process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || process.env.OPEN_ROUTER_KEY || '');

    // Add teacher's personal API keys if available
    let teacherKeys = [];
    if (req && req.teacherId) {
        teacherKeys = await getTeacherAPIKeys(req.teacherId, req);
    }

    const keys = [...teacherKeys, ...globalKeys]; // Teacher keys first for priority
    const teacherKeysSet = new Set(teacherKeys);

    console.log('[AI] OpenRouter: Global keys count:', globalKeys.length, '| Teacher keys count:', teacherKeys.length, '| Total:', keys.length);

    if (keys.length === 0) return logProviderSkip('OpenRouter');

    const models = [
        'openrouter/free',
        'google/gemini-2.0-flash-exp:free',
        'meta-llama/llama-3.3-70b:free',
        'mistralai/mistral-small-24b:free',
        'qwen/qwen-3.5-plus:free'
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
                        temperature: 0.7,
                        max_tokens: 1024
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
            console.warn('[/api/generate-ai] Gagal membuat gambar AI untuk soal:', e.message);
            q.images = q.images || [];
        }

        results.push(q);
    }
    return results;
}

/**
 * Helper to call Hugging Face Inference API
 */
async function callHuggingFaceAI(prompt, req) {
    // Start with global API keys
    const globalKeys = parseApiKeyList(process.env.HUGGINGFACE_API_KEY || process.env.HF_API_KEY || '');

    // Add teacher's personal API keys if available
    let teacherKeys = [];
    if (req && req.teacherId) {
        teacherKeys = await getTeacherAPIKeys(req.teacherId, req);
    }

    const keys = [...teacherKeys, ...globalKeys]; // Teacher keys first for priority
    const teacherKeysSet = new Set(teacherKeys);

    const hfApiUrl = process.env.HUGGINGFACE_API_URL || 'https://router.huggingface.co';

    console.log('[AI] HuggingFace: Global keys count:', globalKeys.length, '| Teacher keys count:', teacherKeys.length, '| Total:', keys.length);
    console.log('[AI] HUGGINGFACE_API_URL used:', hfApiUrl);
    if (keys.length === 0) return logProviderSkip('HuggingFace');

    const models = [
        'tiiuae/falcon-7b-instruct',
        'google/flan-t5-xl',
        'gpt2-large'
    ];

    let lastError;
    const exhaustedTeacherKeys = [];

    for (const model of models) {
        for (const key of keys) {
            try {
                console.log(`[AI] Trying HuggingFace model: ${model} with key: ${key.substring(0, 10)}...`);

                const response = await fetch(`${hfApiUrl}/models/${model}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        inputs: prompt,
                        parameters: {
                            max_new_tokens: 512,
                            temperature: 0.7,
                            return_full_text: false
                        }
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const result = Array.isArray(data)
                        ? data[0]?.generated_text || data[0]?.text || ''
                        : data.generated_text || data.text || '';

                    if (result) {
                        console.log(`[AI] ✅ Success with HuggingFace model: ${model}`);
                        return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                    }

                    lastError = `[HuggingFace ${model}] response format invalid`;
                    console.warn('[AI] HuggingFace returned response without generated text.');
                } else {
                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData.error || errData?.[0]?.error || response.statusText;

                    if (response.status === 429) {
                        lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada HuggingFace model ${model}.`;
                        console.warn(`[AI] ⚠️ HuggingFace quota exceeded for model: ${model}`);
                        if (req && req.teacherId && teacherKeysSet.has(key)) {
                            const marked = await markTeacherKeyExhausted(req.teacherId, key, `HuggingFace ${model} 429`);
                            if (marked) {
                                exhaustedTeacherKeys.push(key);
                                console.log(`[AI] Marked HuggingFace teacher key as exhausted for teacher ${req.teacherId}`);
                            }
                        } else if (!teacherKeysSet.has(key)) {
                            // This is a global key
                            await markGlobalKeyExhausted(key, `HuggingFace ${model} 429`);
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
    // Start with global API keys
    const globalKeys = parseApiKeyList(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '');

    // Add teacher's personal API keys if available
    let teacherKeys = [];
    if (req && req.teacherId) {
        teacherKeys = await getTeacherAPIKeys(req.teacherId, req);
    }

    const keys = [...teacherKeys, ...globalKeys]; // Teacher keys first for priority
    const teacherKeysSet = new Set(teacherKeys);

    console.log('[AI] Anthropic: Global keys count:', globalKeys.length, '| Teacher keys count:', teacherKeys.length, '| Total:', keys.length);
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
                    max_tokens: 1024,
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
    // Start with global API keys
    const globalKeys = parseApiKeyList(process.env.XAI_API_KEY || process.env.GROK_API_KEY || process.env.GROQ_API_KEY || '');

    // Add teacher's personal API keys if available
    let teacherKeys = [];
    if (req && req.teacherId) {
        teacherKeys = await getTeacherAPIKeys(req.teacherId, req);
    }

    const keys = [...teacherKeys, ...globalKeys]; // Teacher keys first for priority
    const teacherKeysSet = new Set(teacherKeys);

    console.log('[AI] Grok: Global keys count:', globalKeys.length, '| Teacher keys count:', teacherKeys.length, '| Total:', keys.length);
    if (keys.length === 0) return logProviderSkip('Grok');

    const models = ['grok-beta', 'grok-vision-beta'];
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
                        max_tokens: 1024
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const result = data.choices?.[0]?.message?.content || '';
                    console.log(`[AI] ✅ Success with Grok model: ${model}`);
                    return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || response.statusText;

                if (response.status === 429) {
                    lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada Grok model ${model}.`;
                    console.warn(`[AI] ⚠️ Grok quota exceeded for model: ${model}`);
                    if (req && req.teacherId && teacherKeysSet.has(key)) {
                        const marked = await markTeacherKeyExhausted(req.teacherId, key, `Grok ${model} 429`);
                        if (marked) {
                            exhaustedTeacherKeys.push(key);
                            console.log(`[AI] Marked Grok teacher key as exhausted for teacher ${req.teacherId}`);
                        }
                    } else if (!teacherKeysSet.has(key)) {
                        // This is a global key
                        await markGlobalKeyExhausted(key, `Grok ${model} 429`);
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
 * Helper to call Mistral AI
 */
async function callMistralAI(prompt, req) {
    // Start with global API keys
    const globalKeys = parseApiKeyList(process.env.MISTRAL_API_KEY || '');

    // Add teacher's personal API keys if available
    let teacherKeys = [];
    if (req && req.teacherId) {
        teacherKeys = await getTeacherAPIKeys(req.teacherId, req);
    }

    const keys = [...teacherKeys, ...globalKeys]; // Teacher keys first for priority
    const teacherKeysSet = new Set(teacherKeys);

    console.log('[AI] Mistral: Global keys count:', globalKeys.length, '| Teacher keys count:', teacherKeys.length, '| Total:', keys.length);
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
                        max_tokens: 1024
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
    // Start with global API keys
    const globalKeys = parseApiKeyList(process.env.COHERE_API_KEY || '');

    // Add teacher's personal API keys if available
    let teacherKeys = [];
    if (req && req.teacherId) {
        teacherKeys = await getTeacherAPIKeys(req.teacherId, req);
    }

    const keys = [...teacherKeys, ...globalKeys]; // Teacher keys first for priority
    const teacherKeysSet = new Set(teacherKeys);

    console.log('[AI] Cohere: Global keys count:', globalKeys.length, '| Teacher keys count:', teacherKeys.length, '| Total:', keys.length);
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
                        max_tokens: 1024
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
    // Start with global API keys
    const globalKeys = parseApiKeyList(process.env.TOGETHER_API_KEY || '');

    // Add teacher's personal API keys if available
    let teacherKeys = [];
    if (req && req.teacherId) {
        teacherKeys = await getTeacherAPIKeys(req.teacherId, req);
    }

    const keys = [...teacherKeys, ...globalKeys]; // Teacher keys first for priority
    const teacherKeysSet = new Set(teacherKeys);

    console.log('[AI] Together AI: Global keys count:', globalKeys.length, '| Teacher keys count:', teacherKeys.length, '| Total:', keys.length);
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
                        max_tokens: 1024
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
    // Start with global API keys
    const globalKeys = parseApiKeyList(process.env.DEEPSEEK_API_KEY || process.env.DEEP_SEEK_API_KEY || '');

    // Add teacher's personal API keys if available
    let teacherKeys = [];
    if (req && req.teacherId) {
        teacherKeys = await getTeacherAPIKeys(req.teacherId, req);
    }

    const keys = [...teacherKeys, ...globalKeys]; // Teacher keys first for priority
    const teacherKeysSet = new Set(teacherKeys);

    console.log('[AI] DeepSeek: Global keys count:', globalKeys.length, '| Teacher keys count:', teacherKeys.length, '| Total:', keys.length);
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
                        max_tokens: 1024
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const result = data.choices?.[0]?.message?.content || '';
                    console.log(`[AI] ✅ Success with DeepSeek model: ${model}`);
                    return { text: result, exhaustedKeys: exhaustedTeacherKeys };
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || response.statusText;

                if (response.status === 429) {
                    lastError = `[KUOTA HABIS / LIMIT TERCAPAI] pada DeepSeek model ${model}.`;
                    console.warn(`[AI] ⚠️ DeepSeek quota exceeded for model: ${model}`);
                    if (req && req.teacherId && teacherKeysSet.has(key)) {
                        const marked = await markTeacherKeyExhausted(req.teacherId, key, `DeepSeek ${model} 429`);
                        if (marked) {
                            exhaustedTeacherKeys.push(key);
                            console.log(`[AI] Marked DeepSeek teacher key as exhausted for teacher ${req.teacherId}`);
                        }
                    } else if (!teacherKeysSet.has(key)) {
                        // This is a global key
                        await markGlobalKeyExhausted(key, `DeepSeek ${model} 429`);
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

    let result = await tryProvider('Anthropic', () => callAnthropicAI(prompt, req));
    if (result) return result;

    result = await tryProvider('OpenAI', () => callOpenAI(prompt, req));
    if (result) return result;

    result = await tryProvider('Gemini', () => callGeminiAI(prompt, req));
    if (result) return result;

    result = await tryProvider('OpenRouter', () => callOpenRouterAI(prompt, req));
    if (result) return result;

    result = await tryProvider('Grok', () => callGrokAI(prompt, req));
    if (result) return result;

    result = await tryProvider('HuggingFace', () => callHuggingFaceAI(prompt, req));
    if (result) return result;

    result = await tryProvider('Mistral', () => callMistralAI(prompt, req));
    if (result) return result;

    result = await tryProvider('Cohere', () => callCohereAI(prompt, req));
    if (result) return result;

    result = await tryProvider('Together AI', () => callTogetherAI(prompt, req));
    if (result) return result;

    result = await tryProvider('DeepSeek', () => callDeepSeekAI(prompt, req));
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

        // Get Gemini keys from environment
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

        // Get DeepSeek keys from environment
        const deepseekRaw = process.env.DEEPSEEK_API_KEY || process.env.DEEP_SEEK_API_KEY || '';
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
            fallbackNote: 'Global key digunakan sebagai fallback jika personal key tidak tersedia atau kuota habis'
        });
    } catch (err) {
        console.error('[GET GLOBAL KEYS ERROR]:', err.message);
        res.status(500).json({ error: 'Gagal mengambil daftar global key: ' + err.message });
    }
});

app.post('/api/generate-ai', async (req, res) => {
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
        multiple: 'pilihan ganda kompleks (2-3 jawaban benar, 4 opsi)',
        text: 'isian / uraian singkat',
        tf: 'benar/salah (minimal 3 pernyataan per soal)',
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
    if (imageEnabled) {
        prompt += 'Karena opsi gambar otomatis dipilih, sertakan field "imagePrompt" yang berisi deskripsi ilustrasi singkat untuk setiap soal bergambar. Pastikan ilustrasi relevan, tidak ambigu, dan sesuai konteks materi. Jika soal tidak memerlukan gambar, berikan nilai kosong pada "imagePrompt". ';
    }
    prompt += 'Balas HANYA dengan JSON array valid tanpa markdown atau kata-kata tambahan. ';
    prompt += 'Contoh format: [{"text":"Pertanyaan?","options":["A","B","C","D"],"correct":0,"mapel":"' + mapel + '","rombel":"' + rombel + '","type":"single","imagePrompt":"Ilustrasi ..."}]. ';
    prompt += 'Untuk soal pilihan ganda kompleks gunakan tepat 4 opsi jawaban dan maksimal 3 jawaban benar, "correct" sebagai array indeks jawaban benar, contoh: {"text":"Pertanyaan?","options":["A","B","C","D"],"correct":[0,2],"mapel":"' + mapel + '","rombel":"' + rombel + '","type":"multiple","imagePrompt":"Ilustrasi ..."}. ';
    prompt += 'Untuk soal benar/salah gunakan "options" sebagai daftar pernyataan (minimal 3 pernyataan) dan "correct" sebagai array boolean dengan panjang sama seperti options, contoh: {"type":"tf","options":["Pernyataan 1","Pernyataan 2","Pernyataan 3"],"correct":[true,false,true],"imagePrompt":"Ilustrasi ..."}. ';
    prompt += 'Untuk soal menjodohkan gunakan "questions" sebagai array 5 pertanyaan, "answers" sebagai array 5 jawaban, dan "correct" sebagai array 5 string yang menunjukkan jawaban benar untuk setiap pertanyaan, contoh: {"type":"matching","questions":["Pertanyaan 1","Pertanyaan 2","Pertanyaan 3","Pertanyaan 4","Pertanyaan 5"],"answers":["Jawaban A","Jawaban B","Jawaban C","Jawaban D","Jawaban E"],"correct":["Jawaban A","Jawaban B","Jawaban C","Jawaban D","Jawaban E"]}.';

    console.log(`[/api/generate-ai] Request: mapel=${mapel}, rombel=${rombel}, jumlah=${actualJumlah}, tipe=${tipe}, opsiGambar=${opsiGambar}, imageEnabled=${imageEnabled}, typeCounts=${JSON.stringify(normalizedCounts)}, levelCounts=${JSON.stringify(levelCounts)}`);

    try {
        const aiResult = await callAI(prompt, req);
        let text = aiResult.text || '';
        const exhaustedKeys = aiResult.exhaustedKeys || [];

        // Clean up JSON response
        text = text.replace(/```json\n?|```/g, '').trim();
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) {
            console.error('[/api/generate-ai] AI returned no JSON array. Raw response:', text.substring(0, 500));
            return res.status(500).json({ error: 'AI tidak mengembalikan data soal yang valid. Coba lagi.' });
        }

        let parsed;
        try {
            // Clean up common JSON issues from AI responses
            let jsonText = match[0]
                .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
                .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');  // Quote unquoted keys

            parsed = JSON.parse(jsonText);
        } catch (jsonError) {
            console.error('[/api/generate-ai] JSON parsing failed:', jsonError.message);
            console.error('[/api/generate-ai] Attempted to parse:', match[0].substring(1200, 1300)); // Show around error position
            console.error('[/api/generate-ai] Full AI response:', text.substring(0, 2000));
            return res.status(500).json({
                error: 'AI mengembalikan JSON yang tidak valid. Coba lagi atau gunakan provider AI lain.',
                details: jsonError.message
            });
        }

        // Normalize question formats
        let normalizedQuestions = parsed.map(q => {
            const normalized = { ...q };

            // Ensure mapel and rombel are set
            if (!normalized.mapel) normalized.mapel = mapel;
            if (!normalized.rombel) normalized.rombel = rombel;

            // Normalize TF questions
            if (normalized.type === 'tf') {
                if (!Array.isArray(normalized.options)) {
                    normalized.options = [];
                }
                // Ensure at least 3 statements for TF questions
                while (normalized.options.length < 3) {
                    normalized.options.push(`Pernyataan ${normalized.options.length + 1}`);
                }
                if (!Array.isArray(normalized.correct)) {
                    // If correct is not array, try to convert or set default
                    normalized.correct = normalized.options.map(() => false);
                } else if (normalized.correct.length !== normalized.options.length) {
                    // Pad or truncate correct array to match options length
                    const correctLength = normalized.correct.length;
                    const optionsLength = normalized.options.length;
                    if (correctLength < optionsLength) {
                        normalized.correct = [...normalized.correct, ...Array(optionsLength - correctLength).fill(false)];
                    } else if (correctLength > optionsLength) {
                        normalized.correct = normalized.correct.slice(0, optionsLength);
                    }
                }
                // Ensure all correct values are boolean
                normalized.correct = normalized.correct.map(c => Boolean(c));
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

            // Normalize multiple choice questions
            if (normalized.type === 'multiple') {
                if (!Array.isArray(normalized.options)) {
                    normalized.options = [];
                }
                // Ensure exactly 4 options for multiple choice
                if (normalized.options.length < 4) {
                    while (normalized.options.length < 4) {
                        normalized.options.push(`Opsi ${String.fromCharCode(65 + normalized.options.length)}`);
                    }
                } else if (normalized.options.length > 4) {
                    normalized.options = normalized.options.slice(0, 4);
                }
                if (!Array.isArray(normalized.correct)) {
                    // If correct is not array, try to convert single number to array
                    if (typeof normalized.correct === 'number') {
                        normalized.correct = [normalized.correct];
                    } else {
                        normalized.correct = [];
                    }
                }
                // Ensure all correct values are numbers and within options range (0-3)
                normalized.correct = normalized.correct
                    .filter(c => typeof c === 'number' && c >= 0 && c < 4)
                    .map(c => Math.floor(c));
                // Remove duplicates
                normalized.correct = [...new Set(normalized.correct)];
                // Limit to max 3 correct answers
                if (normalized.correct.length > 3) {
                    normalized.correct = normalized.correct.slice(0, 3);
                }
                // If only one correct answer, change to single
                if (normalized.correct.length === 1) {
                    normalized.type = 'single';
                    normalized.correct = normalized.correct[0];
                } else if (normalized.correct.length === 0) {
                    // If no correct answers, mark as invalid
                    normalized.invalid = true;
                }
            }

            // Normalize single choice questions
            if (normalized.type === 'single') {
                if (Array.isArray(normalized.correct)) {
                    if (normalized.correct.length > 1) {
                        // If multiple correct in single, change to multiple
                        normalized.type = 'multiple';
                    } else if (normalized.correct.length === 1) {
                        normalized.correct = normalized.correct[0];
                    } else {
                        normalized.correct = 0; // default
                    }
                }
                if (typeof normalized.correct !== 'number' || normalized.correct < 0 || normalized.correct >= (normalized.options?.length || 4)) {
                    normalized.correct = 0;
                }
            }

            // If type is single but correct is array, change to multiple
            if (normalized.type === 'single' && Array.isArray(normalized.correct)) {
                normalized.type = 'multiple';
            }

            // Ensure other required fields
            if (!normalized.images) normalized.images = [];
            if (!normalized.text) normalized.text = '';
            return normalizeQuestionCorrect(normalized);
        }).filter(q => {
            // For matching questions, check for questions/answers; for others, check for text
            if (q.type === 'matching') {
                return !q.invalid && Array.isArray(q.questions) && q.questions.length > 0;
            }
            return !q.invalid && q.text && q.text.trim();
        });

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
        promptText = `Buatkan instrumen Soal dan Kunci Jawaban untuk mata pelajaran ${mapel} fase ${fase} ${topicHint}. Rincian jumlah dan bentuk soal yang diharapkan adalah: ${extraData?.jumlahPerBentuk || '5 soal Pilihan Ganda'}. Usahakan tipe soal HOTS (Higher Order Thinking Skills). Berikan juga pembahasan singkat untuk masing-masing soal.`;
        promptText += `\nUntuk soal uraian tipe text, buatlah kunci jawaban yang sangat singkat: hanya 1 kalimat padat dan jelas, maksimal 5 kata.`;

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
        if (extraData?.simpanBank) {
            const match = text.match(/<script id="ai-json-data"[^>]*>([\s\S]*?)<\/script>/i);
            if (match && match[1]) {
                try {
                    parsedQuestions = JSON.parse(match[1].trim());
                    // Tambahkan ke database
                    const db = (await readDB()) || { questions: [] };
                    if (!db.questions) db.questions = [];
                    // Inject basic standard properties
                    parsedQuestions = parsedQuestions.map(q => normalizeQuestionCorrect({
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

        // Clean up JSON response
        text = text.replace(/```json\n?|```/g, '').trim();
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) return res.status(500).json({ error: 'No JSON array in AI response' });

        const parsed = JSON.parse(match[0]);
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
