/**
 * DEBUGGING GUIDE - Real-time Progress Monitoring
 * 
 * STEPS TO TEST:
 * 
 * 1. SETUP
 *    - Open 2 browser tabs:
 *      Tab A: Admin (for monitoring)  -> http://localhost:3000/admin.html
 *      Tab B: Student (for exam)     -> http://localhost:3000/siswa.html
 * 
 * 2. ADMIN TAB (A) - PREPARATION
 *    - Open DevTools: Press F12
 *    - Go to Console tab
 *    - Filter by "[" to see only our debug logs
 *    - Login as admin: ADM / admin321
 *    - Go to Rombel section
 *    - Expected Console Logs:
 *      ✅ "[Admin Rombel] Started polling interval"
 *      ✅ Every 1 second: "[Admin Rombel] ⏱️ SYNC START"
 * 
 * 3. STUDENT TAB (B) - START EXAM
 *    - Open DevTools: Press F12
 *    - Go to Console tab
 *    - Login as student (any from database_exams)
 *    - Select a subject and click "Mulai Ujian"
 *    - Expected Console Logs:
 *      ✅ "[Student] Started live exam interval for: {mapel} studentId: {id}"
 *      ✅ Every 1 second: "[Student] Updated live exam status: {details}"
 *      ✅ "[saveLocalDb] Saving db to IDB..."
 *      ✅ "[sendLiveExamToServer] Posting to: http://localhost:3000/api/live-exam"
 * 
 * 4. MONITOR ADMIN TAB (A) - VERIFY SYNC
 *    Look for these sequence every 1-2 seconds:
 *    
 *    FIRST: Admin Sync Cycle
 *      ✅ "[Admin Rombel] ⏱️ SYNC START" (in orange)
 *      ✅ "[syncAdminLiveState] 📡 Server fetch result: 1 exams" 
 *      ✅ "[syncAdminLiveState] 💾 Local exams: 0"
 *      ✅ "[syncAdminLiveState] 🔀 After merge & filter: 1 exams"
 *      ✅ "[syncAdminLiveState] ✅ DATA CHANGED - Updating db.activeExams" (in green)
 *    
 *    THEN: Render
 *      ✅ "[renderRombelProgress] RENDER CALL" (in blue) showing activeExamsCount > 0
 *      ✅ "  📊 Student {name}: ACTIVE in {mapel}, Q{n}/{total}, {percentage}%"
 *      ✅ "[renderRombelProgress] RENDER COMPLETE (students rendered)"
 * 
 * 5. VERIFY UI UPDATES
 *    - In Admin Rombel tab, should see:
 *      ✅ Student card with "Sedang mengerjakan" badge (blue)
 *      ✅ Progress bar showing percentage
 *      ✅ Question info: "Soal 6/50"
 *      ✅ Time remaining: "29:45" format
 * 
 * 6. TEST CHANGING QUESTIONS (Student Tab)
 *    - Navigate to different questions in exam
 *    - Watch Student console for updated question numbers
 *    - Result: Admin should show updated "Soal X/50" within 1-2 seconds
 * 
 * 7. TROUBLESHOOTING CHECKLIST
 * 
 *    IF Admin logs show "[syncAdminLiveState] Offline mode":
 *       → Issue: Browser offline status
 *       → Fix: Check navigator.onLine in console
 * 
 *    IF "[fetchLiveExamsFromServer] Error" or fetch fails:
 *       → Issue: Server API unreachable
 *       → Fix: Check if server running on port 3000
 *       → Run: node server.js
 * 
 *    IF "[sendLiveExamToServer] Server error: 400" or 500:
 *       → Issue: Student data malformed or POST fails
 *       → Check: Server logs for POST /api/live-exam error details
 * 
 *    IF Admin shows "0 exams" consistently:
 *       → Issue: No data from server or student not sending
 *       → Check Student logs for "[sendLiveExamToServer] Posting to"
 *       → Check Server logs for "POST /api/live-exam Received"
 * 
 *    IF UI doesn't show student names, but logs are good:
 *       → Issue: renderRombelProgress() logic error or HTML element deleted
 *       → Check: admin.html line 647 for <div id="rombel-progress-list">
 * 
 *    IF Progress bar not moving:
 *       → Issue: Progress percentage not updating
 *       → Check: Student logs for "[Student] Updated live exam status percentage"
 * 
 * 8. COPY LOGS FOR DEBUGGING
 *    - In console, right-click filtered logs
 *    - "Copy visible logs"
 *    - Paste in text file and provide to developer with:
 *      - Which tab (Admin/Student)
 *      - What actions you performed
 *      - Timestamp when issue occurred
 */

// Quick commands to run in browser console:

// Check if student sending data:
// console.log('DB Active Exams:', db.activeExams);
// console.log('Exam Active?:', isExamActive);
// console.log('Exam Interval ID:', liveExamInterval);

// Check admin polling:
// console.log('Admin Poll Interval ID:', adminRombelPollInterval);
// console.log('Admin Online?:', navigator.onLine);

// Manual sync test:
// await syncAdminLiveState();
// renderRombelProgress();

// Check API URL:
// console.log('API Base URL:', getApiBaseUrl());
// console.log('Full endpoint:', getApiBaseUrl() + '/api/live-exams');
