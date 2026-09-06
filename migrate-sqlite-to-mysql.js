#!/usr/bin/env node
/*
 * migrate-sqlite-to-mysql.js
 * Read data from a local SQLite `cbt_data.db` (or `cbt_data_rescued.json`) and write into MySQL
 * Usage:
 *   node migrate-sqlite-to-mysql.js        # attempt migration (requires better-sqlite3)
 *   node migrate-sqlite-to-mysql.js --dry  # show counts but don't write
 */

const fs = require('fs');
const path = require('path');
const sqlDb = require('./db');

const SQLITE_FILE = path.join(__dirname, 'cbt_data.db');
const RESCUE_JSON = path.join(__dirname, 'cbt_data_rescued.json');

const dec = v => { try { return JSON.parse(v); } catch { return v; } };

function collectFromSqlite(db) {
    const out = {
        subjects: [], rombels: [], questions: [], students: [], schedules: [], timeLimits: {}, quizzes: [], results: []
    };

    const dec = v => { try { return JSON.parse(v); } catch { return v; } };

    try {
        const cfgRows = db.prepare('SELECT `key`, value FROM config').all();
        for (const r of cfgRows) {
            if (r.key === 'subjects') out.subjects = dec(r.value) || [];
            if (r.key === 'rombels') out.rombels = dec(r.value) || [];
            if (r.key === 'timeLimits') out.timeLimits = dec(r.value) || {};
        }
    } catch (e) {}

    try {
        const qs = db.prepare('SELECT data FROM questions').all();
        for (const r of qs) out.questions.push(dec(r.data));
    } catch (e) {}

    try {
        const ss = db.prepare('SELECT data FROM students').all();
        for (const r of ss) out.students.push(dec(r.data));
    } catch (e) {}

    try {
        const sch = db.prepare('SELECT data FROM schedules').all();
        for (const r of sch) out.schedules.push(dec(r.data));
    } catch (e) {}

    try {
        const qz = db.prepare('SELECT data FROM quizzes').all();
        for (const r of qz) out.quizzes.push(dec(r.data));
    } catch (e) {}

    try {
        const rs = db.prepare('SELECT data FROM results').all();
        for (const r of rs) out.results.push(dec(r.data));
    } catch (e) {}

    return out;
}

