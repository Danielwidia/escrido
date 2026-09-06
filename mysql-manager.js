const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const isPkg = typeof process.pkg !== 'undefined';
const baseDir = isPkg ? path.dirname(process.execPath) : __dirname;

/**
 * Manager untuk MySQL Portable
 */
class MySQLManager {
    constructor() {
        this.mysqlDir = isPkg ? path.join(baseDir, 'APP', 'mysql') : path.join(baseDir, 'mysql');
        this.binPath = path.join(this.mysqlDir, 'bin', 'mysqld.exe');
        this.dataDir = path.join(this.mysqlDir, 'data');
        this.port = 3306;
        this.process = null;
    }

    /**
     * Cek apakah port MySQL sudah digunakan
     */
    async isPortBusy() {
        return new Promise((resolve) => {
            const server = net.createServer()
                .once('error', () => resolve(true))
                .once('listening', () => {
                    server.close();
                    resolve(false);
                })
                .listen(this.port);
        });
    }

    /**
     * Inisialisasi Database jika belum ada (untuk MySQL baru)
     */
    initializeIfNeeded() {
        const markerFile = path.join(this.dataDir, 'ibdata1');
        if (!fs.existsSync(this.dataDir) || !fs.existsSync(markerFile)) {
            console.log('[MySQL] Data directory is missing or empty. Initializing...');
            if (!fs.existsSync(this.dataDir)) {
                try { fs.mkdirSync(this.dataDir, { recursive: true }); } catch (e) {}
            }
            try {
                // Gunakan --initialize-insecure agar tidak ada password root awal
                // Batasi memori selama inisialisasi
                const winDataDir = this.dataDir.replace(/\\/g, '/');
                execSync(`"${this.binPath}" --initialize-insecure --datadir="${winDataDir}" --innodb_buffer_pool_size=32M --innodb_log_buffer_size=1M --key_buffer_size=8M`, { stdio: 'inherit' });
                console.log('[MySQL] Initialization complete.');
                return true;
            } catch (err) {
                console.error('[MySQL] Initialization failed:', err.message);
                // Bersihkan folder data jika gagal parsial agar tidak corrupt di jalankan berikutnya
                if (fs.existsSync(this.dataDir)) {
                    try { fs.rmSync(this.dataDir, { recursive: true, force: true }); } catch (e) {}
                }
                return false;
            }
        }
        return true;
    }

    /**
     * Jalankan MySQL
     */
    async start() {
        if (!fs.existsSync(this.binPath)) {
            const shellPath = path.join(this.mysqlDir, 'bin', 'mysqlsh.exe');
            if (fs.existsSync(shellPath)) {
                console.warn(`[MySQL Error] Folder 'mysql' berisi MySQL Shell, bukan MySQL Server.`);
                console.warn(`[MySQL Error] Silakan unduh "MySQL Community Server (ZIP Archive)" dari:`);
                console.warn(`[MySQL Error] https://dev.mysql.com/downloads/mysql/`);
            } else {
                console.warn(`[MySQL] Portable MySQL not found at: ${this.binPath}`);
            }
            console.warn(`[MySQL] Falling back to system MySQL or assuming it's already running.`);
            return false;
        }

        const busy = await this.isPortBusy();
        if (busy) {
            console.log(`[MySQL] Port ${this.port} is already in use. Assuming MySQL is already running.`);
            return true;
        }

        const initSuccess = this.initializeIfNeeded();
        if (!initSuccess) {
            console.error('[MySQL] Cannot start MySQL because initialization failed.');
            return false;
        }

        console.log('[MySQL] Starting Portable MySQL (Low Resource Mode)...');
        
        // Jalankan mysqld.exe dengan batasan memori (Low Resource Mode)
        // Tambahkan --log-raw dan matikan binary log jika tidak diperlukan untuk menghindari tc.log error
        const winDataDir = this.dataDir.replace(/\\/g, '/');
        this.process = spawn(this.binPath, [
            `--datadir=${winDataDir}`,
            `--port=${this.port}`,
            '--innodb_buffer_pool_size=64M',
            '--innodb_log_buffer_size=2M',
            '--key_buffer_size=16M',
            '--max_connections=50',
            '--innodb_flush_log_at_trx_commit=2',
            '--skip-log-bin',           // Matikan binary log untuk menghindari masalah tc.log
            '--log-error-verbosity=3',   // Detail error ke console
            '--console'
        ], {
            detached: false,
            stdio: 'pipe'
        });

        this.process.stdout.on('data', (data) => {
            if (data.toString().includes('ready for connections')) {
                console.log('[MySQL] MySQL is ready for connections.');
            }
        });

        this.process.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg.includes('ready for connections')) {
                console.log('[MySQL] MySQL is ready for connections.');
            }
            
