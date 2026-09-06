const fs = require('fs');
const path = require('path');
const { load } = require('resedit/cjs');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const APP_DIR = path.join(DIST, 'APP');

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function log(color, msg) { console.log(`${color}${msg}${RESET}`); }

async function run() {
    try {
        const ResEdit = await load();
        const exePath = path.join(DIST, 'DR-CBT.exe');
        if (!fs.existsSync(exePath)) {
            throw new Error("DR-CBT.exe tidak ditemukan di folder dist/");
        }
        
        const exeData = fs.readFileSync(exePath);
        const exe = ResEdit.NtExecutable.from(exeData);
        const res = ResEdit.NtExecutableResource.from(exe);

        // 1. Icon
        const iconPath = path.join(APP_DIR, 'favicon.ico');
        if (fs.existsSync(iconPath)) {
            const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
            const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
            
            if (iconGroups.length > 0) {
                for (const group of iconGroups) {
                    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
                        res.entries,
                        group.id,
                        group.lang,
                        iconFile.icons.map((item) => item.data)
                    );
                }
                log(GREEN, `   ✅ Icon (${iconGroups.length} groups) diterapkan`);
            } else {
                ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
                    res.entries,
                    101,
                    1033,
                    iconFile.icons.map((item) => item.data)
                );
                log(GREEN, '   ✅ Icon diterapkan (Default ID 101)');
            }
        } else {
            log(YELLOW, '   ⚠️  favicon.ico tidak ditemukan di dist/APP/, icon gagal diset');
        }

        // 2. Metadata (Version Info)
        const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
        const vi = viList.length > 0 ? viList[0] : ResEdit.Resource.VersionInfo.createEmpty();
        
        vi.setFileVersion(2, 0, 0, 0, 1033);
        vi.setProductVersion(2, 0, 0, 0, 1033);
        vi.setStringValues(
            { lang: 1033, codepage: 1200 },
            {
                FileDescription: 'DR CBT - Aplikasi Computer Based Test',
                CompanyName: 'DR CBT',
                ProductName: 'DR CBT',
                ProductVersion: '2.0.0',
                FileVersion: '2.0.0',
                LegalCopyright: '© 2026 Daniel Widiatmoko',
                OriginalFilename: 'DR-CBT.exe',
                InternalName: 'DR-CBT'
            }
        );
        vi.outputToResourceEntries(res.entries);
        
        // 3. Manifest (Run as normal user / Invoker)
        try {
            const manifest = ResEdit.Resource.Manifest.prepare(res.entries);
            manifest.executionLevel = 'asInvoker';
            
            // Simpan perubahan manifest kembali ke resource entries
            manifest.outputToResourceEntries(res.entries);
            
            log(GREEN, '   ✅ Manifest (Run as Invoker) diterapkan pada EXE');
        } catch (e) {
            log(YELLOW, '   ⚠️  Gagal menerapkan Manifest: ' + e.message);
        }

        res.outputResource(exe);
        const newExeData = exe.generate();
        fs.writeFileSync(exePath, Buffer.from(newExeData));
        log(GREEN, '   ✅ Metadata Versi 2.0.0 & Copyright diterapkan');
    } catch (err) {
        log(RED, '   ⚠️  Gagal memodifikasi resources EXE: ' + err.message);
    }
}

run().then(() => {
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
