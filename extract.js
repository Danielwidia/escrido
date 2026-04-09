const fs = require('fs');

// 1. Process index.html and create index_processed.html with script/style tags replaced
let content = fs.readFileSync('index_backup.html', 'utf8');

let styleContent = '';
let appJsContent = '';

// Extract <style>
const styleRegex = /<style>([\s\S]*?)<\/style>/i;
const matchStyle = content.match(styleRegex);
if (matchStyle) {
    styleContent = matchStyle[1];
    fs.writeFileSync('style.css', styleContent);
}

// Extract inline <script> tags
const scripts = [];
let htmlWithoutInlineScripts = content.replace(/<script(?![^>]*src=)>([\s\S]*?)<\/script>/gi, (match, p1) => {
    scripts.push(p1);
    return ''; // remove inline script
});

if (scripts.length > 0) {
    appJsContent = scripts.join('\n\n');
}

// Apply App.js modififcations
const initRegex = /if \(currentSiswa\) \{[\s\S]*?\/\/ No valid session, show login screen\s*showLoginScreen\(\);\s*\}/;
const newInitLogic = `if (currentSiswa) {
                const userExists = db.students.find(x => x.id === currentSiswa.id && x.password === currentSiswa.password);
                if (!userExists) {
                    console.warn('User from session not found in database, logging out');
                    clearSession();
                    window.location.href = 'index.html';
                    return;
                }

                const page = window.location.pathname.split('/').pop().split('?')[0];
                if (currentSiswa.role === 'admin' && page !== 'admin.html') {
                    window.location.href = 'admin.html';
                    return;
                } else if (currentSiswa.role === 'student' && page !== 'siswa.html') {
                    window.location.href = 'siswa.html';
                    return;
                } else if (currentSiswa.role === 'teacher' && page !== 'guru.html') {
                    window.location.href = 'guru.html';
                    return;
                }

                const loginScreen = document.getElementById('login-screen');
                if (loginScreen) loginScreen.classList.add('hidden');
                
                if (typeof closeModals === 'function') closeModals();

                if (currentSiswa.role === 'admin') {
                    const adminDash = document.getElementById('admin-dashboard');
                    if (adminDash) adminDash.classList.remove('hidden');
                    if (typeof showAdminSection === 'function') showAdminSection('overview');
                } else if (currentSiswa.role === 'student') {
                    const studentDash = document.getElementById('student-dashboard');
                    if (studentDash) studentDash.classList.remove('hidden');
                    const stLabel = document.getElementById('st-info-label');
                    if (stLabel) stLabel.innerText = \`\${currentSiswa.name} | \${currentSiswa.rombel}\`;
                    if (typeof renderStudentExamList === 'function' && studentDash) renderStudentExamList();
                } else if (currentSiswa.role === 'teacher') {
                    const teacherDash = document.getElementById('teacher-dashboard');
                    if (teacherDash) teacherDash.classList.remove('hidden');
                    const tcLabel = document.getElementById('teacher-info-label');
                    if (tcLabel) tcLabel.innerText = \`\${currentSiswa.name} | Guru \${formatTeacherSubjects(currentSiswa)}\`;
                    if (typeof renderTeacherQuestions === 'function' && teacherDash) renderTeacherQuestions();
                }
                migrateTeacherData();
                updateStats();
                return;
            }

            const page = window.location.pathname.split('/').pop().split('?')[0];
            if (page !== '' && page !== 'index.html') {
                window.location.href = 'index.html';
            } else {
                if(typeof showLoginScreen === 'function' && document.getElementById('login-screen')) showLoginScreen();
            }
        }`;
appJsContent = appJsContent.replace(initRegex, newInitLogic);

