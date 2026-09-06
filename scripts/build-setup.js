/**
 * build-setup.js
 * Menjalankan build exe lalu membungkusnya dengan Inno Setup menjadi file installer.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GREEN = '\x1b[32m';
const BLUE  = '\x1b[34m';
const YELLOW= '\x1b[33m';
const RED   = '\x1b[31m';
const RESET = '\x1b[0m';

function log(c, m) { console.log(`${c}${m}${RESET}`); }

const ROOT = path.join(__dirname, '..');

try {
    // 1. Jalankan build exe standar
    log(BLUE, '\n[1/2] Menjalankan build executable dasar...');
    execSync('npm run build:exe', { stdio: 'inherit', cwd: ROOT });

    // 2. Jalankan Inno Setup
    log(BLUE, '\n[2/2] Membuat installer Windows dengan Inno Setup...');
    
    // Pastikan file .iss ada
    const issPath = path.join(ROOT, 'installer.iss');
    if (!fs.existsSync(issPath)) {
        log(YELLOW, '   ⚠️ installer.iss tidak ditemukan, membuat default...');
        const issContent = `
[Setup]
AppName=DR CBT
AppVersion=1.0.0
DefaultDirName={pf}\\DR CBT
DefaultGroupName=DR CBT
OutputBaseFilename=DR-CBT-Setup
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "dist\\DR-CBT.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\\APP\\*"; DestDir: "{app}\\APP"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\\DR CBT"; Filename: "{app}\\DR-CBT.exe"
Name: "{commondesktop}\\DR CBT"; Filename: "{app}\\DR-CBT.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\\DR-CBT.exe"; Description: "{cm:LaunchProgram,DR CBT}"; Flags: nowait postinstall skipifsilent
        `.trim();
        fs.writeFileSync(issPath, issContent, 'utf8');
    }

    // Eksekusi innosetup-compiler
    // Library innosetup-compiler provides binary 'innosetup-compiler' which can be invoked via npx
    log(YELLOW, '   (Sedang mengkompilasi installer dengan innosetup-compiler...)\n');
    execSync('npx innosetup-compiler installer.iss', { stdio: 'inherit', cwd: ROOT });


    log(GREEN, '\n✅ Installer berhasil dibuat di folder dist/Output/ (atau folder default Inno Setup).');
    
} catch (err) {
    log(RED, '\n❌ Gagal membuat installer: ' + err.message);
    process.exit(1);
}
