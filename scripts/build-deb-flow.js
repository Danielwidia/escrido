const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const LINUX_BIN = path.join(DIST, 'cbt-dorkas-linux');

function log(msg) { console.log(`\n\x1b[34m[BUILD-DEB] ${msg}\x1b[0m`); }

try {
    if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);

    log('1. Building Linux Binary with pkg...');
    // targets: node20-linux-x64
    execSync('npx @yao-pkg/pkg . --targets node20-linux-x64 --output dist/cbt-dorkas-linux', { stdio: 'inherit', cwd: ROOT });

    if (!fs.existsSync(LINUX_BIN)) {
        throw new Error('Linux binary creation failed!');
    }

    log('2. Preparing Debian Package Structure...');
    execSync('node scripts/prepare-deb.js', { stdio: 'inherit', cwd: ROOT });

    log('3. Assembling .deb package natively...');
    execSync('node scripts/build-deb-native.js', { stdio: 'inherit', cwd: ROOT });

    log('🎉 SUCCESS: .deb package is ready in dist/ folder.');
} catch (err) {
    console.error(`\x1b[31m\n❌ BUILD FAILED: ${err.message}\x1b[0m`);
    process.exit(1);
}
