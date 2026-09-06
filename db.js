/**
 * db.js — Modul database Supabase untuk CBT Online
 * Semua operasi database menggunakan Supabase sebagai backend tunggal.
 * Data pokok (Soal, Siswa, Pengaturan, Jadwal) disimpan terpusat di cbt_database.
 * Hasil Ujian, Checkpoint Live, Logs, dan Grades disimpan di tabel terpisah demi performa.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

let _supabase = null;

function getSupabase() {
    if (_supabase) return _supabase;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
        throw new Error('SUPABASE_URL dan SUPABASE_KEY belum dikonfigurasi di env/Vercel');
    }
    _supabase = createClient(url, key);
    return _supabase;
}

const enc = v => JSON.stringify(v);
const dec = v => { try { return (typeof v === 'string') ? JSON.parse(v) : v; } catch { return v; } };

// Cache in-memory berdurasi pendek (2 detik) untuk mereduksi redundant SELECTs
let localCache = null;
let cacheTime = 0;

async function getFullDbFromSupabase() {
    const now = Date.now();
    if (localCache && (now - cacheTime < 2000)) {
        return localCache;
    }
    const sb = getSupabase();
    const { data, error } = await sb.from('cbt_database').select('data').eq('id', 1).maybeSingle();
    if (error) {
        console.error('[Supabase] getFullDbFromSupabase error:', error.message);
        throw error;
    }
    const dbObj = data?.data || {
        subjects: [],
        rombels: [],
        students: [],
        questions: [],
        schedules: [],
        timeLimits: {},
        jenisUjian: {},
        quizzes: [],
        schoolSettings: {},
        live_quizz_rooms: [],
        live_quizz_participants: []
    };
    localCache = dbObj;
    cacheTime = now;
    return dbObj;
}

async function saveFullDbToSupabase(dbObj) {
    const sb = getSupabase();
    localCache = dbObj;
    cacheTime = Date.now();
    const { error } = await sb.from('cbt_database').upsert({ id: 1, data: dbObj, updated_at: new Date() });
    if (error) {
        console.error('[Supabase] saveFullDbToSupabase error:', error.message);
        throw error;
    }
}

// ─── Config Helper ───
async function getConfig(key) {
    const db = await getFullDbFromSupabase();
    return db[key] !== undefined ? db[key] : null;
}

async function setConfig(key, value) {
    const db = await getFullDbFromSupabase();
    db[key] = value;
    await saveFullDbToSupabase(db);
}

// ─── Subject / Rombel / Settings ─────────────────────────────────────────────
async function getSubjects() { return (await getConfig('subjects')) || []; }
async function setSubjects(v) { return setConfig('subjects', v); }
async function getRombels() { return (await getConfig('rombels')) || []; }
async function setRombels(v) { return setConfig('rombels', v); }
async function getTimeLimits() { return (await getConfig('timeLimits')) || {}; }
async function setTimeLimits(v) { return setConfig('timeLimits', v); }
async function getJenisUjian() { return (await getConfig('jenisUjian')) || {}; }
async function setJenisUjian(v) { return setConfig('jenisUjian', v); }
async function getSchoolSettings() { return (await getConfig('school_settings')) || {}; }
async function setSchoolSettings(v) { return setConfig('school_settings', v); }

// ─── Questions ────────────────────────────────────────────────────────────────
async function getAllQuestions() {
    const db = await getFullDbFromSupabase();
    return db.questions || [];
}

async function getQuestions(options = {}) {
    const all = await getAllQuestions();
    let filtered = all;
    if (options.mapel) {
        const m = String(options.mapel).toLowerCase().trim();
        filtered = filtered.filter(q => String(q.mapel).toLowerCase().trim() === m);
    }
    if (options.rombel) {
        const r = String(options.rombel).toLowerCase().trim();
        filtered = filtered.filter(q => String(q.rombel).toLowerCase().trim() === r);
    }
    const offset = Number(options.offset) || 0;
    const limit = (options.limit !== undefined && Number(options.limit) !== -1) ? Number(options.limit) : 1000;
    return filtered.slice(offset, offset + limit);
}

async function getQuestionsCount(options = {}) {
    const filtered = await getQuestions({ ...options, limit: -1, offset: 0 });
    return filtered.length;
}

async function setAllQuestions(questions) {
    const db = await getFullDbFromSupabase();
    db.questions = questions || [];
    await saveFullDbToSupabase(db);
}

async function addQuestion(q) {
    const db = await getFullDbFromSupabase();
    if (!db.questions) db.questions = [];
    const newId = db.questions.length ? Math.max(...db.questions.map(x => x.id || 0)) + 1 : 1;
    const newQuestion = { ...q, id: newId };
    db.questions.push(newQuestion);
    await saveFullDbToSupabase(db);
    return newId;
}

async function updateQuestion(index0Based, q) {
    const db = await getFullDbFromSupabase();
    if (!db.questions || index0Based < 0 || index0Based >= db.questions.length) return false;
    db.questions[index0Based] = { ...db.questions[index0Based], ...q };
    await saveFullDbToSupabase(db);
    return true;
}

async function deleteQuestion(index0Based) {
    const db = await getFullDbFromSupabase();
    if (!db.questions || index0Based < 0 || index0Based >= db.questions.length) return false;
    db.questions.splice(index0Based, 1);
    await saveFullDbToSupabase(db);
    return true;
}

// ─── Students ─────────────────────────────────────────────────────────────────
async function getAllStudents() {
    const db = await getFullDbFromSupabase();
    return db.students || [];
}

async function setAllStudents(students) {
    const db = await getFullDbFromSupabase();
    db.students = students || [];
    await saveFullDbToSupabase(db);
}

async function getStudentById(id) {
    const all = await getAllStudents();
    const norm = String(id || '').trim().toLowerCase();
    return all.find(s => String(s.id || '').trim().toLowerCase() === norm) || null;
}

async function upsertStudent(s) {
    const db = await getFullDbFromSupabase();
    if (!db.students) db.students = [];
    const normId = String(s.id || '').trim().toLowerCase();
    const idx = db.students.findIndex(x => String(x.id || '').trim().toLowerCase() === normId);
    if (idx !== -1) {
        db.students[idx] = { ...db.students[idx], ...s };
    } else {
        db.students.push(s);
    }
    await saveFullDbToSupabase(db);
}

async function deleteStudent(id) {
    const db = await getFullDbFromSupabase();
    if (!db.students) return;
    const normId = String(id || '').trim().toLowerCase();
    db.students = db.students.filter(x => String(x.id || '').trim().toLowerCase() !== normId);
    await saveFullDbToSupabase(db);
}

// ─── Schedules ────────────────────────────────────────────────────────────────
async function getAllSchedules() {
    const db = await getFullDbFromSupabase();
    return db.schedules || [];
}

async function setAllSchedules(schedules) {
    const db = await getFullDbFromSupabase();
    db.schedules = schedules || [];
    await saveFullDbToSupabase(db);
}

// ─── Quizzes ──────────────────────────────────────────────────────────────────
async function getAllQuizzes() {
    const db = await getFullDbFromSupabase();
    return db.quizzes || [];
}

async function setAllQuizzes(quizzes) {
    const db = await getFullDbFromSupabase();
    db.quizzes = quizzes || [];
    await saveFullDbToSupabase(db);
}

// ─── Results ──────────────────────────────────────────────────────────────────
async function getAllResults() {
    const sb = getSupabase();
    const { data, error } = await sb.from('cbt_results').select('data').order('created_at', { ascending: false });
    if (error) throw new Error('getAllResults error: ' + error.message);
    return (data || []).map(r => dec(r.data));
}

async function getResults(options = {}) {
    const sb = getSupabase();
    let query = sb.from('cbt_results').select('data');
    if (options.studentId) query = query.eq('student_id', options.studentId);
    if (options.mapel) query = query.ilike('mapel', `%${options.mapel}%`);
    if (options.rombel) query = query.eq('rombel', options.rombel);
    query = query.order('created_at', { ascending: false });
    const limit = (options.limit !== undefined && options.limit !== -1) ? Number(options.limit) : 10000;
    const offset = Number(options.offset) || 0;
    query = query.range(offset, offset + limit - 1);
    const { data, error } = await query;
    if (error) throw new Error('getResults error: ' + error.message);
    return (data || []).map(r => dec(r.data));
}

async function getResultsCount(options = {}) {
    const sb = getSupabase();
    let query = sb.from('cbt_results').select('id', { count: 'exact', head: true });
    if (options.studentId) query = query.eq('student_id', options.studentId);
    if (options.mapel) query = query.ilike('mapel', `%${options.mapel}%`);
    if (options.rombel) query = query.eq('rombel', options.rombel);
    const { count, error } = await query;
    if (error) throw new Error('getResultsCount error: ' + error.message);
    return count || 0;
}

async function upsertResult(r) {
    const sb = getSupabase();
    const scoreVal = typeof r.score === 'string' ? parseFloat(r.score) : (r.score || 0);
    const dateVal = r.date || new Date().toISOString();
    const record = {
        student_id: r.studentId || '',
        mapel: r.mapel || '',
        rombel: r.rombel || '',
        date: dateVal,
        score: scoreVal,
        data: enc(r),
        created_at: dateVal
    };
    const { data: existing } = await sb.from('cbt_results').select('id')
        .match({ student_id: record.student_id, mapel: record.mapel, rombel: record.rombel, date: record.date })
        .maybeSingle();
    if (existing) {
        const { error } = await sb.from('cbt_results').update({ score: record.score, data: record.data }).eq('id', existing.id);
        if (error) throw new Error('upsertResult update error: ' + error.message);
    } else {
        const { error } = await sb.from('cbt_results').insert(record);
        if (error) throw new Error('upsertResult insert error: ' + error.message);
    }
}

async function deleteResult(studentId, mapel, rombel, date) {
    const sb = getSupabase();
    const { error } = await sb.from('cbt_results').delete()
        .match({ student_id: studentId, mapel, rombel, date });
    if (error) throw new Error('deleteResult error: ' + error.message);
}

async function setAllResults(resultsArr) {
    const toDelete = resultsArr.filter(r => r.deleted === true);
    const active = resultsArr.filter(r => r.deleted !== true);
    for (const r of toDelete) {
        await deleteResult(r.studentId || '', r.mapel || '', r.rombel || '', r.date || '');
    }
    for (const r of active) {
        await upsertResult(r);
    }
}

async function mergeResults(inc = []) {
    for (const r of inc) {
        if (r.deleted) await deleteResult(r.studentId || '', r.mapel || '', r.rombel || '', r.date || '');
        else await upsertResult(r);
    }
}

// ─── Live Exams ───────────────────────────────────────────────────────────────
function normalizeTimestamp(value) {
    if (!value && value !== 0) return new Date().toISOString();
    if (typeof value === 'number') {
        return new Date(value).toISOString();
    }
    const trimmed = String(value).trim();
    if (/^\d+$/.test(trimmed)) {
        let ms = Number(trimmed);
        if (trimmed.length === 10) ms *= 1000;
        return new Date(ms).toISOString();
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
        return new Date(parsed).toISOString();
    }
    return new Date().toISOString();
}

async function getAllLiveExams() {
    const sb = getSupabase();
    const { data, error } = await sb.from('cbt_live_exams').select('data');
    if (error) throw new Error('getAllLiveExams error: ' + error.message);
    return (data || []).map(r => dec(r.data));
}

async function upsertLiveExam(exam) {
    const sb = getSupabase();
    const sid = String(exam.studentId || '').trim().toLowerCase();
    const map = String(exam.mapel || '').trim().toLowerCase();
    const rom = String(exam.rombel || '').trim().toLowerCase();
    const { data: existing } = await sb.from('cbt_live_exams').select('id')
        .match({ student_id: sid, mapel: map, rombel: rom }).maybeSingle();
    const record = {
        student_id: exam.studentId || '',
        mapel: exam.mapel || '',
        rombel: exam.rombel || '',
        updated_at: normalizeTimestamp(exam.updatedAt),
        data: enc(exam)
    };
    if (existing) {
        const { error } = await sb.from('cbt_live_exams').update(record).eq('id', existing.id);
        if (error) throw new Error('upsertLiveExam update error: ' + error.message);
    } else {
        const { error } = await sb.from('cbt_live_exams').insert(record);
        if (error) throw new Error('upsertLiveExam insert error: ' + error.message);
    }
}

async function clearCheckpointDirectly(sid, map, rom) {
    const sb = getSupabase();
    const nid = String(sid || '').trim().toLowerCase();
    const nmp = String(map || '').trim().toLowerCase();
    const nrb = String(rom || '').trim().toLowerCase();
    const { data: rows, error: fetchErr } = await sb.from('cbt_live_exams').select('id, data')
        .match({ student_id: nid, mapel: nmp, rombel: nrb });
    if (fetchErr) throw new Error('clearCheckpointDirectly error: ' + fetchErr.message);
    for (const row of (rows || [])) {
        const d = dec(row.data);
        if (d.adminSavedProgress) {
            d.adminSavedProgress = null;
            d.adminSaveConfirmed = false;
            d.savedByAdminCommand = false;
            await sb.from('cbt_live_exams').update({ data: enc(d) }).eq('id', row.id);
        }
    }
}

async function setAllLiveExams(exams) {
    const sb = getSupabase();
    const { error: delErr } = await sb.from('cbt_live_exams').delete().neq('id', 0);
    if (delErr) throw new Error('setAllLiveExams delete error: ' + delErr.message);
    if (!exams || exams.length === 0) return;
    const rows = exams.map(e => ({
        student_id: e.studentId || '',
        mapel: e.mapel || '',
        rombel: e.rombel || '',
        updated_at: normalizeTimestamp(e.updatedAt),
        data: enc(e)
    }));
    const { error } = await sb.from('cbt_live_exams').insert(rows);
    if (error) throw new Error('setAllLiveExams insert error: ' + error.message);
}

// ─── Live Quizz Participants ──────────────────────────────────────────────────
async function upsertQuizzParticipant(p) {
    const db = await getFullDbFromSupabase();
    if (!db.live_quizz_participants) db.live_quizz_participants = [];
    const now = Date.now();
    const idx = db.live_quizz_participants.findIndex(x => x.studentId === p.studentId && x.mapel === p.mapel && x.rombel === p.rombel);
    const record = {
        studentId: p.studentId,
        studentName: p.studentName,
        mapel: p.mapel,
        rombel: p.rombel,
        lastPing: now,
        status: p.status || 'waiting',
        score: p.score || 0,
        question_answered: p.question_answered || 0
    };
    if (idx !== -1) {
        db.live_quizz_participants[idx] = { ...db.live_quizz_participants[idx], ...record, score: db.live_quizz_participants[idx].score || record.score };
    } else {
        db.live_quizz_participants.push(record);
    }
    await saveFullDbToSupabase(db);
}

async function getQuizzParticipants(mapel, rombel) {
    const db = await getFullDbFromSupabase();
    if (!db.live_quizz_participants) db.live_quizz_participants = [];
    const staleTime = Date.now() - 30000;
    // delete stale
    db.live_quizz_participants = db.live_quizz_participants.filter(p => p.lastPing >= staleTime);
    await saveFullDbToSupabase(db);

    const m = String(mapel).toLowerCase().trim();
    const r = String(rombel).toLowerCase().trim();
    return db.live_quizz_participants.filter(p => String(p.mapel).toLowerCase().trim() === m && String(p.rombel).toLowerCase().trim() === r)
        .map(p => ({
            student_id: p.studentId,
            student_name: p.studentName,
            status: p.status,
            score: p.score
        }));
}

async function setQuizzStatus(mapel, rombel, status) {
    const db = await getFullDbFromSupabase();
    if (!db.live_quizz_participants) db.live_quizz_participants = [];
    const m = String(mapel).toLowerCase().trim();
    const r = String(rombel).toLowerCase().trim();
    db.live_quizz_participants.forEach(p => {
        if (String(p.mapel).toLowerCase().trim() === m && String(p.rombel).toLowerCase().trim() === r) {
            p.status = status;
            if (status === 'start') p.score = 0;
        }
    });
    await saveFullDbToSupabase(db);
}

async function updateQuizzScore(studentId, mapel, rombel, score) {
    const db = await getFullDbFromSupabase();
    if (!db.live_quizz_participants) db.live_quizz_participants = [];
    const sid = String(studentId).toLowerCase().trim();
    const m = String(mapel).toLowerCase().trim();
    const r = String(rombel).toLowerCase().trim();
    const p = db.live_quizz_participants.find(x => String(x.studentId).toLowerCase().trim() === sid && String(x.mapel).toLowerCase().trim() === m && String(x.rombel).toLowerCase().trim() === r);
    if (p) {
        p.score = score;
        p.lastPing = Date.now();
        p.question_answered = 1;
        await saveFullDbToSupabase(db);
    }
}

async function markQuizzAnswered(studentId, mapel, rombel) {
    const db = await getFullDbFromSupabase();
    if (!db.live_quizz_participants) db.live_quizz_participants = [];
    const sid = String(studentId).toLowerCase().trim();
    const m = String(mapel).toLowerCase().trim();
    const r = String(rombel).toLowerCase().trim();
    const p = db.live_quizz_participants.find(x => String(x.studentId).toLowerCase().trim() === sid && String(x.mapel).toLowerCase().trim() === m && String(x.rombel).toLowerCase().trim() === r);
    if (p) {
        p.question_answered = 1;
        p.lastPing = Date.now();
        await saveFullDbToSupabase(db);
    }
}

async function resetQuizzAnswered(mapel, rombel) {
    const db = await getFullDbFromSupabase();
    if (!db.live_quizz_participants) db.live_quizz_participants = [];
    const m = String(mapel).toLowerCase().trim();
    const r = String(rombel).toLowerCase().trim();
    db.live_quizz_participants.forEach(p => {
        if (String(p.mapel).toLowerCase().trim() === m && String(p.rombel).toLowerCase().trim() === r) {
            p.question_answered = 0;
        }
    });
    await saveFullDbToSupabase(db);
}

async function checkAllAnswered(mapel, rombel) {
    const db = await getFullDbFromSupabase();
    if (!db.live_quizz_participants) return false;
    const m = String(mapel).toLowerCase().trim();
    const r = String(rombel).toLowerCase().trim();
    const participants = db.live_quizz_participants.filter(p => String(p.mapel).toLowerCase().trim() === m && String(p.rombel).toLowerCase().trim() === r);
    if (participants.length === 0) return false;
    const allAnswered = participants.every(p => p.question_answered === 1);
    console.log(`[DB_CHECK_ALL] mapel=${mapel} rombel=${rombel}: total=${participants.length}, allAnswered=${allAnswered}`);
    return allAnswered;
}

async function resetQuizzParticipants(mapel, rombel) {
    const db = await getFullDbFromSupabase();
    const m = String(mapel).toLowerCase().trim();
    const r = String(rombel).toLowerCase().trim();
    if (db.live_quizz_participants) {
        db.live_quizz_participants = db.live_quizz_participants.filter(p => !(String(p.mapel).toLowerCase().trim() === m && String(p.rombel).toLowerCase().trim() === r));
    }
    if (db.live_quizz_rooms) {
        db.live_quizz_rooms = db.live_quizz_rooms.filter(x => !(String(x.mapel).toLowerCase().trim() === m && String(x.rombel).toLowerCase().trim() === r));
    }
    await saveFullDbToSupabase(db);
}

async function upsertQuizzRoom(mapel, rombel, status, currentIndex, startTime) {
    const db = await getFullDbFromSupabase();
    if (!db.live_quizz_rooms) db.live_quizz_rooms = [];
    const m = String(mapel).toLowerCase().trim();
    const r = String(rombel).toLowerCase().trim();
    const record = { mapel, rombel, status, current_index: currentIndex, start_time: startTime };
    const idx = db.live_quizz_rooms.findIndex(x => String(x.mapel).toLowerCase().trim() === m && String(x.rombel).toLowerCase().trim() === r);
    if (idx !== -1) {
        db.live_quizz_rooms[idx] = { ...db.live_quizz_rooms[idx], ...record };
    } else {
        db.live_quizz_rooms.push(record);
    }
    await saveFullDbToSupabase(db);
}

async function getQuizzRoom(mapel, rombel) {
    const db = await getFullDbFromSupabase();
    if (!db.live_quizz_rooms) return null;
    const m = String(mapel).toLowerCase().trim();
    const r = String(rombel).toLowerCase().trim();
    const room = db.live_quizz_rooms.find(x => String(x.mapel).toLowerCase().trim() === m && String(x.rombel).toLowerCase().trim() === r);
    return room ? {
        mapel: room.mapel,
        rombel: room.rombel,
        status: room.status,
        current_index: room.current_index,
        start_time: room.start_time
    } : null;
}

// ─── User Logs / Activity Logs ───────────────────────────────────────────────
async function addLog(userId, userName, role, activity) {
    const sb = getSupabase();
    const { error } = await sb.from('activity_logs').insert({ user_id: userId, user_name: userName, role, activity });
    if (error) console.error('[DB] addLog error:', error.message);
}

async function getLogs(limit = 20) {
    const sb = getSupabase();
    const { data, error } = await sb.from('activity_logs').select('*')
        .order('created_at', { ascending: false }).limit(limit);
    if (error) throw new Error('getLogs error: ' + error.message);
    return data || [];
}

async function clearLogs() {
    const sb = getSupabase();
    const { error } = await sb.from('activity_logs').delete().neq('id', 0);
    if (error) throw new Error('clearLogs error: ' + error.message);
}

// ─── Grades ───────────────────────────────────────────────────────────────────
async function getGrades(mapel, rombel) {
    const sb = getSupabase();
    let query = sb.from('grades').select('*');
    if (mapel) query = query.eq('mapel', mapel);
    if (rombel) query = query.eq('rombel', rombel);
    const { data, error } = await query;
    if (error) throw new Error('getGrades error: ' + error.message);
    return data || [];
}

async function upsertGrade(g) {
    if (!g) return;
    const sb = getSupabase();
    const record = {
        student_id: g.student_id || g.studentId,
        mapel: g.mapel, rombel: g.rombel,
        u1: g.u1 || 0, u2: g.u2 || 0, u3: g.u3 || 0,
        t1: g.t1 || 0, t2: g.t2 || 0, t3: g.t3 || 0,
        kelas: g.kelas || 0, uas: g.uas || 0,
        nilai_akhir: g.nilai_akhir || g.nilaiAkhir || 0,
        data: enc(g.data || {})
    };
    const { data: existing } = await sb.from('grades').select('student_id')
        .match({ student_id: record.student_id, mapel: record.mapel, rombel: record.rombel }).maybeSingle();
    if (existing) {
        const { error } = await sb.from('grades').update(record)
            .match({ student_id: record.student_id, mapel: record.mapel, rombel: record.rombel });
        if (error) throw new Error('upsertGrade update error: ' + error.message);
    } else {
        const { error } = await sb.from('grades').insert(record);
        if (error) throw new Error('upsertGrade insert error: ' + error.message);
    }
}

// ─── readDB / writeDB ─────────────────────────────────────────────────────────
async function readDB(loadAll = true) {
    const dbObj = await getFullDbFromSupabase();
    if (loadAll) {
        dbObj.results = await getAllResults();
    }
    return dbObj;
}

async function writeDB(obj) {
    await saveFullDbToSupabase(obj);
}

function getDbPath() {
    return `supabase://${process.env.SUPABASE_URL || 'not-configured'}`;
}

function getDb() { return getSupabase(); }
function closeDb() { /* no-op for Supabase */ }
function getUsersDb() { return getSupabase(); }
function getQuestionsDb() { return getSupabase(); }
function getResultsDb() { return getSupabase(); }

module.exports = {
    getDb, getDbPath, closeDb,
    getUsersDb, getQuestionsDb, getResultsDb,
    getConfig, setConfig,
    getSubjects, setSubjects, getRombels, setRombels, getTimeLimits, setTimeLimits, getJenisUjian, setJenisUjian,
    getSchoolSettings, setSchoolSettings,
    getAllQuestions, setAllQuestions, addQuestion, updateQuestion, deleteQuestion, getQuestions, getQuestionsCount,
    getAllStudents, setAllStudents, getStudentById, upsertStudent, deleteStudent,
    getAllSchedules, setAllSchedules,
    getAllQuizzes, setAllQuizzes,
    getAllResults, upsertResult, deleteResult, setAllResults, mergeResults, getResults, getResultsCount,
    getAllLiveExams, upsertLiveExam, setAllLiveExams, clearCheckpointDirectly,
    addLog, getLogs, clearLogs,
    upsertQuizzParticipant, getQuizzParticipants, setQuizzStatus, resetQuizzParticipants,
    updateQuizzScore, markQuizzAnswered, resetQuizzAnswered, checkAllAnswered,
    upsertQuizzRoom, getQuizzRoom,
    getGrades, upsertGrade,
    readDB, writeDB
};
