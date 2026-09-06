const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const LINUX_BIN = path.join(DIST, 'cbt-dorkas-linux');
const DEB_ROOT = path.join(DIST, 'deb-package');
const DEB_OUTPUT = path.join(DIST, 'cbt-dorkas_2.0.0_amd64.deb');

function log(msg) { console.log(`[DEB] ${msg}`); }

/**
 * Creates an 'ar' archive entry header
 */
function createArHeader(name, size) {
    const buf = Buffer.alloc(60, ' ');
    buf.write(name.padEnd(16), 0); // Name
    buf.write('0'.padEnd(12), 16); // Timestamp
    buf.write('0'.padEnd(6), 28);  // Owner ID
    buf.write('0'.padEnd(6), 34);  // Group ID
    buf.write('100644'.padEnd(8), 40); // Mode
    buf.write(size.toString().padEnd(10), 48); // Size
    buf.write('` \n', 58); // End
    return buf;
}

async function run() {
    log('Building native .deb without dpkg-deb...');

    if (!fs.existsSync(LINUX_BIN)) {
        log('❌ Linux binary missing. Run pkg first.');
        process.exit(1);
    }

    // Prepare debian-binary
    const debianBinary = Buffer.from('2.0\n');

    // Create control.tar.gz
    log('Creating control.tar.gz...');
    execSync(`tar -czf ../../control.tar.gz .`, { cwd: path.join(DEB_ROOT, 'DEBIAN') });
    const controlTar = fs.readFileSync(path.join(DIST, 'control.tar.gz'));

    // Create data.tar.gz
    log('Creating data.tar.gz...');
    execSync(`tar -czf ../data.tar.gz usr opt`, { cwd: DEB_ROOT });
    const dataTar = fs.readFileSync(path.join(DIST, 'data.tar.gz'));

    // Assemble .deb (ar archive)
    log('Assembling final .deb...');
    const out = fs.createWriteStream(DEB_OUTPUT);
    
    // Global header
    out.write('!<arch>\n');

    // 1. debian-binary
    out.write(createArHeader('debian-binary', debianBinary.length));
    out.write(debianBinary);
    if (debianBinary.length % 2 !== 0) out.write('\n');

    // 2. control.tar.gz
    out.write(createArHeader('control.tar.gz', controlTar.length));
    out.write(controlTar);
    if (controlTar.length % 2 !== 0) out.write('\n');

    // 3. data.tar.gz
    out.write(createArHeader('data.tar.gz', dataTar.length));
    out.write(dataTar);
    if (dataTar.length % 2 !== 0) out.write('\n');

    out.end();
    
    log(`✅ Successfully created: ${path.basename(DEB_OUTPUT)}`);
    
    // Cleanup temporary tarballs
    fs.unlinkSync(path.join(DIST, 'control.tar.gz'));
    fs.unlinkSync(path.join(DIST, 'data.tar.gz'));
}

run().catch(console.error);