const handleLoginRegex = /if \(roleMatch\) \{[\s\S]*?showToast\(\`Login berhasil! Selamat datang, \$\{user\.name\}\`, 'success'\);\s*\}/;
const newHandleLoginLogic = `if (roleMatch) {
                    currentSiswa = user;
                    // For student updateCompletionCharts is used
                    if (user.role === 'student' && typeof updateCompletionCharts === 'function') updateCompletionCharts();
                    saveSession();

                    if (user.role === 'admin') window.location.href = 'admin.html';
                    else if (user.role === 'student') window.location.href = 'siswa.html';
                    else if (user.role === 'teacher') window.location.href = 'guru.html';
                }`;
appJsContent = appJsContent.replace(handleLoginRegex, newHandleLoginLogic);

const logoutRegex = /function logout\(\) \{\s*isExamActive = false;\s*clearSession\(\);\s*location\.reload\(\);\s*\}/;
const newLogoutLogic = `function logout() {
            isExamActive = false;
            clearSession();
            window.location.href = 'index.html';
        }`;
appJsContent = appJsContent.replace(logoutRegex, newLogoutLogic);


// Add safe showLoginScreen
const showLoginScreenRegex = /function showLoginScreen\(\) \{[\s\S]*?\}/;
appJsContent = appJsContent.replace(showLoginScreenRegex, `function showLoginScreen() {
            const login = document.getElementById('login-screen');
            if (login) login.classList.remove('hidden');
            
            const admin = document.getElementById('admin-dashboard');
            if (admin) admin.classList.add('hidden');
            
            const student = document.getElementById('student-dashboard');
            if (student) student.classList.add('hidden');
            
            const teacher = document.getElementById('teacher-dashboard');
            if (teacher) teacher.classList.add('hidden');
            
            if (typeof closeModals === 'function') closeModals();
        }`);

fs.writeFileSync('app.js', appJsContent);
console.log('app.js extracted and updated');

// 2. Base Html construction
let newHtml = content.replace(styleRegex, '<link rel=\"stylesheet\" href=\"style.css\">');
let replacedJs = false;
newHtml = newHtml.replace(/<script(?![^>]*src=)>([\s\S]*?)<\/script>/gi, (match) => {
    if (!replacedJs) {
        replacedJs = true;
        return '<script src=\"app.js\"></script>';
    }
    return '';
});

// Helper to remove divs
function removeDiv(html, targetStr, endTag = '</div>') {
    const start = html.indexOf(targetStr);
    if (start === -1) return html;
    let depth = 0;
    let i = start;
    let matchedOpening = false;

    while (i < html.length) {
        if (html.substr(i, 4) === '<div') {
            depth++;
            matchedOpening = true;
        } else if (html.substr(i, 5) === '</div') {
            depth--;
        }

        if (matchedOpening && depth === 0) {
            return html.substring(0, start) + html.substring(i + 6);
        }
        i++;
    }
    return html;
}

let adminHtml = newHtml;
adminHtml = removeDiv(adminHtml, '<div id="login-screen"');
adminHtml = removeDiv(adminHtml, '<div id="auth-modal"');
adminHtml = removeDiv(adminHtml, '<div id="student-dashboard"');
adminHtml = removeDiv(adminHtml, '<div id="teacher-dashboard"');
adminHtml = removeDiv(adminHtml, '<div id="student-instruction-modal"');
adminHtml = removeDiv(adminHtml, '<div id="confirm-finish-modal"');

let guruHtml = newHtml;
guruHtml = removeDiv(guruHtml, '<div id="login-screen"');
guruHtml = removeDiv(guruHtml, '<div id="auth-modal"');
guruHtml = removeDiv(guruHtml, '<div id="admin-dashboard"');
guruHtml = removeDiv(guruHtml, '<div id="student-dashboard"');
guruHtml = removeDiv(guruHtml, '<div id="student-instruction-modal"');
guruHtml = removeDiv(guruHtml, '<div id="confirm-finish-modal"');

let siswaHtml = newHtml;
siswaHtml = removeDiv(siswaHtml, '<div id="login-screen"');
siswaHtml = removeDiv(siswaHtml, '<div id="auth-modal"');
siswaHtml = removeDiv(siswaHtml, '<div id="admin-dashboard"');
siswaHtml = removeDiv(siswaHtml, '<div id="teacher-dashboard"');

let loginHtml = newHtml;
loginHtml = removeDiv(loginHtml, '<div id="admin-dashboard"');
loginHtml = removeDiv(loginHtml, '<div id="student-dashboard"');
loginHtml = removeDiv(loginHtml, '<div id="teacher-dashboard"');
loginHtml = removeDiv(loginHtml, '<div id="student-instruction-modal"');
loginHtml = removeDiv(loginHtml, '<div id="confirm-finish-modal"');
loginHtml = removeDiv(loginHtml, '<div id="config-modal"');
loginHtml = removeDiv(loginHtml, '<div id="import-siswa-modal"');
loginHtml = removeDiv(loginHtml, '<div id="import-modal"');
loginHtml = removeDiv(loginHtml, '<div id="question-modal"');
loginHtml = removeDiv(loginHtml, '<div id="image-zoom-modal"');

fs.writeFileSync('admin.html', adminHtml);
fs.writeFileSync('guru.html', guruHtml);
fs.writeFileSync('siswa.html', siswaHtml);

// Backup index.html first just in case
if(!fs.existsSync('index_backup.html')){
    fs.writeFileSync('index_backup.html', content);
}
fs.writeFileSync('index.html', loginHtml); // Overwrite index with login HTML!

console.log('HTML files created.');
