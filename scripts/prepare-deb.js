const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const LINUX_BIN = path.join(DIST, 'cbt-dorkas-linux');
const DEB_ROOT = path.join(DIST, 'deb-package');

async function makeDeb() {
    console.log('📦 Preparing Debian Package Structure...');

    if (!fs.existsSync(LINUX_BIN)) {
        console.error('❌ Linux binary not found! Build it first with pkg.');
        process.exit(1);
    }

    // 1. Create structure
    const folders = [
        DEB_ROOT,
        path.join(DEB_ROOT, 'DEBIAN'),
        path.join(DEB_ROOT, 'usr/bin'),
        path.join(DEB_ROOT, 'opt/cbt-dorkas'),
        path.join(DEB_ROOT, 'opt/cbt-dorkas/APP'),
        path.join(DEB_ROOT, 'opt/cbt-dorkas/APP/images'),
    ];

    folders.forEach(f => {
        if (!fs.existsSync(f)) fs.mkdirSync(f, { recursive: true });
    });

    // 2. Copy binary to /opt/cbt-dorkas
    fs.copyFileSync(LINUX_BIN, path.join(DEB_ROOT, 'opt/cbt-dorkas/cbt-dorkas'));
    
    // 3. Create symlink wrapper in /usr/bin/cbt-dorkas
    const wrapper = `#!/bin/bash\ncd /opt/cbt-dorkas && ./cbt-dorkas "$@"\n`;
    fs.writeFileSync(path.join(DEB_ROOT, 'usr/bin/cbt-dorkas'), wrapper, { mode: 0o755 });

    // 4. Copy static files to /opt/cbt-dorkas/APP
    const STATIC_FILES = [
        'index.html', 'admin.html', 'guru.html', 'siswa.html', 'quizz.html',
        'administrasi_guru.html', 'app.js', 'wordParser.js', 'style.css', 'logo.png', '.env'
    ];

    STATIC_FILES.forEach(file => {
        const src = path.join(ROOT, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(DEB_ROOT, 'opt/cbt-dorkas/APP', file));
        }
    });

    // Copy database if exists
    if (fs.existsSync(path.join(ROOT, 'database.json'))) {
        fs.copyFileSync(path.join(ROOT, 'database.json'), path.join(DEB_ROOT, 'opt/cbt-dorkas/APP/database.json'));
    }

    // 5. Create control file
    const control = `Package: cbt-dorkas
Version: 2.0.0
Section: utils
Priority: optional
Architecture: amd64
Maintainer: Daniel Widiatmoko <daniel@example.com>
Description: CBT Offline Exam System
 A console-based exam application for offline use.
 Includes AI-powered question generation and Word import.
`;
    fs.writeFileSync(path.join(DEB_ROOT, 'DEBIAN/control'), control);

    // 6. Postinst script to set permissions
    const postinst = `#!/bin/bash\nchmod +x /opt/cbt-dorkas/cbt-dorkas\nchmod +x /usr/bin/cbt-dorkas\nchmod -R 777 /opt/cbt-dorkas/APP\nexit 0\n`;
    fs.writeFileSync(path.join(DEB_ROOT, 'DEBIAN/postinst'), postinst, { mode: 0o755 });

    console.log('\n✅ Debian structure prepared at: dist/deb-package');
    console.log('\n🚀 To build the .deb file, run this command on a Linux/Debian system or WSL:');
    console.log(`\x1b[32m   dpkg-deb --build dist/deb-package dist/cbt-dorkas.deb\x1b[0m`);
    console.log('\nNote: You must have technical write access to /opt when installing.');
}

makeDeb().catch(console.error);
