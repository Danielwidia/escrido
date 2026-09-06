/**
 * migrate-to-sql.js — Migrasi data dari JSON ke SQLite
 *
 * Jalankan sekali saja:
 *   node migrate-to-sql.js
 *
 * Script ini akan membaca database.json, results.json, dan live-exams.json
 * lalu memasukkan semua data ke cbt_data.db (SQLite).
 *
 * File JSON asli TIDAK akan dihapus (sebagai backup).
 */

'use strict';

const path  = require('path');
const fs    = require('fs');

const DB_DIR = __dirname;

// Muat db.js
const db = require('./db');

const LOCAL_DATA       = path.join(DB_DIR, 'database.json');
const LOCAL_RESULTS    = path.join(DB_DIR, 'results.json');
const LOCAL_LIVE_EXAMS = path.join(DB_DIR, 'live-exams.json');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║        MIGRASI DATABASE JSON → SQLITE (cbt_data.db)     ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');

// ─── 1. Baca database.json ────────────────────────────────────────────────────
let mainDb = null;
if (fs.existsSync(LOCAL_DATA)) {
    console.log(`📂 Membaca database.json (${(fs.statSync(LOCAL_DATA).size / 1024).toFixed(0)} KB)...`);
    try {
        mainDb = JSON.parse(fs.readFileSync(LOCAL_DATA, 'utf8'));
        console.log('   ✅ Berhasil dibaca');
    } catch (e) {
        console.error('   ❌ Gagal membaca database.json:', e.message);
        process.exit(1);
    }
} else {
    console.warn('   ⚠️  database.json tidak ditemukan, melewati...');
}

// ─── 2. Baca results.json ─────────────────────────────────────────────────────
let results = [];
if (fs.existsSync(LOCAL_RESULTS)) {
    console.log(`📂 Membaca results.json (${(fs.statSync(LOCAL_RESULTS).size / 1024 / 1024).toFixed(1)} MB)...`);
    try {
        const raw = JSON.parse(fs.readFileSync(LOCAL_RESULTS, 'utf8'));
        results = Array.isArray(raw) ? raw : [];
        console.log(`   ✅ ${results.length} data hasil ujian ditemukan`);
    } catch (e) {
        console.error('   ❌ Gagal membaca results.json:', e.message);
    }
} else {
    console.warn('   ⚠️  results.json tidak ditemukan, melewati...');
}

// ─── 3. Baca live-exams.json ──────────────────────────────────────────────────
let liveExams = [];
if (fs.existsSync(LOCAL_LIVE_EXAMS)) {
    console.log(`📂 Membaca live-exams.json...`);
    try {
        const raw = JSON.parse(fs.readFileSync(LOCAL_LIVE_EXAMS, 'utf8'));
        liveExams = Array.isArray(raw) ? raw : [];
        console.log(`   ✅ ${liveExams.length} live exam ditemukan`);
    } catch (e) {
        console.warn('   ⚠️  live-exams.json kosong atau tidak valid:', e.message);
    }
}

console.log('');
console.log('⚙️  Menulis ke database SQLite...');

// ─── 4. Migrasi data utama (database.json) ────────────────────────────────────
if (mainDb) {
    // Subjects
    const subjects = mainDb.subjects || [];
    db.setSubjects(subjects);
    console.log(`   📚 Subjects    : ${subjects.length} item`);

    // Rombels
    const rombels = mainDb.rombels || [];
    db.setRombels(rombels);
    console.log(`   🏫 Rombels     : ${rombels.length} item`);

    // TimeLimits
    const timeLimits = mainDb.timeLimits || {};
    db.setTimeLimits(timeLimits);
    console.log(`   ⏱️  TimeLimits  : ${Object.keys(timeLimits).length} item`);

    // Questions
    const questions = mainDb.questions || [];
    console.log(`   ❓ Questions   : ${questions.length} soal — sedang diimpor...`);
    db.setAllQuestions(questions);
    console.log(`   ❓ Questions   : ✅ Selesai`);

    // Students
    const students = mainDb.students || [];
    db.setAllStudents(students);
    console.log(`   👥 Students    : ${students.length} item`);

    // Schedules
    const schedules = mainDb.schedules || [];
    db.setAllSchedules(schedules);
    console.log(`   📅 Schedules   : ${schedules.length} item`);

    // Quizzes
    const quizzes = mainDb.quizzes || [];
    db.setAllQuizzes(quizzes);
    console.log(`   🎯 Quizzes     : ${quizzes.length} item`);

    // Results embedded in database.json (biasanya kosong, tapi jaga-jaga)
    if (Array.isArray(mainDb.results) && mainDb.results.length > 0) {
        console.log(`   📊 Results (db): ${mainDb.results.length} — diimpor dari database.json`);
        db.setAllResults(mainDb.results);
    }
}

// ─── 5. Migrasi results.json ──────────────────────────────────────────────────
if (results.length > 0) {
    console.log(`   📊 Results     : ${results.length} — sedang diimpor...`);
    db.setAllResults(results);
    console.log(`   📊 Results     : ✅ Selesai`);
}

// ─── 6. Migrasi live-exams.json ───────────────────────────────────────────────
if (liveExams.length > 0) {
    db.setAllLiveExams(liveExams);
    console.log(`   🔴 LiveExams   : ${liveExams.length} item`);
}

// ─── 7. Verifikasi ──────────────────────────────────────────────────────────
console.log('');
console.log('🔍 Verifikasi data SQLite:');
const check = db.readDB();
console.log(`   Subjects  : ${check.subjects.length}`);
console.log(`   Rombels   : ${check.rombels.length}`);
console.log(`   Questions : ${check.questions.length}`);
console.log(`   Students  : ${check.students.length}`);
console.log(`   Schedules : ${check.schedules.length}`);
console.log(`   Quizzes   : ${check.quizzes.length}`);
console.log(`   Results   : ${check.results.length}`);

const dbPath = db.getDbPath();
const dbSize = (fs.statSync(dbPath).size / 1024 / 1024).toFixed(2);
console.log('');
console.log(`✅ Migrasi selesai! File SQLite: ${dbPath} (${dbSize} MB)`);
console.log('');
console.log('📌 File JSON asli tidak dihapus (bisa dijadikan backup).');
console.log('   Setelah verifikasi berhasil, server.js sudah menggunakan SQLite secara otomatis.');
