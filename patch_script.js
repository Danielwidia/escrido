const fs = require('fs');

let appJs = fs.readFileSync('app.js', 'utf8');

// 1. Fix showLoginScreen
const loginScreenRegex = /function showLoginScreen\(\) \{\s*([^}]*)\s*\}/;
appJs = appJs.replace(loginScreenRegex, `function showLoginScreen() {
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

fs.writeFileSync('app.js', appJs);

let extractJs = fs.readFileSync('extract.js', 'utf8');
const safeLoginScreenLogic = `
// Add safe showLoginScreen
const showLoginScreenRegex = /function showLoginScreen\\(\\) \\{[\\s\\S]*?\\}/;
appJsContent = appJsContent.replace(showLoginScreenRegex, \`function showLoginScreen() {
            const login = document.getElementById('login-screen');
            if (login) login.classList.remove('hidden');
            
            const admin = document.getElementById('admin-dashboard');
            if (admin) admin.classList.add('hidden');
            
            const student = document.getElementById('student-dashboard');
            if (student) student.classList.add('hidden');
            
            const teacher = document.getElementById('teacher-dashboard');
            if (teacher) teacher.classList.add('hidden');
            
            if (typeof closeModals === 'function') closeModals();
        }\`);
`;
// inject into extract.js before fs.writeFileSync('app.js', appJsContent);
extractJs = extractJs.replace(/fs\.writeFileSync\('app\.js', appJsContent\);/, safeLoginScreenLogic + '\nfs.writeFileSync(\'app.js\', appJsContent);');
fs.writeFileSync('extract.js', extractJs);
console.log('Patched app.js and extract.js');