async function main() {
    const dry = process.argv.includes('--dry');
    let source = {
        subjects: [], rombels: [], questions: [], students: [], schedules: [], timeLimits: {}, quizzes: [], results: []
    };
    let foundAny = false;

    const SQLITE_CANDIDATES = [
        path.join(__dirname, 'cbt_data.db'),
        path.join(__dirname, 'cbt_data.db.migrated_backup')
    ];

    const SQLITE_SEPARATE = {
        questions: path.join(__dirname, 'cbt_questions.db'),
        results: path.join(__dirname, 'cbt_results.db'),
        users: path.join(__dirname, 'cbt_users.db')
    };

    try {
        const Better = require('better-sqlite3');
        
        // Cek file tunggal
        for (const file of SQLITE_CANDIDATES) {
            if (fs.existsSync(file)) {
                console.log('📥 Found', file, '- opening with better-sqlite3');
                const sdb = new Better(file, { readonly: true });
                const data = collectFromSqlite(sdb);
                // Merge data
                if (data.questions.length > source.questions.length) source.questions = data.questions;
                if (data.students.length > source.students.length) source.students = data.students;
                if (data.results.length > source.results.length) source.results = data.results;
                if (data.subjects.length > 0) source.subjects = data.subjects;
                if (data.rombels.length > 0) source.rombels = data.rombels;
                if (Object.keys(data.timeLimits).length > 0) source.timeLimits = data.timeLimits;
                foundAny = true;
                sdb.close();
            }
        }

        // Cek file terpisah
        if (fs.existsSync(SQLITE_SEPARATE.users)) {
            console.log('📥 Found users db:', SQLITE_SEPARATE.users);
            const udb = new Better(SQLITE_SEPARATE.users, { readonly: true });
            const data = collectFromSqlite(udb);
            if (data.students.length > source.students.length) source.students = data.students;
            if (data.subjects.length > 0) source.subjects = data.subjects;
            if (data.rombels.length > 0) source.rombels = data.rombels;
            foundAny = true;
            udb.close();
        }

        if (fs.existsSync(SQLITE_SEPARATE.questions)) {
            console.log('📥 Found questions db:', SQLITE_SEPARATE.questions);
            const qdb = new Better(SQLITE_SEPARATE.questions, { readonly: true });
            const data = collectFromSqlite(qdb);
            if (data.questions.length > source.questions.length) source.questions = data.questions;
            foundAny = true;
            qdb.close();
        }

        if (fs.existsSync(SQLITE_SEPARATE.results)) {
            console.log('📥 Found results db:', SQLITE_SEPARATE.results);
            const rdb = new Better(SQLITE_SEPARATE.results, { readonly: true });
            const data = collectFromSqlite(rdb);
            if (data.results.length > source.results.length) source.results = data.results;
            foundAny = true;
            rdb.close();
        }

    } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
            console.warn('⚠️  better-sqlite3 not found. Please install it with: npm install better-sqlite3');
        } else {
            console.warn('⚠️  Error reading SQLite:', e.message);
        }
    }

    if (!foundAny && fs.existsSync(RESCUE_JSON)) {
        console.log('📥 Found', RESCUE_JSON, '- loading JSON');
        try { source = JSON.parse(fs.readFileSync(RESCUE_JSON, 'utf8')); foundAny = true; } catch (e) { console.error('Failed to parse rescue JSON:', e.message); }
    }

    if (!foundAny) {
        console.error('❌ No SQLite file or rescue JSON found.');
        process.exit(1);
    }

    console.log('\nSummary before import:');
    console.log(`  Subjects : ${ (source.subjects || []).length }`);
    console.log(`  Rombels  : ${ (source.rombels || []).length }`);
    console.log(`  Questions: ${ (source.questions || []).length }`);
    console.log(`  Students : ${ (source.students || []).length }`);
    console.log(`  Schedules: ${ (source.schedules || []).length }`);
    console.log(`  Quizzes  : ${ (source.quizzes || []).length }`);
    console.log(`  Results  : ${ (source.results || []).length }`);

    if (dry) { console.log('\nDry run complete. No changes written.'); process.exit(0); }

    try {
        console.log('\n⚙️  Writing data into MySQL table by table...');
        
        if (source.subjects.length > 0) { console.log('   - Writing subjects...'); sqlDb.setSubjects(source.subjects); }
        if (source.rombels.length > 0) { console.log('   - Writing rombels...'); sqlDb.setRombels(source.rombels); }
        if (source.timeLimits) { console.log('   - Writing timeLimits...'); sqlDb.setTimeLimits(source.timeLimits); }
        
        if (source.students.length > 0) { console.log('   - Writing students...'); sqlDb.setAllStudents(source.students); }
        if (source.questions.length > 0) { console.log('   - Writing questions...'); sqlDb.setAllQuestions(source.questions); }
        if (source.results.length > 0) { console.log('   - Writing results...'); sqlDb.setAllResults(source.results); }
        if (source.schedules.length > 0) { console.log('   - Writing schedules...'); sqlDb.setAllSchedules(source.schedules); }
        if (source.quizzes.length > 0) { console.log('   - Writing quizzes...'); sqlDb.setAllQuizzes(source.quizzes); }

        sqlDb.setConfig('migrated_from_sqlite', true);
        console.log('✅ Migration completed — data written to MySQL.');
    } catch (e) {
        console.error('❌ Migration failed:', e && e.message ? e.message : e);
        process.exit(2);
    } finally {
        try { sqlDb.closeDb(); } catch (e) {}
    }
}

main();