            // Only log as error if it doesn't contain [Note] or [Warning]
            if (msg.toLowerCase().includes('error')) {
                if (msg.includes('[Note]') || msg.includes('[Warning]')) {
                    console.log(`[MySQL] ${msg}`);
                } else {
                    console.error(`[MySQL Error] ${msg}`);
                }
            } else if (msg.includes('[Note]') || msg.includes('[Warning]')) {
                // Also capture notes/warnings that don't have "error" in them
                console.log(`[MySQL] ${msg}`);
            }
        });

        this.process.on('close', (code) => {
            console.log(`[MySQL] Process exited with code ${code}`);
            this.process = null;
        });

        // Tunggu sebentar sampai benar-benar siap
        await this.waitForReady();
        return true;
    }

    /**
     * Tunggu port MySQL terbuka
     */
    async waitForReady(timeout = 30000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const busy = await this.isPortBusy();
            if (busy) return true; // Port busy means it's listening
            await new Promise(r => setTimeout(r, 1000));
        }
        throw new Error('Timeout waiting for MySQL to start');
    }

    /**
     * Matikan MySQL secara bersih (Graceful Shutdown)
     */
    stop() {
        if (this.process) {
            const pid = this.process.pid;
            console.log(`[MySQL] Stopping Portable MySQL (PID: ${pid})...`);
            
            if (process.platform === 'win32') {
                try {
                    const mysqlAdminPath = path.join(this.mysqlDir, 'bin', 'mysqladmin.exe');
                    if (fs.existsSync(mysqlAdminPath)) {
                        console.log('[MySQL] Sending shutdown command via mysqladmin...');
                        // Inisialisasi insecure menggunakan root tanpa password
                        execSync(`"${mysqlAdminPath}" -u root shutdown`, { stdio: 'ignore', timeout: 5000 });
                    } else {
                        // Jika tidak ada mysqladmin, coba taskkill tanpa /f dulu (mengirim WM_CLOSE/SIGTERM)
                        console.log('[MySQL] Attempting standard taskkill...');
                        execSync(`taskkill /pid ${pid} /t`, { stdio: 'ignore' });
                    }
                    
                    // Berikan waktu maksimal 3 detik untuk flushing log ke disk
                    for (let i = 0; i < 3; i++) {
                        try {
                            const output = execSync(`tasklist /fi "pid eq ${pid}" /fo csv /nh`, { encoding: 'utf8' });
                            if (!output || !output.includes(String(pid))) break;
                            console.log('[MySQL] Waiting for process to exit...');
                            execSync('timeout /t 1', { stdio: 'ignore' });
                        } catch (e) { break; }
                    }
                } catch (e) {
                    console.warn('[MySQL] Graceful shutdown failed, falling back to force kill.');
                }

                // Terakhir: Paksa matikan jika masih berjalan untuk memastikan port bebas
                try {
                    execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' });
                    console.log('[MySQL] Process forcefully terminated.');
                } catch (e) {
                    // Proses mungkin sudah mati
                }
            } else {
                this.process.kill('SIGTERM');
            }
            this.process = null;
        }
    }
}

module.exports = new MySQLManager();
