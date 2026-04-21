function showLoginForm(type) {
            window.loginType = type;
            document.getElementById('auth-modal').classList.remove('hidden');
            document.getElementById('auth-modal').classList.add('flex');
        }
        function closeModals() {
            window.isTeacherMode = false;
            document.querySelectorAll('[id$="-modal"]').forEach(m => {
                m.classList.remove('flex');
                m.classList.add('hidden');
            });
            const qText = document.getElementById('q-text');
            if (qText) qText.value = '';
            document.querySelectorAll('.q-opt').forEach(i => i.value = '');
            const qMapel = document.getElementById('q-mapel');
            const qRombel = document.getElementById('q-rombel');
            if (qMapel) qMapel.value = '';
            if (qRombel) qRombel.value = '';
            const imageUrlInput = document.getElementById('q-image-url');
            if (imageUrlInput) imageUrlInput.value = '';
            const imageFile = document.getElementById('q-image-file');
            if (imageFile) imageFile.value = '';
            const imagesPreview = document.getElementById('q-images-preview');
            if (imagesPreview) imagesPreview.innerHTML = '';
            const imagesList = document.getElementById('q-images-list');
            if (imagesList) imagesList.innerHTML = '';
            window.storedImages = [];
            activeCorrect = 0;
        }
        function togglePasswordVisibility() {
            const pwInput = document.getElementById('password');
            const icon = document.getElementById('toggle-pw-icon');
            if (pwInput.type === 'password') {
                pwInput.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                pwInput.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        }
        
        function reloadPage() {
            // Show loading overlay
            const overlay = document.getElementById('loading-overlay');
            if (overlay) {
                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
            }
            // Delay reload to show loading animation
            setTimeout(() => {
                location.reload();
            }, 500);
        }
    


        const DB_KEY = "EXAM_DORKAS_DATABASE_OFFICIAL";
        const SESSION_KEY = "EXAM_DORKAS_SESSION";
        const REMOTE_SERVER_KEY = "EXAM_DORKAS_REMOTE_SERVER_URL";
        const IDB_DB_NAME = 'DORKAS_EXAM_STORAGE';
        const IDB_STORE = 'store';

        // Global Anti-Cheat State
        let isExamActive = false;
        let cheatingCount = 0;
        let wakeLock = null;
        let isFullscreen = false;

        function handleCheating(reason) {
            if (!isExamActive) return;

            // Increment cheat count
            cheatingCount++;
            console.warn(`Anti-Cheat Triggered: ${reason} (Attempt: ${cheatingCount})`);

            if (cheatingCount >= 3) {
                // Final Strike - Auto Submit
                isExamActive = false;
                alert('UJIAN DIBERHENTIKAN! Anda terdeteksi melakukan kecurangan berkali-kali. Jawaban Anda telah dikirim.');
                submitExam();
            } else {
                // First or Second Warning
                const attemptsLeft = 3 - cheatingCount;
                const warningMsg = attemptsLeft === 1 ? 'Peringatan Terakhir!' : `Peringatan ${cheatingCount}!`;

                document.getElementById('cheat-warning-modal').classList.remove('hidden');
                document.getElementById('cheat-warning-modal').classList.add('flex');

                // (Optional) Update modal text if there's a specific element for it
                const warningText = document.getElementById('cheat-warning-text');
                if (warningText) {
                    warningText.innerText = `${reason}. ${warningMsg} Jika terdeteksi lagi, ujian akan dihentikan secara otomatis.`;
                }
            }
        }

        function closeCheatWarning() {
            document.getElementById('cheat-warning-modal').classList.add('hidden');
            document.getElementById('cheat-warning-modal').classList.remove('flex');
        }

        // Anti-Cheat Event Listeners
        document.addEventListener('visibilitychange', () => {
            if (isExamActive) {
                if (document.visibilityState === 'hidden') {
                    // Mobile & Desktop: Mask content and trigger cheat detection
                    document.getElementById('cheat-mask').classList.remove('hidden');
                    document.getElementById('cheat-mask').classList.add('flex');
                    handleCheating('Berpindah tab/aplikasi');
                } else {
                    document.getElementById('cheat-mask').classList.add('hidden');
                    document.getElementById('cheat-mask').classList.remove('flex');
                }
            }
        });

        window.addEventListener('blur', () => {
            if (isExamActive) {
                // On mobile, blur is often triggered by keyboard or system overlays.
                // We rely on visibilitychange for app switching and resize for split-screen.
                if (isMobileDevice()) {
                    const widthDiff = Math.abs(window.innerWidth - window.screen.width);
                    if (widthDiff <= 25) return; // Still full width, ignore blur
                }

                handleCheating('Meninggalkan jendela ujian');
            }
        });

        // Anti-Copy & Select
        document.addEventListener('contextmenu', e => isExamActive && e.preventDefault());
        document.addEventListener('copy', e => isExamActive && e.preventDefault());
        document.addEventListener('cut', e => isExamActive && e.preventDefault());
        document.addEventListener('paste', e => isExamActive && e.preventDefault());
        document.addEventListener('selectstart', e => isExamActive && e.preventDefault());

        // Anti-Screenshot (PrintScreen)
        document.addEventListener('keydown', e => {
            if (isExamActive) {
                // Detect PrintScreen (usually keyCode 44 or 'PrintScreen')
                if (e.key === 'PrintScreen' || e.keyCode === 44) {
                    e.preventDefault();
                    handleCheating('Screenshot terdeteksi');
                }
                // Detect various dev tools shortcuts as well
                if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) e.preventDefault();
                if (e.key === 'F12') e.preventDefault();
                // Prevent exiting fullscreen with ESC or F11
                if (e.key === 'Escape' || e.key === 'F11') {
                    e.preventDefault();
                    handleCheating('Mencoba keluar dari mode layar penuh');
                }
            }
        });

        // Fullscreen and Wake Lock Functions
        async function requestFullscreen() {
            console.log('Attempting to request browser fullscreen API...');

            // Don't interfere if CSS simulation is already active
            if (isFullscreen) {
                console.log('CSS fullscreen already active, skipping API request');
                return;
            }

            // Check if fullscreen is supported and enabled
            const fullscreenEnabled = document.fullscreenEnabled ||
                                    document.webkitFullscreenEnabled ||
                                    document.msFullscreenEnabled ||
                                    document.mozFullScreenEnabled ||
                                    false;

            if (!fullscreenEnabled) {
                console.warn('Browser fullscreen not supported, relying on CSS simulation');
                return;
            }

            try {
                const elem = document.documentElement;

                // Try different fullscreen methods
                if (elem.requestFullscreen) {
                    console.log('Using requestFullscreen');
                    await elem.requestFullscreen();
                } else if (elem.webkitRequestFullscreen) {
                    console.log('Using webkitRequestFullscreen');
                    await elem.webkitRequestFullscreen();
                } else if (elem.webkitEnterFullscreen) {
                    console.log('Using webkitEnterFullscreen');
                    await elem.webkitEnterFullscreen();
                } else if (elem.msRequestFullscreen) {
                    console.log('Using msRequestFullscreen');
                    await elem.msRequestFullscreen();
                } else if (elem.mozRequestFullScreen) {
                    console.log('Using mozRequestFullScreen');
                    await elem.mozRequestFullScreen();
                } else {
                    console.warn('No fullscreen API available');
                    return;
                }

                // Check if fullscreen was actually entered
                setTimeout(() => {
                    const isInFullscreen = document.fullscreenElement ||
                                         document.webkitFullscreenElement ||
                                         document.msFullscreenElement ||
                                         document.mozFullScreenElement;

                    if (isInFullscreen) {
                        console.log('Browser fullscreen API succeeded');
                        isFullscreen = true;
                    } else {
                        console.log('Browser fullscreen API did not activate, CSS simulation will handle it');
                    }
                }, 200);

            } catch (error) {
                console.warn('Browser fullscreen request failed:', error);
                console.log('Relying on CSS fullscreen simulation');
            }
        }

        function simulateFullscreen() {
            console.log('Activating CSS fullscreen simulation');

            // Create fullscreen overlay if it doesn't exist
            let overlay = document.getElementById('exam-fullscreen-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'exam-fullscreen-overlay';
                overlay.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    background: transparent;
                    z-index: -1;
                    pointer-events: none;
                `;
                document.body.appendChild(overlay);
            }

            // Apply aggressive fullscreen styles
            document.body.style.cssText += `
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden !important;
                z-index: 10001 !important;
            `;

            // Hide html scrollbars and margins
            document.documentElement.style.cssText += `
                overflow: hidden !important;
                margin: 0 !important;
                padding: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
            `;

            // Hide all browser UI elements
            const style = document.createElement('style');
            style.id = 'exam-fullscreen-styles';
            style.textContent = `
                * {
                    -webkit-touch-callout: none !important;
                    -webkit-user-select: none !important;
                    -khtml-user-select: none !important;
                    -moz-user-select: none !important;
                    -ms-user-select: none !important;
                    user-select: none !important;
                }
                html, body {
                    cursor: default !important;
                }
                /* Hide browser UI */
                ::-webkit-scrollbar {
                    display: none !important;
                }
                /* Mobile specific */
                @media screen and (max-width: 768px) {
                    html, body {
                        -webkit-text-size-adjust: 100% !important;
                        -ms-text-size-adjust: 100% !important;
                    }
                }
            `;
            document.head.appendChild(style);

            isFullscreen = true;
            console.log('CSS fullscreen simulation activated successfully');

            // Force layout recalculation
            document.body.offsetHeight;
        }

        function exitSimulatedFullscreen() {
            console.log('Deactivating CSS fullscreen simulation');

            // Remove overlay
            const overlay = document.getElementById('exam-fullscreen-overlay');
            if (overlay) {
                overlay.remove();
            }

            // Remove custom styles
            const style = document.getElementById('exam-fullscreen-styles');
            if (style) {
                style.remove();
            }

            // Reset body styles
            document.body.style.cssText = '';
            document.body.removeAttribute('style');

            // Reset html styles
            document.documentElement.style.cssText = '';
            document.documentElement.removeAttribute('style');

            isFullscreen = false;
            console.log('CSS fullscreen simulation deactivated');
        }

        async function requestWakeLock() {
            try {
                if ('wakeLock' in navigator) {
                    wakeLock = await navigator.wakeLock.request('screen');
                    console.log('Wake lock activated');
                }
            } catch (error) {
                console.warn('Failed to request wake lock:', error);
            }
        }

        function releaseWakeLock() {
            if (wakeLock) {
                wakeLock.release();
                wakeLock = null;
                console.log('Wake lock released');
            }
        }

        function exitFullscreen() {
            try {
                const isBrowserFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || document.mozFullScreenElement;
                
                if (isBrowserFullscreen) {
                    if (document.exitFullscreen) {
                        const promise = document.exitFullscreen();
                        if (promise && typeof promise.catch === 'function') {
                            promise.catch(err => console.warn('Exit fullscreen caught:', err));
                        }
                    } else if (document.webkitExitFullscreen) {
                        document.webkitExitFullscreen();
                    } else if (document.msExitFullscreen) {
                        document.msExitFullscreen();
                    } else if (document.mozCancelFullScreen) {
                        document.mozCancelFullScreen();
                    }
                }
            } catch (error) {
                console.warn('Failed to exit fullscreen:', error);
            } finally {
                // Also exit simulated fullscreen
                try {
                    exitSimulatedFullscreen();
                } catch (e) {
                    console.warn('Failed to exit simulated fullscreen:', e);
                }
                isFullscreen = false;
            }
        }

        // Enhanced fullscreen change detection
        function checkFullscreenStatus() {
            // For CSS simulation, we don't need to check browser fullscreen state
            if (isFullscreen) {
                console.log('CSS fullscreen simulation is active');
                return;
            }

            const isInBrowserFullscreen = document.fullscreenElement ||
                                        document.webkitFullscreenElement ||
                                        document.msFullscreenElement ||
                                        document.mozFullScreenElement;

            if (isExamActive && !isInBrowserFullscreen) {
                console.log('Detected exit from browser fullscreen, attempting to restore');
                handleCheating('Keluar dari mode layar penuh');
                // Force back to fullscreen
                setTimeout(() => {
                    if (isExamActive) {
                        if (isMobileDevice()) {
                            requestMobileFullscreen();
                        } else {
                            requestFullscreen();
                        }
                    }
                }, 500);
            }
        }

        // Multiple event listeners for comprehensive fullscreen monitoring
        document.addEventListener('fullscreenchange', checkFullscreenStatus);
        document.addEventListener('webkitfullscreenchange', checkFullscreenStatus);
        document.addEventListener('mozfullscreenchange', checkFullscreenStatus);
        document.addEventListener('MSFullscreenChange', checkFullscreenStatus);

        // Additional checks for simulated fullscreen
        window.addEventListener('resize', () => {
            if (isExamActive && isFullscreen) {
                const currentWidth = window.innerWidth;
                const currentHeight = window.innerHeight;
                const screenWidth = window.screen.width;
                const screenHeight = window.screen.height;

                const widthDiff = Math.abs(currentWidth - screenWidth);
                const heightDiff = Math.abs(currentHeight - screenHeight);

                // ROBUST CHECK FOR MOBILE: Ignore height-only resize (keyboard/toolbar)
                if (isMobileDevice()) {
                    // On mobile, width is consistent. If width hasn't changed > 25px,
                    // we assume it's just the keyboard or browser UI toggling.
                    if (widthDiff <= 25) {
                        return; 
                    }
                }

                // More sensitive detection for exit attempts (Desktop or structural mobile changes)
                if (widthDiff > 20 || heightDiff > 20) {
                    console.log('Window resize detected during exam, possible fullscreen exit attempt');
                    console.log(`Size change: ${widthDiff}px width, ${heightDiff}px height`);
                    handleCheating('Perubahan ukuran jendela terdeteksi');
                    // Force restore fullscreen
                    setTimeout(() => {
                        if (isExamActive) {
                            simulateFullscreen(); // Use CSS simulation immediately
                        }
                    }, 200);
                }
            }
        });

        // Detect focus loss (alt+tab, clicking outside window, etc.)
        window.addEventListener('blur', () => {
            if (isExamActive && isFullscreen) {
                // On mobile, ignore blur if still full width
                if (isMobileDevice()) {
                    const widthDiff = Math.abs(window.innerWidth - window.screen.width);
                    if (widthDiff <= 25) return;
                }

                console.log('Window focus lost during exam');
                handleCheating('Fokus jendela hilang');
                // Force restore focus and fullscreen
                setTimeout(() => {
                    if (isExamActive) {
                        window.focus();
                        simulateFullscreen();
                    }
                }, 200);
            }
        });

        // Listen for page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (isExamActive && document.visibilityState === 'hidden') {
                handleCheating('Berpindah aplikasi/tab');
                // Try to bring back after a short delay
                setTimeout(() => {
                    if (isExamActive) {
                        if (isMobileDevice()) {
                            requestMobileFullscreen();
                        } else {
                            requestFullscreen();
                        }
                    }
                }, 300);
            }
        });

        // Returns the base URL for API calls.
        function getApiBaseUrl() {
            // Priority 1: User-defined remote server from settings
            const remote = localStorage.getItem(REMOTE_SERVER_KEY);
            if (remote && remote.trim()) {
                return remote.trim().replace(/\/$/, "");
            }

            // Priority 2: Direct file access (testing locally)
            if (window.location.protocol === 'file:') {
                return 'http://localhost:3000';
            }

            // Priority 3: Same origin (standard hosting)
            return '';
        }

        // IndexedDB helpers - persistent storage with much larger quotas than
        // localStorage.  We still write a timestamp into localStorage after a
        // successful IDB write so that other tabs can be notified via the
        // existing "storage" listener logic.
        function openIdb() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(IDB_DB_NAME, 1);
                req.onupgradeneeded = e => {
                    e.target.result.createObjectStore(IDB_STORE);
                };
                req.onsuccess = e => resolve(e.target.result);
                req.onerror = e => reject(e.target.error);
            });
        }
        async function idbGet(key) {
            const idb = await openIdb();
            return new Promise((res, rej) => {
                const tx = idb.transaction(IDB_STORE, 'readonly');
                const store = tx.objectStore(IDB_STORE);
                const r = store.get(key);
                r.onsuccess = () => res(r.result);
                r.onerror = () => rej(r.error);
            });
        }
        async function idbSet(key, value) {
            const idb = await openIdb();
            return new Promise((res, rej) => {
                const tx = idb.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                const r = store.put(value, key);
                r.onsuccess = () => res();
                r.onerror = () => rej(r.error);
            });
        }

        // read/write db via IDB, fallback to localStorage if IDB fails
        async function loadLocalDb() {
            try {
                const raw = await idbGet(DB_KEY);
                if (raw) return JSON.parse(raw);
            } catch (e) {
                console.warn('IDB load failed:', e.message || e);
            }
            try {
                const saved = localStorage.getItem(DB_KEY);
                return saved ? JSON.parse(saved) : null;
            } catch (e) {
                console.warn('Failed to read from localStorage:', e.message);
                return null;
            }
        }
        async function saveLocalDb() {
            try {
                await idbSet(DB_KEY, JSON.stringify(db));
            } catch (e) {
                console.warn('IDB save failed:', e.message || e);
            }
            try { localStorage.setItem(DB_KEY, Date.now()); } catch (e) { }
        }

        let db = {
            subjects: [{ name: "Pendidikan Agama", locked: false }, { name: "Bahasa Indonesia", locked: false }, { name: "Matematika", locked: false }, { name: "IPA", locked: false }, { name: "IPS", locked: false }, { name: "Bahasa Inggris", locked: false }],
            rombels: ["VII", "VIII", "IX"],
            questions: [],
            quizzes: [],
            students: [{ id: "ADM", password: "admin321", name: "Administrator", role: "admin" }],
            results: [],
            schedules: []
        };

        function normalizeDb(d) {
            if (!d || typeof d !== 'object') d = {};
            return {
                subjects: Array.isArray(d.subjects) ? d.subjects : [],
                rombels: Array.isArray(d.rombels) ? d.rombels : [],
                questions: Array.isArray(d.questions) ? d.questions : [],
                quizzes: Array.isArray(d.quizzes) ? d.quizzes : [],
                students: Array.isArray(d.students) ? d.students : [],
                results: Array.isArray(d.results) ? d.results : [],
                schedules: Array.isArray(d.schedules) ? d.schedules : [],
                timeLimits: d.timeLimits && typeof d.timeLimits === 'object' ? d.timeLimits : {}
            };
        }


        // helper used during initialization to merge results from two sources
        function mergeResults(localArr = [], serverArr = []) {
            const map = new Map();
            const makeKey = r => {
                if (!r || typeof r !== 'object') return JSON.stringify(r);
                if (r.id) return r.id;
                return `${r.studentId || ''}-${r.mapel || ''}-${r.rombel || ''}-${r.date || ''}`;
            };

            const getTimestamp = r => {
                if (!r || typeof r !== 'object') return 0;
                if (r.updatedAt) {
                    const t = Number(r.updatedAt);
                    if (!Number.isNaN(t) && t > 0) return t;
                }
                if (r.date) {
                    const d = Date.parse(r.date);
                    if (!Number.isNaN(d)) return d;
                }
                return 0;
            };

            const hasDetails = r => Array.isArray(r.questions) && r.questions.length > 0 && Array.isArray(r.answers);

            (Array.isArray(localArr) ? localArr : []).forEach(r => {
                const key = makeKey(r);
                map.set(key, r);
            });
            (Array.isArray(serverArr) ? serverArr : []).forEach(r => {
                const key = makeKey(r);
                if (!map.has(key)) {
                    map.set(key, r);
                    return;
                }
                const existing = map.get(key);
                const existingTs = getTimestamp(existing);
                const incomingTs = getTimestamp(r);

                if (incomingTs > existingTs) {
                    map.set(key, Object.assign({}, existing, r));
                    return;
                }
                if (incomingTs < existingTs) {
                    return;
                }

                // equal timestamp: maximize details and preserve deletion flag
                if (!existing.deleted && r.deleted) {
                    map.set(key, Object.assign({}, existing, r));
                } else if (existing.deleted && !r.deleted) {
                    map.set(key, Object.assign({}, existing, r));
                } else if (!hasDetails(existing) && hasDetails(r)) {
                    map.set(key, Object.assign({}, existing, r));
                }
            });
            return Array.from(map.values());
        }

        // when another tab updates the storage we want to re-read the database.
        window.addEventListener('storage', async e => {
            if (e.key !== DB_KEY) return;
            try {
                const other = await loadLocalDb();
                if (other) {
                    // Always sync results (merge them) to ensure score tracking is consistent
                    if (other.results) {
                        const merged = mergeResults(db.results, other.results);
                        db.results = merged;
                    }
                    
                    // For admin and teacher roles, we also want to sync configuration data
                    // so that setting a schedule in one tab reflects in others immediately.
                    const isManager = currentSiswa && (currentSiswa.role === 'admin' || currentSiswa.role === 'teacher');
                    
                    if (isManager) {
                        // Sync settings from other tab
                        if (other.subjects) db.subjects = other.subjects;
                        if (other.rombels) db.rombels = other.rombels;
                        if (other.students) db.students = other.students;
                        if (other.questions) db.questions = other.questions;
                        if (other.schedules) db.schedules = other.schedules;
                        if (other.timeLimits) db.timeLimits = other.timeLimits;
                        
                        updateStats();
                        updateCompletionCharts();
                        
                        // Re-render active admin sections if visible
                        if (document.getElementById('admin-results') && !document.getElementById('admin-results').classList.contains('hidden')) {
                            renderAdminResults();
                        }
                        if (document.getElementById('admin-overview') && !document.getElementById('admin-overview').classList.contains('hidden')) {
                            updateStats();
                        }
                    }
                }
            } catch (err) {
                console.warn('Error during storage sync:', err);
            }
        });

        let currentSiswa = null;
        let currentConfigType = "";
        let editQuestionIndex = null;
        let selectedAdminQuestions = new Set();
        let selectedTeacherQuestions = new Set();

        // --- AUTH ---
        function showLoginForm(type) {
            window.loginType = type;
            document.getElementById('auth-modal').classList.remove('hidden');
            document.getElementById('auth-modal').classList.add('flex');
        }

        // --- CORE FUNCTIONS ---
        function migrateRombels() {
            const legacyRombels = ['VII', 'VIII', 'IX'];
            const hasLegacy = db.rombels && db.rombels.some(r => legacyRombels.includes(r));

            if (hasLegacy) {
                console.log('[MIGRATION] Migrating rombels to Phase D format...');

                const mapping = {
                    'VII': 'Fase D (Kelas 7)',
                    'VIII': 'Fase D (Kelas 8)',
                    'IX': 'Fase D (Kelas 9)'
                };

                // Update db.rombels
                db.rombels = db.rombels.map(r => mapping[r] || r);
                // Ensure unique and sorted
                db.rombels = [...new Set(db.rombels)];

                // Update questions
                db.questions.forEach(q => {
                    if (mapping[q.rombel]) q.rombel = mapping[q.rombel];
                });

                // Update students
                db.students.forEach(s => {
                    if (mapping[s.rombel]) s.rombel = mapping[s.rombel];
                    if (s.role === 'teacher' && s.subjects) {
                        s.subjects.forEach(subj => {
                            if (subj.rombels) {
                                subj.rombels = subj.rombels.map(r => mapping[r] || r);
                            }
                        });
                    }
                    if (s.role === 'teacher' && s.rombels) {
                        s.rombels = s.rombels.map(r => mapping[r] || r);
                    }
                });

                // Update results
                db.results.forEach(r => {
                    if (mapping[r.rombel]) r.rombel = mapping[r.rombel];
                });

                // Update schedules
                if (db.schedules) {
                    db.schedules = db.schedules.map(k => {
                        const parts = k.split('|');
                        if (parts.length === 2 && mapping[parts[0]]) {
                            return `${mapping[parts[0]]}|${parts[1]}`;
                        }
                        return k;
                    });
                }

                // Update timeLimits (keys are usually stored as lowercase)
                if (db.timeLimits) {
                    const newLimits = {};
                    for (const k in db.timeLimits) {
                        let newKey = k;
                        for (const oldR in mapping) {
                            if (k.toLowerCase().startsWith(oldR.toLowerCase() + '|')) {
                                const subjectPart = k.split('|')[1] || '';
                                newKey = (mapping[oldR] + '|' + subjectPart).toLowerCase().trim();
                                break;
                            }
                        }
                        newLimits[newKey] = db.timeLimits[k];
                    }
                    db.timeLimits = newLimits;
                }

                saveLocalDb();
                console.log('[MIGRATION] Rombel migration complete.');
            }
        }

        function migrateQuestionTypes() {
            if (!Array.isArray(db.questions)) return;
            let changed = false;
            const mapping = {
                // Benar/Salah variants
                'boolean': 'tf',
                'benar_salah': 'tf',
                'true_false': 'tf',
                'bs': 'tf',
                // Matching variants
                'jodohkan': 'matching',
                'pasangkan': 'matching',
                'pairing': 'matching',
                'match': 'matching',
                // Essay variants
                'essay': 'text',
                'isian': 'text',
                'uraian': 'text',
                // PG variants
                'pg': 'single',
                'pilihan_ganda': 'single',
                'multiple_choice': 'single'
            };

            db.questions.forEach(q => {
                const oldType = String(q.type || 'single').toLowerCase().trim();
                if (mapping[oldType]) {
                    q.type = mapping[oldType];
                    changed = true;
                }
            });

            if (changed) {
                saveLocalDb();
                console.log('[MIGRATION] Question types normalized.');
            }
        }

        async function init() {
            const loginBtn = document.getElementById('login-btn');
            const loginBtnText = loginBtn ? loginBtn.innerHTML : '';
            if (loginBtn) {
                loginBtn.disabled = true;
                loginBtn.style.opacity = '0.7';
                loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Data...';
            }

            // Move migrateRombels() to run AFTER database is actually loaded.
            // SYNC: Fix any data consistency issues in results
            if (Array.isArray(db.results)) {
                db.results.forEach((result, idx) => {
                    // Ensure answers and questions arrays match in length
                    if (Array.isArray(result.questions) && Array.isArray(result.answers)) {
                        const qLen = result.questions.length;
                        const aLen = result.answers.length;
                        if (aLen < qLen) {
                            console.log(`Result ${idx}: Padding answers from ${aLen} to ${qLen}`);
                            while (result.answers.length < qLen) {
                                result.answers.push(null);
                            }
                        }
                        // Validate each question has required fields
                        result.questions.forEach((q, i) => {
                            if (!q || typeof q !== 'object') {
                                console.warn(`Result ${idx}, Question ${i}: Invalid structure`);
                            }
                        });
                    }
                });
            }

            // First, check if there's a saved session
            let savedSession = null;
            try {
                savedSession = localStorage.getItem(SESSION_KEY);
            } catch (e) {
                console.warn('localStorage not available for session check:', e.message);
            }
            if (savedSession) {
                try {
                    const session = JSON.parse(savedSession);
                    currentSiswa = session.user;
                } catch (e) {
                    console.warn('Invalid session format');
                }
            }

            // Then fetch DB
            try {
                const parsed = await loadLocalDb();
                if (parsed) db = normalizeDb(parsed);

                let res = await fetch(getApiBaseUrl() + '/api/db');
                if (!res.ok && (res.status === 404 || res.status === 0)) {
                    res = await fetch('database.json');
                    window.isStaticMode = true;
                    showStaticModeWarning();
                }

                if (res.ok) {
                    const serverDb = await res.json();
                    if (serverDb && serverDb.students) {
                        db = normalizeDb(serverDb);
                        console.log('Database synced with server:', db.students.length, 'students');
                    }
                }
            } catch (err) {
                console.error('Initialization error:', err);
            }

            // NOW run migration on the final loaded data
            migrateRombels();
            migrateQuestionTypes();

            // Re-enable login
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.style.opacity = '1';
                loginBtn.innerHTML = loginBtnText;
            }

            // Verify user still exists in database and sync with latest data
            if (currentSiswa) {
                const updatedUser = db.students.find(x => x.id === currentSiswa.id && x.password === currentSiswa.password);
                if (!updatedUser) {
                    console.warn('User from session not found in database or password mismatch, logging out');
                    clearSession();
                    window.location.href = 'index.html';
                    return;
                }
                
                // CRITICAL: Update session object to latest structure (migrated rombels/subjects)
                currentSiswa = updatedUser;
                window.currentSiswa = updatedUser;
                console.log('Session synchronized with latest database for:', currentSiswa.name);

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
                    if (stLabel) stLabel.innerText = `${currentSiswa.name} | ${currentSiswa.rombel}`;
                    if (typeof renderStudentExamList === 'function' && studentDash) renderStudentExamList();
                    
                    // Request fullscreen mode for student
                    if (typeof requestFullscreen === 'function') {
                        requestFullscreen();
                    }
                } else if (currentSiswa.role === 'teacher') {
                    const teacherDash = document.getElementById('teacher-dashboard');
                    if (teacherDash) teacherDash.classList.remove('hidden');
                    const tcLabel = document.getElementById('teacher-info-label');
                    if (tcLabel) tcLabel.innerText = `${currentSiswa.name} | Guru ${formatTeacherSubjects(currentSiswa)}`;
                    // Clear search input and API key input on initial load
                    const searchInput = document.getElementById('teacher-search-questions');
                    if (searchInput) searchInput.value = '';
                    const apiKeyInput = document.getElementById('new-api-key-input');
                    if (apiKeyInput) apiKeyInput.value = '';
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
        }

        function showLoginScreen() {
            const login = document.getElementById('login-screen');
            if (login) login.classList.remove('hidden');
            
            const admin = document.getElementById('admin-dashboard');
            if (admin) admin.classList.add('hidden');
            
            const student = document.getElementById('student-dashboard');
            if (student) student.classList.add('hidden');
            
            const teacher = document.getElementById('teacher-dashboard');
            if (teacher) teacher.classList.add('hidden');
            
            if (typeof closeModals === 'function') closeModals();
        }

        function showStudentInstructionModal() {
            const modal = document.getElementById('student-instruction-modal');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
        }

        function isMobileDevice() {
            return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                   window.innerWidth <= 768;
        }

        async function requestMobileFullscreen() {
            console.log('Attempting mobile fullscreen');
            try {
                // First try standard fullscreen
                await requestFullscreen();
            } catch (error) {
                console.warn('Standard fullscreen failed on mobile, trying alternatives:', error);
                // On mobile, fullscreen might not work, so we'll use CSS simulation
                simulateFullscreen();
                // Also try to hide browser UI
                if (window.navigator.standalone === false) {
                    // iOS Safari
                    window.scrollTo(0, 1);
                }
                if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
                    // PWA mode
                    console.log('Running in PWA mode');
                }
            }
        }

        function saveSession() {
            try {
                const session = {
                    user: currentSiswa,
                    timestamp: new Date().getTime()
                };
                localStorage.setItem(SESSION_KEY, JSON.stringify(session));
            } catch (e) {
                console.warn('Failed to save session to localStorage:', e.message);
            }
        }

        function clearSession() {
            if (currentSiswa && currentSiswa.role === 'student') {
                // offline flag handled earlier
                updateCompletionCharts();
            }
            currentSiswa = null;
            try {
                localStorage.removeItem(SESSION_KEY);
            } catch (e) {
                console.warn('Failed to clear session from localStorage:', e.message);
            }
        }

        // push a single result object to the server (lightweight endpoint)
        async function send_result_to_server(result) {
            const res = await fetch(getApiBaseUrl() + '/api/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result)
            });
            if (!res.ok) throw new Error(`server responded ${res.status}`);
        }

        async function sendResult(result) {
            // wrapper with retry logic similar to save(); if /api/result is
            // unavailable (404) we fall back to /api/results then /api/db.
            let success = false;
            let attempts = 3;
            while (attempts > 0 && !success) {
                try {
                    await send_result_to_server(result);
                    success = true;
                    break;
                } catch (e) {
                    const msg = e.message || '';
                    if (msg.includes('404')) {
                        console.warn('/api/result not found, using /api/results fallback');
                        const fallbackRes = await fetch(getApiBaseUrl() + '/api/results', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify([result])
                        });
                        if (fallbackRes.ok) {
                            success = true;
                            break;
                        }
                    }

                    try {
                        const dbRes = await fetch(getApiBaseUrl() + '/api/db', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ results: [result] })
                        });
                        if (dbRes.ok) {
                            success = true;
                            break;
                        }
                    } catch (dbErr) {
                        console.warn('Fallback /api/db error', dbErr.message || dbErr);
                    }

                    console.warn('sendResult error, retrying', msg);
                    attempts--;
                    if (attempts > 0) await new Promise(r => setTimeout(r, 500));
                }
            }
            if (!success) throw new Error('could not send result to server');
        }

/**
         * Generic save function that pushes the current 'db' state to the server and IndexedDB.
         * @param {Object} options Configuration for the save operation.
         * @param {boolean} options.refreshBeforeSave If true, fetches latest data from server 
         *                                           and merges local changes before pushing.
         * @param {boolean} options.forceServerSave If true, pushes to server even if the user is a student.
         */
        async function save(options = {}) {
            // Students should not overwrite the entire DB structure via /api/db 
            // as they may have stale caches that erase admin settings.
            // Their results are handled separately via sendResult().
            const isStudent = currentSiswa && currentSiswa.role === 'student';
            if (isStudent && !options.forceServerSave) {
                console.log('[SAVE] Skipping server push for student role. Local persistence only.');
                try {
                    await saveLocalDb();
                    updateStats();
                } catch (err) {
                    console.warn('LocalStorage save failed:', err.message || err);
                }
                return;
            }

            // OPTIONAL: Refresh from server before saving to avoid overwriting recent changes from other admins
            if (options.refreshBeforeSave) {
                try {
                    const res = await fetch(getApiBaseUrl() + '/api/db?t=' + Date.now());
                    if (res.ok) {
                        const serverDb = await res.json();
                        if (serverDb && serverDb.students) {
                            // Merge results from server to local state
                            if (serverDb.results) db.results = mergeResults(db.results, serverDb.results);
                            
                            // For other settings, we might want to keep some server-side updates
                            // but usually, if we are calling save(), the current local 'db' 
                            // contains the change we explicitly want to make.
                            // However, we should at least ensure we don't 'undo' other changes.
                            
                            // Update students, subjects, rombels if they look newer/different 
                            // (unless we are currently in that management screen - but app.js is single-state)
                            // For now, simpler: we fetch to ensure we have the latest results/state
                            // and let the local explicit change (like schedules) take precedence in the final POST.
                        }
                    }
                } catch (e) {
                    console.warn('Pre-save refresh failed, proceeding with local state:', e.message);
                }
            }

            // First send database to server; don’t let localStorage issues
            // block the network request.
            let serverSaveSuccess = false;
            let retries = 3;

            showToast('Menyimpan ke server...', 'info');
            while (retries > 0 && !serverSaveSuccess) {
                try {
                    // Images are now synced with server to fix broken images in Supabase cross-device.
                    const dbForServer = db;
                    const payload = JSON.stringify(dbForServer);
                    const sizeInMb = payload.length / (1024 * 1024);
                    console.log(`[SAVE] Payload size: ${sizeInMb.toFixed(2)} MB`);

                    // Vercel Serverless Function payload limit is 4.5MB
                    if (sizeInMb > 4.2) {
                        showToast(`Peringatan: Ukuran data (${sizeInMb.toFixed(2)}MB) hampir melebihi batas server (4.5MB).`, 'warning');
                    }

                    const res = await fetch(getApiBaseUrl() + '/api/db', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: payload
                    });

                    if (res.ok) {
                        serverSaveSuccess = true;
                        console.log('Database berhasil disimpan ke server');
                    } else {
                        console.warn(`Gagal menyimpan ke server (attempt ${4 - retries}):`, res.statusText);
                        retries--;
                        if (retries > 0) {
                            await new Promise(r => setTimeout(r, 500));
                        }
                    }
                } catch (err) {
                    console.warn(`Error saat menyimpan ke server (attempt ${4 - retries}):`, err.message || err);
                    retries--;
                    if (retries > 0) {
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }

            if (serverSaveSuccess) {
                showToast('Perubahan tersimpan ke server!', 'success');
            } else {
                console.error('PERINGATAN: Gagal menyimpan ke server setelah 3 percobaan!');
                showToast('Gagal menyimpan ke server! Periksa koneksi.', 'error');
            }

            try {
                await saveLocalDb();
            } catch (err) {
                console.warn('LocalStorage save failed:', err.message || err);
            }

            updateStats();
        }

        async function updateStats() {
            const subjects = Array.isArray(db?.subjects) ? db.subjects : [];
            const questions = Array.isArray(db?.questions) ? db.questions : [];
            const rombels = Array.isArray(db?.rombels) ? db.rombels : [];
            const students = Array.isArray(db?.students) ? db.students : [];
            const results = Array.isArray(db?.results) ? db.results : [];

            const ids = ['stat-subjects', 'stat-questions', 'stat-rombel', 'stat-students', 'stat-results'];
            const vals = [
                subjects.length,
                questions.length,
                rombels.length,
                students.filter(x => x.role !== 'admin').length,
                results.filter(r => !r.deleted).length
            ];
            ids.forEach((id, i) => { if (document.getElementById(id)) document.getElementById(id).innerText = vals[i]; });
            
            // Also update API stats in overview
            await updateAdminAPIStats();
        }

        async function updateAdminAPIStats() {
            const activeEl = document.getElementById('stat-api-active');
            const exhaustedEl = document.getElementById('stat-api-exhausted');
            
            if (!activeEl && !exhaustedEl) return;

            try {
                const res = await fetch(getApiBaseUrl() + '/api/admin/global-api-keys');
                const data = await res.json();
                
                if (data.ok) {
                    if (activeEl) activeEl.innerText = data.activeCount || 0;
                    if (exhaustedEl) exhaustedEl.innerText = data.exhaustedCount || 0;
                }
            } catch (err) {
                console.warn('Gagal membarui statistik API Admin:', err.message);
            }
        }

        function updateCompletionCharts() {
            const mappings = [
                { id: 'vii', name: 'Fase D (Kelas 7)' },
                { id: 'viii', name: 'Fase D (Kelas 8)' },
                { id: 'ix', name: 'Fase D (Kelas 9)' }
            ];
            mappings.forEach(m => {
                const canvasId = `completion-chart-${m.id}`;
                const legendId = `completion-legend-${m.id}`;
                const canvas = document.getElementById(canvasId);
                if (!canvas) return;
                const ctx = canvas.getContext('2d');

                // Get students in this rombel
                const studentsInRombel = db.students.filter(s => s.role === 'student' && s.rombel === m.name);
                const total = studentsInRombel.length;

                // Get students who have completed exams (have non-deleted results)
                const completed = studentsInRombel.filter(s =>
                    db.results.some(r => r.studentId === s.id && !r.deleted)
                ).length;
                const notCompleted = total - completed;

                const width = canvas.width;
                const height = canvas.height;
                ctx.clearRect(0, 0, width, height);
                if (total === 0) return;

                const centerX = width / 2;
                const centerY = height / 2;
                const radius = Math.min(width, height) / 2 - 10;
                let start = 0;
                const data = [completed, notCompleted];
                const colors = ['#10b981', '#ef4444']; // green for completed, red for not

                data.forEach((val, i) => {
                    const slice = val / total * 2 * Math.PI;
                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY);
                    ctx.arc(centerX, centerY, radius, start, start + slice);
                    ctx.closePath();
                    ctx.fillStyle = colors[i];
                    ctx.fill();
                    start += slice;
                });

                const legend = document.getElementById(legendId);
                if (legend) {
                    legend.innerHTML = `<span class="inline-block w-2 h-2 bg-green-500 rounded-full mr-1"></span>Selesai (${completed})<br>` +
                        `<span class="inline-block w-2 h-2 bg-red-500 rounded-full mr-1"></span>Belum (${notCompleted})`;
                }
            });
        }

        // Helpers for teacher subject/rombel management
        function teacherSubjectNames(teacher) {
            if (!teacher || !Array.isArray(teacher.subjects)) return [];
            return teacher.subjects.map(s => typeof s === 'string' ? s : s.name);
        }
        function teacherAllowedRombels(teacher, subjectName) {
            if (!teacher || !Array.isArray(teacher.subjects)) return [];
            const entry = teacher.subjects.find(s => (typeof s === 'string' ? s : s.name) === subjectName);
            if (!entry) return [];
            if (typeof entry === 'string') {
                return teacher.rombels || [];
            }
            return entry.rombels || [];
        }
        function formatTeacherSubjects(teacher) {
            return teacherSubjectNames(teacher).map(name => {
                const roms = teacherAllowedRombels(teacher, name);
                return roms.length ? `${name} (${roms.join(',')})` : name;
            }).join(', ');
        }
        function migrateTeacherData() {
            db.students.forEach(s => {
                if (s.role === 'teacher' && Array.isArray(s.subjects) && s.subjects.length &&
                    s.subjects.every(x => typeof x === 'string') && Array.isArray(s.rombels)) {
                    const roms = s.rombels.slice();
                    s.subjects = s.subjects.map(name => ({ name, rombels: roms.slice() }));
                    // keep top-level rombels as union for compatibility
                    // s.rombels = roms;
                }
            });
        }

        function teacherCombinedRombels(teacher) {
            if (!teacher || !Array.isArray(teacher.subjects)) return [];
            const set = new Set();
            teacher.subjects.forEach(s => {
                const roms = typeof s === 'string' ? (teacher.rombels || []) : (s.rombels || []);
                roms.forEach(r => set.add(r));
            });
            if (Array.isArray(teacher.rombels)) {
                teacher.rombels.forEach(r => set.add(r));
            }
            return Array.from(set);
        }

        async function fetchIPs() {
            try {
                const response = await fetch(getApiBaseUrl() + '/api/ips');
                if (!response.ok) throw new Error('Failed to fetch IPs');
                const ips = await response.json();
                const ipContainer = document.getElementById('accessible-ips');
                if (ips.length === 0) {
                    ipContainer.innerHTML = '<div class="text-slate-500">Tidak ada alamat IP yang dapat diakses</div>';
                } else {
                    ipContainer.innerHTML = ips.map(ip => `<div class="font-mono bg-slate-50 px-3 py-2 rounded-lg mb-2">http://${ip}:3000</div>`).join('');
                }
            } catch (error) {
                console.error('Error fetching IPs:', error);
                document.getElementById('accessible-ips').innerHTML = '<div class="text-red-500">Gagal memuat alamat IP</div>';
            }
        }

        // --- AUTH ---
        // showLoginForm moved to top

        function handleLogin() {
            const u = document.getElementById('username').value.trim().toUpperCase();
            const p = document.getElementById('password').value.trim();

            if (!db.students) {
                alert('Database belum siap. Silakan refresh halaman.');
                return;
            }

            // Coba cari berdasarkan ID yang tepat
            let user = db.students.find(x => x.id.toUpperCase() === u && x.password === p);

            // Jika tidak ditemukan, coba cari berdasarkan nama (untuk kemudahan)
            if (!user && window.loginType === 'student') {
                const nameSearch = u.toLowerCase();
                user = db.students.find(x =>
                    x.name.toLowerCase().includes(nameSearch) &&
                    x.password === p &&
                    x.role !== 'admin'
                );
            }

            if (user) {
                const roleMatch = (window.loginType === user.role);
                console.log('User found:', user.name, '| Role matches:', roleMatch);

                if (roleMatch) {
                    currentSiswa = user;
                    // For student updateCompletionCharts is used
                    if (user.role === 'student' && typeof updateCompletionCharts === 'function') updateCompletionCharts();
                    saveSession();

                    if (user.role === 'admin') window.location.href = 'admin.html';
                    else if (user.role === 'student') window.location.href = 'siswa.html';
                    else if (user.role === 'teacher') window.location.href = 'guru.html';
                } else {
                    console.log('Role mismatch - Expected:', window.loginType, 'Actual:', user.role);
                    showError(`Akun ini terdaftar sebagai ${user.role}. Silakan klik menu login yang sesuai.`);
                }
            } else {
                // Determine if ID exists but password fails, or ID missing
                const idMatch = db.students.find(x => x.id.toUpperCase() === u);
                if (idMatch) {
                    showError('ID ditemukan, tapi password salah. Coba lagi.');
                } else {
                    showError('ID atau Nama tidak ditemukan. Pastikan data sudah tersimpan di Admin.');
                }
            }
        }

        // attach login button listener once DOM ready to avoid reference errors
        document.addEventListener('DOMContentLoaded', () => {
            const btn = document.getElementById('login-btn');
            if (btn) btn.addEventListener('click', handleLogin);

            // Add Enter key support for login
            const usernameInput = document.getElementById('username');
            const passwordInput = document.getElementById('password');
            
            if (usernameInput) {
                usernameInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        handleLogin();
                    }
                });
            }
            
            if (passwordInput) {
                passwordInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        handleLogin();
                    }
                });
            }
        });

        function showError(customMsg) {
            const err = document.getElementById('login-error');
            const defaultRoleMsg = window.loginType === 'teacher' ? 'Password default: escrido123' : 'Password default: escrido';
            err.innerHTML = (customMsg || `ID atau password salah!`) + `<br><span class="text-[10px] opacity-70 mt-1 block tracking-tight">• ${defaultRoleMsg}</span>`;
            err.classList.remove('hidden');
        }

        function logout() {
            isExamActive = false;
            clearSession();
            window.location.href = 'index.html';
        }

        // --- IMPORT SISWA (NEW FEATURE) ---
        function openImportSiswaModal() {
            document.getElementById('import-siswa-area').value = "";
            document.getElementById('import-excel-file').value = null;
            document.getElementById('import-siswa-modal').classList.replace('hidden', 'flex');
        }

        function processImportSiswa() {
            const raw = document.getElementById('import-siswa-area').value.trim();
            if (!raw) return alert("Tempelkan data terlebih dahulu!");

            const rows = raw.split("\n");
            let count = 0;
            let errors = 0;

            rows.forEach(row => {
                // Mendeteksi pemisah tab (Excel default) atau spasi ganda
                let parts = row.split("\t");
                if (parts.length < 2) parts = row.split(/ {2,}/); // Fallback jika dipisah spasi banyak

                if (parts.length >= 2) {
                    const nama = parts[0].trim();
                    const rombel = parts[1].trim();

                    if (nama && rombel) {
                        // Generate ID sederhana dari nama + random suffix jika perlu
                        const baseId = "DRKS-" + Math.floor(1000 + Math.random() * 9000);

                        db.students.push({
                            id: baseId,
                            password: "escrido",
                            name: nama,
                            rombel: rombel,
                            role: "student"
                        });
                        count++;
                    }
                } else {
                    errors++;
                }
            });

            save();
            updateCompletionCharts();
            renderAdminStudents();
            closeModals();
            alert(`Berhasil mengimport ${count} siswa. ${errors > 0 ? errors + ' baris gagal diproses.' : ''}`);
        }

        // parse Excel file to textarea for import
        function handleExcelFile(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const wb = XLSX.read(data, { type: 'array' });
                    const firstSheet = wb.Sheets[wb.SheetNames[0]];
                    // convert to tab-delimited text, which matches processImportSiswa expectations
                    const csv = XLSX.utils.sheet_to_csv(firstSheet, { FS: '\t' });
                    document.getElementById('import-siswa-area').value = csv;
                } catch (err) {
                    alert('Gagal membaca file Excel: ' + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        }

        // --- STUDENT MANAGEMENT ---
        function openStudentModal() {
            populateSelects(['st-rombel']);
            document.getElementById('student-modal').classList.replace('hidden', 'flex');
        }

        function saveStudent() {
            const name = document.getElementById('st-name').value;
            const rombel = document.getElementById('st-rombel').value;
            if (!name) return alert("Nama harus diisi");

            const id = "DRKS-" + Math.floor(1000 + Math.random() * 9000);
            db.students.push({ id, password: "escrido", name, rombel, role: "student" });
            updateCompletionCharts();
            save();
            renderAdminStudents();
            closeModals();
        }

        function renderAdminStudents() {
            const tbody = document.getElementById('students-table-body');
            const filterSelect = document.getElementById('students-filter-rombel');
            const selectedRombel = filterSelect ? filterSelect.value : '';

            // populate filter options from available rombels (keep existing selection)
            if (filterSelect) {
                const current = filterSelect.value;
                filterSelect.innerHTML = '<option value="">Semua</option>' +
                    db.rombels.map(r => `<option value="${r}"${r === current ? ' selected' : ''}>${r}</option>`).join('');
            }

            let list = db.students.filter(x => x.role !== 'admin');
            if (selectedRombel) {
                list = list.filter(s => s.rombel === selectedRombel);
            }

            tbody.innerHTML = list.map(s => `
                <tr>
                    <td class="px-6 py-4 font-bold">${s.name}</td>
                    <td class="px-6 py-4 text-xs">${s.rombel}</td>
                    <td class="px-6 py-4"><span class="bg-slate-100 px-2 py-1 rounded font-mono text-xs">${s.id} / ${s.password}</span></td>
                    <td class="px-6 py-4 text-center">
                        <button onclick="resetStudentResults('${s.id}')" class="text-blue-400 hover:text-blue-600 mr-2" title="Reset Hasil Ujian"><i class="fas fa-sync-alt"></i></button>
                        <button onclick="deleteStudent('${s.id}')" class="text-red-400 hover:text-red-600" title="Hapus"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
        }

        function deleteStudent(id) {
            if (confirm("Hapus siswa ini?")) {
                db.students = db.students.filter(x => x.id !== id);
                updateCompletionCharts();
                save();
                renderAdminStudents();
            }
        }

        function resetStudentResults(studentId) {
            if (!confirm('Reset hasil ujian untuk siswa ini?')) return;
            let any = false;
            db.results = (db.results || []).map(r => {
                if (r.studentId === studentId && !r.deleted) {
                    any = true;
                    return { ...r, deleted: true, updatedAt: Date.now() };
                }
                return r;
            });
            if (!any) {
                alert('Tidak ada hasil ujian aktif untuk siswa ini.');
                return;
            }
            save();
            updateCompletionCharts();
            updateStats();
            renderAdminResults();
            renderAdminStudents();
            alert('Reset hasil ujian siswa berhasil.');
        }

        function generateStudentCardsPDF() {
            const list = db.students.filter(x => x.role !== 'admin');
            if (list.length === 0) return alert('Tidak ada siswa untuk dicetak.');
            const container = document.createElement('div');
            container.style.width = '210mm';
            container.style.padding = '3mm';
            container.style.display = 'grid';
            container.style.gridTemplateColumns = 'repeat(2, 1fr)';
            container.style.gap = '3mm';
            container.style.boxSizing = 'border-box';
            container.style.backgroundColor = '#f5f5f5';

            list.forEach(s => {
                const card = document.createElement('div');
                card.style.border = '2px solid #1a5490';
                card.style.borderRadius = '12px';
                card.style.padding = '14px';
                card.style.width = '100%';
                card.style.boxSizing = 'border-box';
                card.style.display = 'flex';
                card.style.flexDirection = 'column';
                card.style.fontFamily = 'Arial, sans-serif';
                card.style.backgroundColor = '#ffffff';
                card.style.minHeight = '173px';

                card.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: flex-start; gap: 6px; margin-bottom: 8px; padding-left: 4px;">
                        <img src="logo.png" alt="Logo" style="width: 40px; height: 40px; flex-shrink: 0; object-fit: contain;">
                        <div style="flex: 1; text-align: center;">
                            <div style="font-size: 14px; font-weight: bold; letter-spacing: 1px; color: #666;">KARTU TES</div>
                            <div style="font-size: 12px; font-weight: bold; color: #333;">SMP Kristen Dorkas</div>
                        </div>
                    </div>
                    <div style="border-top: 1px solid #ddd; padding-top: 8px; font-size: 11px; line-height: 1.8; color: #333;">
                        <div style="display: grid; grid-template-columns: 60px 1fr; gap: 5px;">
                            <span style="font-weight: bold; text-align: left;">Nama</span>
                            <span>: ${s.name}</span>
                        </div>
                        <div style="display: grid; grid-template-columns: 60px 1fr; gap: 5px;">
                            <span style="font-weight: bold; text-align: left;">Rombel</span>
                            <span>: ${s.rombel}</span>
                        </div>
                        <div style="display: grid; grid-template-columns: 60px 1fr; gap: 5px;">
                            <span style="font-weight: bold; text-align: left;">Username</span>
                            <span>: ${s.id}</span>
                        </div>
                        <div style="display: grid; grid-template-columns: 60px 1fr; gap: 5px;">
                            <span style="font-weight: bold; text-align: left;">Password</span>
                            <span>: ${s.password}</span>
                        </div>
                    </div>
                `;
                container.appendChild(card);
            });
            html2pdf().from(container).set({ margin: [1, 0, 1, 0], filename: 'kartu_akun_siswa.pdf', html2canvas: { scale: 2 }, pagebreak: { mode: 'avoid' }, format: 'a4', orientation: 'portrait' }).save();
        }

        // --- TEACHER QUESTION MANAGEMENT ---
        function openTeacherImportModal() {
            window.isTeacherMode = true;
            openImportModal();
        }

        function openTeacherQuestionModal() {
            window.isTeacherMode = true;
            editQuestionIndex = null;

            document.getElementById('q-text').value = '';
            document.getElementById('q-type').value = 'single';
            document.getElementById('q-mapel').value = teacherSubjectNames(currentSiswa)[0] || '';
            document.getElementById('q-image-file').value = '';
            // Clear multiple images preview
            document.getElementById('q-images-preview').innerHTML = '';
            document.getElementById('q-images-list').innerHTML = '';
            window.storedImages = [];
            document.getElementById('q-opts-container').innerHTML = '<input type="text" class="q-opt w-full p-3 bg-slate-50 rounded-xl text-sm border-none" placeholder="Opsi A"><input type="text" class="q-opt w-full p-3 bg-slate-50 rounded-xl text-sm border-none" placeholder="Opsi B"><input type="text" class="q-opt w-full p-3 bg-slate-50 rounded-xl text-sm border-none" placeholder="Opsi C"><input type="text" class="q-opt w-full p-3 bg-slate-50 rounded-xl text-sm border-none" placeholder="Opsi D">';
            document.getElementById('q-tf-container').innerHTML = '<div class="tf-row flex items-center gap-2"><input type="text" class="tf-statement flex-1 p-3 bg-slate-50 rounded-xl text-sm border-none" placeholder="Pernyataan"><select class="tf-correct p-3 bg-slate-50 rounded-xl text-sm border-none"><option value="">--Benar/Salah--</option><option value="true">Benar</option><option value="false">Salah</option></select><button type="button" onclick="removeTfRow(this)" class="text-red-500">&times;</button></div><button type="button" onclick="addTfRow()" class="mt-2 text-sm text-sky-600">+ Tambah Pernyataan</button>';
            document.getElementById('q-matching-container').innerHTML = '<div class="grid grid-cols-2 gap-4"><div><label class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Pertanyaan (Kiri)</label><div id="q-matching-questions" class="space-y-2"><div class="matching-q-row flex items-center gap-2"><input type="text" class="matching-question flex-1 p-3 bg-slate-50 rounded-xl text-sm border-none" placeholder="Pertanyaan 1"><button type="button" onclick="removeMatchingQRow(this)" class="text-red-500">&times;</button></div></div><button type="button" onclick="addMatchingQRow()" class="mt-2 text-sm text-sky-600">+ Tambah Pertanyaan</button></div><div><label class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Jawaban (Kanan)</label><div id="q-matching-answers" class="space-y-2"><div class="matching-a-row flex items-center gap-2"><input type="text" class="matching-answer flex-1 p-3 bg-slate-50 rounded-xl text-sm border-none" placeholder="Jawaban 1"><button type="button" onclick="removeMatchingARow(this)" class="text-red-500">&times;</button></div></div><button type="button" onclick="addMatchingARow()" class="mt-2 text-sm text-sky-600">+ Tambah Jawaban</button></div></div>';
            document.getElementById('save-question-btn').textContent = 'SIMPAN SOAL';
            window.isTeacherMode = true;
            editQuestionIndex = null;

            // Populate selects with filters
            populateSelects(['q-mapel', 'q-rombel']);

            // Filter for teacher mode
            const teacher = currentSiswa;
            if (teacher) {
                // Filter mapel
                const mapelSelect = document.getElementById('q-mapel');
                if (mapelSelect && teacher.subjects) {
                    const names = teacherSubjectNames(teacher);
                    mapelSelect.innerHTML = '<option value="">--Pilih Mapel--</option>' + names.map(n => `<option value="${n}">${n}</option>`).join('');
                }
                // Filter rombel
                const rombelSelect = document.getElementById('q-rombel');
                if (rombelSelect) {
                    const updateRombels = (chosenMapel) => {
                        let rombelsToUse;
                        if (chosenMapel) {
                            rombelsToUse = teacherAllowedRombels(teacher, chosenMapel);
                        } else {
                            rombelsToUse = teacher.rombels && teacher.rombels.length > 0 ? teacher.rombels : db.rombels;
                        }
                        rombelSelect.innerHTML = '<option value="">--Pilih Rombel--</option>' + rombelsToUse.map(r => `<option value="${r}">${r}</option>`).join('');
                    };
                    updateRombels(mapelSelect.value);
                    mapelSelect.addEventListener('change', () => updateRombels(mapelSelect.value));
                }
            }

            document.getElementById('question-modal').classList.replace('hidden', 'flex');
            updateQuestionTypeDisplay('single');
        }

        function saveTeacherQuestion() {
            const text = document.getElementById('q-text').value;
            const options = Array.from(document.querySelectorAll('.q-opt')).map(i => i.value);
            const mapel = document.getElementById('q-mapel').value;
            const rombel = document.getElementById('q-rombel').value;
            let imagesData = window.storedImages || [];
            window.storedImages = [];

            const type = document.getElementById('q-type').value;
            if (!text) return alert("Lengkapi pertanyaan!");
            if (!mapel || !teacherSubjectNames(currentSiswa).includes(mapel)) {
                alert('Pilih mata pelajaran yang Anda ajar!');
                return;
            }
            if (!rombel) {
                alert('Pilih rombel yang Anda ajar!');
                return;
            }
            const allowedRombels = teacherAllowedRombels(currentSiswa, mapel);
            if (!allowedRombels.includes(rombel)) {
                alert('Rombel tidak valid untuk mata pelajaran tersebut!');
                return;
            }

            let record = { text, mapel, rombel, type, images: imagesData };

            if (type === 'multiple') {
                if (options.some(o => !o)) return alert("Lengkapi semua pilihan!");
                const corr = activeCorrectMultiple.slice();
                if (corr.length < 2 || corr.length > 3) return alert('Pilih 2-3 jawaban benar untuk soal pilihan ganda kompleks!');
                record.options = options;
                record.correct = corr;
            } else if (type === 'text') {
                const ans = document.getElementById('q-answer-text').value.trim();
                if (!ans) return alert('Tuliskan jawaban esai yang benar!');
                record.correct = ans;
            } else if (type === 'tf') {
                const rows = Array.from(document.querySelectorAll('#q-tf-container .tf-row'));
                if (rows.length === 0) return alert('Tambahkan minimal satu pernyataan!');
                const stmts = [];
                const corrs = [];
                for (const r of rows) {
                    const stmt = r.querySelector('.tf-statement').value.trim();
                    const sel = r.querySelector('.tf-correct').value;
                    if (!stmt || sel === '') return alert('Lengkapi pernyataan dan pilih Benar/Salah!');
                    stmts.push(stmt);
                    corrs.push(sel === 'true');
                }
                record.options = stmts;
                record.correct = corrs;
            } else if (type === 'matching') {
                const qRows = Array.from(document.querySelectorAll('#q-matching-questions .matching-question'));
                const aRows = Array.from(document.querySelectorAll('#q-matching-answers .matching-answer'));
                const questions = qRows.map(inp => inp.value.trim()).filter(v => v);
                const answers = aRows.map(inp => inp.value.trim()).filter(v => v);
                if (questions.length === 0 || answers.length === 0) return alert('Tambahkan minimal satu pertanyaan dan satu jawaban!');
                if (questions.length !== answers.length) return alert('Jumlah pertanyaan dan jawaban harus sama!');
                record.questions = questions;
                record.answers = answers;
                record.correct = answers.slice(); // correct is the answers in order				
            } else {
                // single choice
                if (options.some(o => !o)) return alert("Lengkapi semua pilihan!");
                record.options = options;
                record.correct = activeCorrect;
            }

            if (editQuestionIndex !== null) {
                db.questions[editQuestionIndex] = record;
            } else {
                db.questions.push(record);
            }

            save();
            renderTeacherQuestions();
            closeModals();
            alert('Soal berhasil disimpan!');
        }
        function editTeacherQuestion(index) {
            try {
                if (index < 0 || index >= db.questions.length) {
                    alert('Soal tidak ditemukan!');
                    return;
                }
                window.isTeacherMode = true;
                openEditQuestionModal(index);

                // Override modal title and button text for teacher view
                const titleEl = document.getElementById('question-modal-title');
                const btnEl = document.getElementById('save-question-btn');
                const rombelEl = document.getElementById('q-rombel');
                if (titleEl) titleEl.textContent = 'Edit Soal';
                if (btnEl) btnEl.textContent = 'PERBARUI SOAL';

                // Disable rombel edit for teachers as it should remain consistent
                if (rombelEl) rombelEl.disabled = true;
            } catch (error) {
                console.error('Error in editTeacherQuestion:', error);
                alert('Terjadi kesalahan saat membuka edit soal: ' + error.message);
            }
        }

        function viewQuestion(index) {
            if (index < 0 || index >= db.questions.length) {
                alert('Soal tidak ditemukan!');
                return;
            }
            const q = db.questions[index];
            let msg = `Soal: ${q.text}\n\nType: ${q.type}\nMapel: ${q.mapel}\nRombel: ${q.rombel}\n\n`;
            if (q.type === 'single' || q.type === 'multiple') {
                msg += `Opsi: ${Array.isArray(q.options) ? q.options.join(', ') : ''}\n`;
                if (Array.isArray(q.correct)) {
                    msg += `Kunci: ${q.correct.map(i => ['A', 'B', 'C', 'D'][i]).join(', ')}`;
                } else {
                    msg += `Kunci: ${['A', 'B', 'C', 'D'][q.correct]}`;
                }
            } else if (q.type === 'tf') {
                msg += Array.isArray(q.options) ? q.options.map((s, i) => `${s}: ${Array.isArray(q.correct) && q.correct[i] ? 'Benar' : 'Salah'}`).join('\n') : '';
            } else if (q.type === 'matching') {
                const questions = Array.isArray(q.questions) ? q.questions : [];
                const answers = Array.isArray(q.answers) ? q.answers : [];
                msg += 'Pasangan:\n';
                questions.forEach((question, i) => {
                    msg += `${question} ⇔ ${answers[i] || '-'}\n`;
                });
            } else {
                msg += `Kunci: ${q.correct}`;
            }
            alert(msg);
        }

        function switchTeacherTab(tab) {
            const tabs = ['bank-soal', 'hasil-ujian', 'api-keys', 'quizz'];
            tabs.forEach(t => {
                const tabDiv = document.getElementById(`teacher-tab-${t}`);
                const tabBtn = document.getElementById(`tab-${t}`);
                if (t === tab) {
                    if (tabDiv) tabDiv.classList.remove('hidden');
                    if (tabBtn) {
                        tabBtn.classList.remove('text-slate-400', 'border-transparent');
                        tabBtn.classList.add('text-slate-700', 'border-amber-600');
                    }
                } else {
                    if (tabDiv) tabDiv.classList.add('hidden');
                    if (tabBtn) {
                        tabBtn.classList.add('text-slate-400', 'border-transparent');
                        tabBtn.classList.remove('text-slate-700', 'border-amber-600');
                    }
                }
            });

            if (tab === 'hasil-ujian') {
                renderTeacherResults();
                // begin polling server for new results if in teacher results tab
                if (teacherResultsPollInterval) clearInterval(teacherResultsPollInterval);
                teacherResultsPollInterval = setInterval(fetchAndMerge, 5000);
                // Stop API keys polling if it was running
                stopRealtimeStatsPolling();
            } else {
                if (teacherResultsPollInterval) {
                    clearInterval(teacherResultsPollInterval);
                    teacherResultsPollInterval = null;
                }
                if (tab === 'quizz') {
                    renderTeacherQuizz();
                } else if (tab === 'bank-soal') {
                    // Clear search input to prevent browser autocomplete from persisting values
                    const searchInput = document.getElementById('teacher-search-questions');
                    if (searchInput) searchInput.value = '';
                    renderTeacherQuestions();
                    // Stop API keys polling if it was running
                    stopRealtimeStatsPolling();
                } else if (tab === 'api-keys') {
                    // Clear API key input to prevent browser autocomplete from persisting values
                    const apiKeyInput = document.getElementById('new-api-key-input');
                    if (apiKeyInput) apiKeyInput.value = '';
                    renderTeacherAPIKeys();
                    // Start real-time API keys stats polling
                    startRealtimeStatsPolling();
                }
            }
        }


        // Render teacher exam results filtered by subject and rombel
        function renderTeacherResults() {
            const mapelSelect = document.getElementById('teacher-results-filter-mapel');
            const rombelSelect = document.getElementById('teacher-results-filter-rombel');
            const tbody = document.getElementById('teacher-results-table-body');

            if (!currentSiswa || !currentSiswa.subjects) {
                console.warn('[TEACHER] No active session or subjects found.');
                return;
            }

            // Populate mapel filter using normalized subject names
            if (mapelSelect) {
                const currentValue = mapelSelect.value;
                const teacherSubjects = teacherSubjectNames(currentSiswa);
                mapelSelect.innerHTML = '<option value="">Semua Mata Pelajaran</option>' +
                    teacherSubjects.map(name => {
                        return `<option value="${name}"${name === currentValue ? ' selected' : ''}>${name}</option>`;
                    }).join('');
            }

            // Populate rombel filter with all available rombels
            if (rombelSelect) {
                const currentValue = rombelSelect.value;
                const allRombels = db.rombels || [];
                const additionalOptions = allRombels.map(r =>
                    `<option value="${r}"${r === currentValue ? ' selected' : ''}>${r}</option>`
                ).join('');
                rombelSelect.innerHTML = '<option value="">Semua Rombel</option>' + additionalOptions;
            }

            // Filter results
            const selectedMapel = mapelSelect ? mapelSelect.value : '';
            const selectedRombel = rombelSelect ? rombelSelect.value : '';

            let results = db.results.filter(r => {
                // Filter out deleted results
                if (r.deleted) return false;

                // Filter by teacher's subjects
                if (!teacherSubjectNames(currentSiswa).includes(r.mapel)) return false;
                // also restrict by rombels assigned for that subject
                const allowed = teacherAllowedRombels(currentSiswa, r.mapel);
                if (!allowed.includes(r.rombel)) return false;

                // Filter by selected mapel
                if (selectedMapel && r.mapel !== selectedMapel) return false;

                // Filter by selected rombel
                if (selectedRombel && r.rombel !== selectedRombel) return false;

                return true;
            });

            // Sort results by date (newest first)
            // FIXED: use Date constructor for ISO strings
            results.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

            console.log(`[TEACHER] Rendering ${results.length} results.`);

            // Display results in table
            tbody.innerHTML = results.map((r) => {
                // Finding index in global db.results for detail view
                const resultIndex = db.results.indexOf(r);
                if (resultIndex === -1) return '';

                const hasEssay = Array.isArray(r.questions) && r.questions.some(q => q.type === 'text');
                const allEssayDone = hasEssay && Array.isArray(r.questions) &&
                    r.questions.every((q, qi) => q.type !== 'text' || (r.manualScores && r.manualScores[qi] !== undefined && r.manualScores[qi] !== null));
                const scoreDisplay = r.score != null && !isNaN(Number(r.score)) ? Number(r.score).toFixed(1) : '-';

                let aiBtn = '';
                if (hasEssay) {
                    if (allEssayDone) {
                        aiBtn = `<button onclick="batchAiCorrectEssay(${resultIndex})" id="ai-batch-btn-${resultIndex}" title="Koreksi ulang semua esai dengan AI" class="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-violet-100 hover:bg-violet-200 text-violet-700 text-[10px] font-black rounded-lg border border-violet-300 transition-all"><i class="fas fa-robot"></i> ✓ Koreksi Ulang</button>`;
                    } else {
                        aiBtn = `<button onclick="batchAiCorrectEssay(${resultIndex})" id="ai-batch-btn-${resultIndex}" title="Koreksi semua soal esai dengan AI" class="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-black rounded-lg transition-all shadow-sm"><i class="fas fa-magic"></i> Koreksi AI</button>`;
                    }
                }

                return `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="px-6 py-4 font-bold text-slate-700">${r.studentName}</td>
                    <td class="px-6 py-4 text-xs font-semibold text-slate-500">${r.rombel}</td>
                    <td class="px-6 py-4 text-xs font-bold text-sky-600 uppercase tracking-tighter">${r.mapel}</td>
                    <td class="px-6 py-4 text-[10px] font-medium text-slate-400">${r.date ? new Date(r.date).toLocaleString('id-ID') : '-'}</td>
                    <td class="px-6 py-4 text-center">
                        <span class="font-black text-sky-600 text-lg">${scoreDisplay}</span>
                        ${aiBtn}
                    </td>
                    <td class="px-6 py-4 text-center">
                        <button onclick="viewDetailedResult(${resultIndex})" class="w-8 h-8 rounded-lg bg-sky-50 text-sky-500 hover:bg-sky-100 transition-all shadow-sm mr-2" title="Lihat Jawaban"><i class="fas fa-eye"></i></button>
                        <button onclick="deleteResult(${resultIndex})" class="w-8 h-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-all shadow-sm" title="Hapus"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`;
            }).join('');

            if (results.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-12 text-center text-slate-400 italic">Belum ada hasil ujian yang sesuai filter</td></tr>';
            }
        }


        // --- SCHEDULE MANAGEMENT ---

        // --- TEACHER MANAGEMENT ---
        function renderTeacherSubjectCheckboxes() {
            const container = document.getElementById('teacher-subjects');
            if (!container) return;
            console.log('renderTeacherSubjectCheckboxes called, db.subjects:', db.subjects);

            const html = db.subjects.map((s, i) => {
                const name = typeof s === 'string' ? s : s.name;
                // build rombel checkboxes for this subject
                const rombCheckboxes = db.rombels.map(r =>
                    `<label class="flex items-center gap-1"><input type="checkbox" disabled class="teacher-rombel-checkbox w-4 h-4 text-amber-600 rounded focus:ring-2 focus:ring-amber-500" data-parent-subject="${name}" data-rombel="${r}" /> <span class="text-[11px]">${r}</span></label>`
                ).join('');
                return `<div class="p-3 bg-slate-50 rounded-xl border border-slate-100 mb-2">
                    <label class="flex items-center gap-3 cursor-pointer hover:bg-slate-100 rounded-lg transition-colors">
                        <input type="checkbox" class="teacher-subject-checkbox w-4 h-4 text-amber-600 rounded focus:ring-2 focus:ring-amber-500" data-subject="${name}" />
                        <span class="text-sm text-slate-700 font-medium">${name}</span>
                    </label>
                    <div class="mt-2 ml-6 flex flex-wrap gap-2 rombel-group">
                        ${rombCheckboxes}
                    </div>
                </div>`;
            }).join('');

            container.innerHTML = html;
            console.log('Checkboxes rendered, container HTML length:', html.length);

            // Add change listeners for subjects (could be used to auto-toggle rombels if desired)
            document.querySelectorAll('.teacher-subject-checkbox').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const subj = e.target.dataset.subject;
                    console.log('Subject checkbox changed:', subj, 'Checked:', e.target.checked);
                    // enable/disable rombel options for this subject
                    document.querySelectorAll(`.teacher-rombel-checkbox[data-parent-subject="${subj}"]`).forEach(rb => {
                        rb.disabled = !e.target.checked;
                        if (!e.target.checked) rb.checked = false;
                    });
                });
            });
            // rombel change listeners
            document.querySelectorAll('.teacher-rombel-checkbox').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    console.log('Rombel checkbox changed for', e.target.dataset.parentSubject, e.target.dataset.rombel, 'Checked:', e.target.checked);
                });
            });
        }

        function renderTeacherRombelCheckboxes() {
            // deprecated: rombel choices are now tied to each subject
            // kept for backwards compatibility but does nothing
        }

        function registerTeacher() {
            console.log('=== registerTeacher() called ===');
            const nameInput = document.getElementById('teacher-name');
            const idInput = document.getElementById('teacher-id');
            const passwordInput = document.getElementById('teacher-password');
            const checkedSubjects = document.querySelectorAll('.teacher-subject-checkbox:checked');

            console.log('Name Input:', { element: !!nameInput, value: nameInput?.value });
            console.log('ID Input:', { element: !!idInput, value: idInput?.value });
            console.log('Password Input:', { element: !!passwordInput, value: passwordInput?.value });
            console.log('Checked Subjects count:', checkedSubjects.length);

            const name = (nameInput?.value || '').trim();
            const id = (idInput?.value || '').toUpperCase().trim();
            const password = (passwordInput?.value || '').trim();

            // Build subject objects with rombels
            const selected = Array.from(checkedSubjects).map(cb => {
                const subj = cb.dataset.subject;
                const rombelBoxes = document.querySelectorAll(`.teacher-rombel-checkbox[data-parent-subject="${subj}"]:checked`);
                const rombels = Array.from(rombelBoxes).map(rb => rb.dataset.rombel);
                return { name: subj, rombels };
            });

            const combinedRombels = [...new Set(selected.flatMap(s => s.rombels))];

            console.log('Form data collected:', { name: name || '(empty)', id: id || '(empty)', password: password ? '***' : '(empty)', subjects: selected, rombels: combinedRombels });

            if (!name || !id || !password) {
                alert('Nama, ID, dan password harus diisi!');
                return;
            }
            if (selected.length === 0) {
                alert('Pilih minimal satu mata pelajaran!');
                return;
            }
            if (selected.some(s => s.rombels.length === 0)) {
                alert('Pilih rombel untuk setiap mata pelajaran!');
                return;
            }
            if (db.students.some(s => s.id.toUpperCase() === id)) {
                alert('ID sudah terdaftar!');
                return;
            }

            db.students.push({ id, password, name, role: 'teacher', subjects: selected, rombels: combinedRombels });
            save();
            document.getElementById('teacher-name').value = '';
            document.getElementById('teacher-id').value = '';
            document.getElementById('teacher-password').value = '';
            document.querySelectorAll('.teacher-subject-checkbox').forEach(cb => cb.checked = false);
            document.querySelectorAll('.teacher-rombel-checkbox').forEach(cb => cb.checked = false);
            renderTeachersList();
            alert('Guru ' + name + ' berhasil didaftarkan!');
        }

        function renderTeachersList() {
            const tbody = document.getElementById('teachers-table-body');
            const teachers = db.students.filter(s => s.role === 'teacher');
            tbody.innerHTML = teachers.map(t => `
                <tr>
                    <td class="px-6 py-4 font-bold">${t.name}</td>
                    <td class="px-6 py-4 text-xs">${t.id}</td>
                    <td class="px-6 py-4 text-sm">${(t.subjects || []).map(s => typeof s === 'string' ? s : `${s.name} (${(s.rombels || []).join(', ')})`).join(', ')}</td>
                    <td class="px-6 py-4 text-sm">${(t.rombels || []).join(', ')}</td>
                    <td class="px-6 py-4 text-center">
                        <button onclick="deleteTeacher('${t.id}')" class="text-red-400 hover:text-red-600">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
        }

        function deleteTeacher(id) {
            if (confirm('Hapus guru ini?')) {
                db.students = db.students.filter(s => s.id !== id);
                save();
                renderTeachersList();
            }
        }

        function renderTeacherQuestions() {
            const filterSelect = document.getElementById('teacher-filter-mapel');
            const rombelSelect = document.getElementById('teacher-filter-rombel');
            const searchTerm = document.getElementById('teacher-search-questions')?.value?.toLowerCase() || '';
            const selectedSubject = filterSelect ? filterSelect.value : '';
            const selectedRombel = rombelSelect ? rombelSelect.value : '';
            const tbody = document.getElementById('teacher-questions-table-body');
            const selectAllCheckbox = document.getElementById('teacher-select-all-checkbox');

            // Populate mapel filter with normalized subject list
            if (filterSelect && currentSiswa && currentSiswa.role === 'teacher') {
                const current = filterSelect.value;
                const teacherSubjects = teacherSubjectNames(currentSiswa);
                filterSelect.innerHTML = '<option value="">Semua</option>' +
                    teacherSubjects.map(name => `<option value="${name}"${name === current ? ' selected' : ''}>${name}</option>`).join('');
            }
            // Populate rombel filter depending on selected subject or combined rombels
            if (rombelSelect && currentSiswa && currentSiswa.role === 'teacher') {
                const current = rombelSelect.value;
                let rombels = [];
                if (selectedSubject) {
                    rombels = teacherAllowedRombels(currentSiswa, selectedSubject);
                } else {
                    rombels = teacherCombinedRombels(currentSiswa);
                }
                rombelSelect.innerHTML = '<option value="">Semua Rombel</option>' +
                    rombels.map(r => `<option value="${r}"${r === current ? ' selected' : ''}>${r}</option>`).join('');
            }

            if (!currentSiswa || !currentSiswa.subjects) return;

            let list = db.questions.filter(q => {
                const qSubject = q.mapel;
                if (!qSubject) return false;
                const qSubjectName = typeof qSubject === 'string' ? qSubject : qSubject.name || qSubject;
                
                const tSubjects = teacherSubjectNames(currentSiswa);
                if (!tSubjects.includes(qSubjectName)) return false;
                
                const allowed = teacherAllowedRombels(currentSiswa, qSubjectName);
                
                // Use robust comparison (trim and string conversion) to avoid mismatch
                const qRombel = String(q.rombel || '').trim();
                const isAllowed = allowed.some(a => String(a).trim() === qRombel);
                
                if (!isAllowed) return false;
                return true;
            });


            if (selectedSubject) {
                list = list.filter(q => {
                    const qSubject = typeof q.mapel === 'string' ? q.mapel : q.mapel.name || q.mapel;
                    return qSubject === selectedSubject;
                });
            }
            if (selectedRombel) {
                list = list.filter(q => q.rombel === selectedRombel);
            }
            if (searchTerm) {
                list = list.filter(q => q.text.toLowerCase().includes(searchTerm));
            }

            const allSelected = list.length > 0 && list.every(q => selectedTeacherQuestions.has(q));
            if (selectAllCheckbox) selectAllCheckbox.checked = allSelected;

            tbody.innerHTML = list.map((q, i) => {
                const subject = typeof q.mapel === 'string' ? q.mapel : q.mapel.name || q.mapel;
                const actualIndex = db.questions.indexOf(q);
                let typeName = { 'single': 'Pilihan Ganda', 'multiple': 'PG Kompleks', 'text': 'Uraian', 'tf': 'Benar/Salah', 'matching': 'Menjodohkan' }[q.type || 'single'] || 'Pilihan Ganda';

                let corrText = '';
                if (q.type === 'multiple') {
                    corrText = (Array.isArray(q.correct) ? q.correct.map(x => ['A', 'B', 'C', 'D'][x]).join(',') : q.correct);
                } else if (q.type === 'text') {
                    corrText = 'Teks';
                } else if (q.type === 'tf') {
                    if (Array.isArray(q.options)) {
                        corrText = q.options.map((stmt, j) => {
                            const val = Array.isArray(q.correct) ? q.correct[j] : false;
                            return `${stmt} (${val ? 'Benar' : 'Salah'})`;
                        }).join(' / ');
                    } else {
                        corrText = 'Benar/Salah';
                    }
                } else if (q.type === 'matching') {
                    corrText = 'Match';
                } else {
                    corrText = ['A', 'B', 'C', 'D'][q.correct];
                }

                return `<tr>
                    <td class="px-6 py-4 text-center">
                        <input type="checkbox" id="teacher-select-${actualIndex}" data-index="${actualIndex}" class="rounded border-slate-300 text-sky-600 focus:ring-sky-500" ${selectedTeacherQuestions.has(q) ? 'checked' : ''} onclick="toggleTeacherQuestionSelection(event)">
                    </td>
                    <td class="px-6 py-4 text-center">
                        <div class="flex items-center justify-center gap-2">
                            <span class="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">${actualIndex + 1}</span>
                            <div class="flex flex-col gap-1">
                                <button type="button" onclick="moveQuestionUp(${actualIndex})" class="text-slate-400 hover:text-slate-600 text-xs p-1 rounded hover:bg-slate-100 transition-colors ${actualIndex === 0 ? 'opacity-50 cursor-not-allowed' : ''}" ${actualIndex === 0 ? 'disabled' : ''}><i class="fas fa-chevron-up"></i></button>
                                <button type="button" onclick="moveQuestionDown(${actualIndex})" class="text-slate-400 hover:text-slate-600 text-xs p-1 rounded hover:bg-slate-100 transition-colors ${actualIndex === db.questions.length - 1 ? 'opacity-50 cursor-not-allowed' : ''}" ${actualIndex === db.questions.length - 1 ? 'disabled' : ''}><i class="fas fa-chevron-down"></i></button>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4">
                        <div style="word-wrap: break-word; white-space: pre-wrap; max-width: none;" class="font-bold mb-1">${q.text}</div>
                        ${q.type === 'tf' && Array.isArray(q.options) && q.options.length > 0 ? `
                            <div class="mt-2 pl-3 border-l-2 border-sky-200 space-y-1">
                                ${q.options.map((opt, idx) => `<div class="text-xs text-slate-600"><span class="font-bold text-sky-600 mr-1">${idx + 1}.</span> ${opt}</div>`).join('')}
                            </div>
                        ` : ''}
                        ${(q.images && Array.isArray(q.images) && q.images.length > 0) ? `<div class="flex items-center gap-1 mt-1"><i class="fas fa-images text-xs text-sky-500"></i><span class="text-xs text-sky-600">${q.images.length} gambar</span></div>` : (q.image ? '<div class="flex items-center gap-1 mt-1"><i class="fas fa-image text-xs text-slate-400"></i><span class="text-xs text-slate-500">1 gambar</span></div>' : '')}
                    </td>
                    <td class="px-6 py-4">
                        <div class="flex flex-col gap-1 items-start">
                            <span class="px-3 py-1 bg-sky-100 text-sky-700 rounded-full text-[10px] font-bold text-center inline-block">${subject}</span>
                            <span class="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-bold text-center inline-block">${q.rombel}</span>
                        </div>
                    </td>
                    <td class="px-6 py-4">
                        <span style="word-wrap: break-word; white-space: pre-wrap; max-width: none; font-weight: bold; color: #0369a1; font-size: 0.875rem;">${corrText}</span>
                    </td>
                    <td class="px-6 py-4">
                        <span class="inline-flex items-center justify-center px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold whitespace-nowrap">${typeName}</span>
                    </td>
                    <td class="px-6 py-4 text-center flex gap-1 justify-center">
                        <button type="button" class="p-2 text-sky-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" onclick="viewQuestion(${actualIndex})" title="Lihat">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button type="button" class="p-2 text-amber-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" onclick="editTeacherQuestion(${actualIndex})" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button type="button" class="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" onclick="deleteQuestion(${actualIndex})" title="Hapus">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>`;
            }).join('');

            if (list.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-12 text-center text-slate-500 text-sm">Tidak ada soal ditemukan.</td></tr>`;
            }
        }

        function toggleTeacherQuestionSelection(event) {
            const idx = Number(event.target.dataset.index);
            if (Number.isNaN(idx)) return;
            const question = db.questions[idx];
            if (!question) return;
            if (event.target.checked) {
                selectedTeacherQuestions.add(question);
            } else {
                selectedTeacherQuestions.delete(question);
            }
            renderTeacherQuestions();
        }

        function toggleTeacherSelectAll(event) {
            const checked = event.target.checked;
            const selectedSubject = document.getElementById('teacher-filter-mapel')?.value || '';
            const selectedRombel = document.getElementById('teacher-filter-rombel')?.value || '';
            let list = db.questions.filter(q => {
                const qSubject = q.mapel;
                if (!qSubject) return false;
                const qSubjectName = typeof qSubject === 'string' ? qSubject : qSubject.name || qSubject;
                if (!teacherSubjectNames(currentSiswa).includes(qSubjectName)) return false;
                const allowed = teacherAllowedRombels(currentSiswa, qSubjectName);
                if (!allowed.includes(q.rombel)) return false;
                return true;
            });
            if (selectedSubject) {
                list = list.filter(q => {
                    const qSubject = typeof q.mapel === 'string' ? q.mapel : q.mapel.name || q.mapel;
                    return qSubject === selectedSubject;
                });
            }
            if (selectedRombel) {
                list = list.filter(q => q.rombel === selectedRombel);
            }
            if (checked) {
                list.forEach(q => selectedTeacherQuestions.add(q));
            } else {
                list.forEach(q => selectedTeacherQuestions.delete(q));
            }
            renderTeacherQuestions();
        }

        function deleteSelectedTeacherQuestions() {
            if (selectedTeacherQuestions.size === 0) {
                return alert('Pilih soal yang ingin dihapus terlebih dahulu.');
            }
            if (!confirm(`Hapus ${selectedTeacherQuestions.size} soal terpilih?`)) return;
            db.questions = db.questions.filter(q => !selectedTeacherQuestions.has(q));
            selectedTeacherQuestions.clear();
            save();
            renderTeacherQuestions();
        }
        // --- TEACHER QUESTION MANAGEMENT ---
        function openScheduleModal() {
            renderScheduleChecklist();
            document.getElementById('schedule-modal').classList.replace('hidden', 'flex');
        }

        function renderScheduleChecklist() {
            const container = document.getElementById('schedule-checklist');
            if (!container) return;

            const schedules = db.schedules || [];
            const checklistHTML = db.rombels.map(rombel => {
                return db.subjects.map(subject => {
                    const subjectName = getSubjectName(subject);
                    const key = `${rombel}|${subjectName}`;
                    const isChecked = schedules.includes(key);
                    return `
                        <label class="flex items-center p-4 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-all border-2 ${isChecked ? 'border-purple-500 bg-purple-50' : 'border-slate-100'}">
                            <input type="checkbox" class="schedule-checkbox" data-key="${key}" ${isChecked ? 'checked' : ''} />
                            <span class="ml-3 font-bold text-slate-700">${rombel} - ${subjectName}</span>
                        </label>
                    `;
                }).join('');
            }).join('');

            container.innerHTML = checklistHTML;
        }

        async function saveSchedules() {
            const checkboxes = document.querySelectorAll('.schedule-checkbox:checked');
            const newSchedules = Array.from(checkboxes).map(cb => cb.dataset.key);
            
            // Apply changes to local state
            db.schedules = newSchedules;
            
            // Save with mandatory refresh from server first to prevent overwriting other admins
            await save({ refreshBeforeSave: true });
            
            closeModals();
            alert('Jadwal akses tersimpan!');
        }

        function openTimeLimitModal() {
            renderTimeLimitList();
            document.getElementById('time-limit-modal').classList.replace('hidden', 'flex');
        }

        function renderTimeLimitList() {
            const container = document.getElementById('time-limit-list');
            if (!container) return;

            const timeLimits = db.timeLimits || {};
            const listHTML = db.rombels.map(rombel => {
                return db.subjects.map(subject => {
                    const subjectName = getSubjectName(subject);
                    const key = `${rombel}|${subjectName}`.toLowerCase().trim();
                    const currentTime = timeLimits[key] || 60; // default 60 menit
                    return `
                        <div class="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                            <span class="font-bold text-slate-700">${rombel} - ${subjectName}</span>
                            <div class="flex items-center gap-2">
                                <input type="number" class="time-limit-input w-16 px-2 py-1 border border-slate-300 rounded text-center" data-key="${key}" value="${currentTime}" min="1" max="300" />
                                <span class="text-sm text-slate-500">menit</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }).join('');

            container.innerHTML = listHTML;
        }

        async function saveTimeLimits() {
            const inputs = document.querySelectorAll('.time-limit-input');
            const newTimeLimits = {};
            inputs.forEach(input => {
                const key = input.dataset.key;
                const value = parseInt(input.value) || 60;
                newTimeLimits[key] = value;
            });
            console.log('Saving timeLimits:', newTimeLimits);
            
            db.timeLimits = newTimeLimits;
            
            // Save with refresh
            await save({ refreshBeforeSave: true });
            
            closeModals();
            alert('Waktu pengerjaan tersimpan!');
        }

        // --- UI HELPERS ---
        let resultsPollInterval = null;
        let teacherResultsPollInterval = null;
        let adminStatsPollInterval = null;

        async function fetchAndMerge() {
            try {
                // Modified: Fetch results directly from /api/results instead of /api/db
                // This matches server.js structure where results are stored separately.
                const res = await fetch(getApiBaseUrl() + '/api/results');
                if (res.ok) {
                    const serverResults = await res.json();
                    if (Array.isArray(serverResults)) {
                        const merged = mergeResults(db.results, serverResults);
                        const dbJson = JSON.stringify(db.results || []);
                        const mergedJson = JSON.stringify(merged || []);
                        if (mergedJson !== dbJson) {
                            db.results = merged;
                            console.log(`[SYNC] Results updated from server. New count: ${db.results.length}`);
                            updateStats();
                            // persist new merged data locally; this way reloading the
                            // admin UI while offline still shows the most recent
                            // scores fetched from the server.
                            try {
                                await saveLocalDb();
                            } catch (e) {
                                console.warn('Could not save merged results locally:', e.message || e);
                            }

                            // Update Admin View
                            if (document.getElementById('admin-results') && !document.getElementById('admin-results').classList.contains('hidden')) {
                                renderAdminResults();
                            }

                            // Update Teacher View if active
                            if (document.getElementById('teacher-dashboard') &&
                                !document.getElementById('teacher-dashboard').classList.contains('hidden')) {
                                if (typeof renderTeacherResults === 'function') renderTeacherResults();
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('fetchAndMerge failed: Connection to server failed. Please check your network or server URL.');
            }
        }

        function saveRemoteServer() {
            const url = document.getElementById('set-remote-url').value.trim();
            if (url) {
                localStorage.setItem(REMOTE_SERVER_KEY, url);
                alert('URL Server tersimpan! Halaman akan dimuat ulang.');
                setTimeout(() => location.reload(), 1000);
            }
        }

        function clearRemoteServer() {
            localStorage.removeItem(REMOTE_SERVER_KEY);
            document.getElementById('set-remote-url').value = '';
            alert('URL Server dihapus! Kembali ke default.');
            setTimeout(() => location.reload(), 1000);
        }

        function showAdminSection(sec) {
            document.querySelectorAll('.admin-section').forEach(s => s.classList.add('hidden'));
            document.getElementById('admin-' + sec).classList.remove('hidden');
            document.querySelectorAll('.nav-link').forEach(l => {
                l.classList.remove('bg-sky-600', 'text-white');
                if (l.dataset.section === sec) l.classList.add('bg-sky-600', 'text-white');
            });

            if (sec === 'banksoal') { populateSelects(['filter-mapel', 'filter-rombel'], true); renderAdminQuestions(); }
            if (sec === 'rombel') { renderRombelSection(); }
            if (sec === 'students') renderAdminStudents();
            if (sec === 'quizz') renderAdminQuizz();
            if (sec === 'results') {
                populateSelects(['results-filter-rombel', 'results-filter-mapel'], true);
                renderAdminResults();
                // Immediately fetch fresh results from server, then poll every 5s
                fetchAndMerge();
                if (resultsPollInterval) clearInterval(resultsPollInterval);
                resultsPollInterval = setInterval(fetchAndMerge, 5000);
            } else {
                if (resultsPollInterval) { clearInterval(resultsPollInterval); resultsPollInterval = null; }
            }
            if (sec === 'raport') {
                populateRaportFilters();
                renderRaport();
            }
            if (sec === 'overview') {
                updateStats();
                fetchIPs();
                if (adminStatsPollInterval) clearInterval(adminStatsPollInterval);
                adminStatsPollInterval = setInterval(updateStats, 5000);
            } else {
                if (adminStatsPollInterval) {
                    clearInterval(adminStatsPollInterval);
                    adminStatsPollInterval = null;
                }
            }
            if (sec === 'settings') {
                const admin = db.students.find(x => x.role === 'admin');
                document.getElementById('set-admin-id').value = admin.id;
                renderTeacherSubjectCheckboxes();
                renderTeachersList();
                // Populate remote URL input from localStorage
                const remoteUrlInput = document.getElementById('set-remote-url');
                if (remoteUrlInput) {
                    remoteUrlInput.value = localStorage.getItem(REMOTE_SERVER_KEY) || '';
                }
            }
        }

        function renderRombelSection() {
            const mapelList = document.getElementById('mapel-list');
            const rombelList = document.getElementById('rombel-list');

            mapelList.innerHTML = db.subjects.map(s => {
                const name = getSubjectName(s);
                return `
                    <div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                        <span class="font-bold text-slate-700">${name}</span>
                        <button onclick="deleteMapel('${name}')" class="text-red-400 hover:text-red-600"><i class="fas fa-trash"></i></button>
                    </div>
                `;
            }).join('');

            rombelList.innerHTML = db.rombels.map(r => `
                <div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                    <span class="font-bold text-slate-700">${r}</span>
                    <button onclick="deleteRombel('${r}')" class="text-red-400 hover:text-red-600"><i class="fas fa-trash"></i></button>
                </div>
            `).join('');
            updateCompletionCharts();
        }

        function deleteMapel(name) {
            if (confirm(`Hapus mata pelajaran "${name}"?`)) {
                db.subjects = db.subjects.filter(s => getSubjectName(s) !== name);
                save();
                renderRombelSection();
            }
        }

        function deleteRombel(name) {
            if (confirm(`Hapus rombel "${name}"?`)) {
                db.rombels = db.rombels.filter(r => r !== name);
                save();
                renderRombelSection();
            }
        }

        // toggle mobile menu visibility
        function toggleMobileMenu() {
            const menu = document.getElementById('mobile-menu');
            if (menu) menu.classList.toggle('hidden');
        }

        function getSubjectName(subject) {
            return typeof subject === 'string' ? subject : subject.name;
        }

        function populateSelects(ids, includeAll = false) {
            ids.forEach(id => {
                const el = document.getElementById(id); if (!el) return;
                const list = id.includes('mapel') ? db.subjects : db.rombels;
                let html = includeAll ? `<option value="ALL">SEMUA</option>` : '';
                html += list.map(item => {
                    const val = id.includes('mapel') ? getSubjectName(item) : item;
                    const display = id.includes('mapel') ? getSubjectName(item) : item;
                    return `<option value="${val}">${display}</option>`;
                }).join('');
                el.innerHTML = html;
            });
        }

        function populateRaportFilters() {
            const rombelSelect = document.getElementById('raport-filter-rombel');
            const siswaSelect = document.getElementById('raport-filter-siswa');
            if (rombelSelect) {
                const rombels = Array.isArray(db.rombels) ? db.rombels : [];
                rombelSelect.innerHTML = '<option value="ALL">Semua Rombel</option>' + rombels.map(r => `<option value="${r}">${r}</option>`).join('');
            }
            updateRaportSiswaFilter('ALL');
        }

        function updateRaportSiswaFilter(selectedRombel) {
            const siswaSelect = document.getElementById('raport-filter-siswa');
            if (!siswaSelect) return;
            
            let students = Array.isArray(db.students) ? db.students.filter(s => s.role === 'student') : [];
            
            if (selectedRombel && selectedRombel !== 'ALL') {
                students = students.filter(s => s.rombel === selectedRombel);
            }
            
            students = students.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            
            const showRombel = selectedRombel === 'ALL';
            siswaSelect.innerHTML = '<option value="ALL">Semua Siswa</option>' + students.map(s => `<option value="${s.id}">${s.name}${showRombel ? ` (${s.rombel || '-'})` : ''}</option>`).join('');
            
            // Reset siswa selection to ALL if current selection is not in the filtered list
            const currentSiswa = siswaSelect.value;
            if (currentSiswa !== 'ALL' && !students.some(s => s.id === currentSiswa)) {
                siswaSelect.value = 'ALL';
            }
        }

        // --- QUESTION MANAGEMENT ---
        let currentQType = 'single';
        let activeCorrect = 0;
        let activeCorrectMultiple = [];

        function addTfRow() {
            const container = document.getElementById('q-tf-container');
            if (!container) return;

            const row = document.createElement('div');
            row.className = 'tf-row flex items-center gap-2';
            row.innerHTML = `
                <input type="text" class="tf-statement flex-1 p-3 bg-slate-50 rounded-xl text-sm border-none" placeholder="Pernyataan">
                <select class="tf-correct p-3 bg-slate-50 rounded-xl text-sm border-none">
                    <option value="">--Benar/Salah--</option>
                    <option value="true">Benar</option>
                    <option value="false">Salah</option>
                </select>
                <button type="button" onclick="removeTfRow(this)" class="text-red-500">&times;</button>
            `;

            // Find the add button (has addTfRow in onclick)
            const addButton = container.querySelector('button[onclick*="addTfRow"]');
            if (addButton) {
                container.insertBefore(row, addButton);
            } else {
                // Fallback: just append to container
                container.appendChild(row);
            }
        }

        function removeTfRow(btn) {
            const row = btn.closest('.tf-row');
            if (row) row.remove();
        }
        function addMatchingQRow() {
            const container = document.getElementById('q-matching-questions');
            if (!container) return;

            const row = document.createElement('div');
            row.className = 'matching-q-row flex items-center gap-2';
            row.innerHTML = `
                <input type="text" class="matching-question flex-1 p-3 bg-slate-50 rounded-xl text-sm border-none" placeholder="Pertanyaan ${container.children.length + 1}">
                <button type="button" onclick="removeMatchingQRow(this)" class="text-red-500">&times;</button>
            `;

            container.appendChild(row);
        }

        function removeMatchingQRow(btn) {
            const row = btn.closest('.matching-q-row');
            if (row) row.remove();
        }

        function addMatchingARow() {
            const container = document.getElementById('q-matching-answers');
            if (!container) return;

            const row = document.createElement('div');
            row.className = 'matching-a-row flex items-center gap-2';
            row.innerHTML = `
                <input type="text" class="matching-answer flex-1 p-3 bg-slate-50 rounded-xl text-sm border-none" placeholder="Jawaban ${container.children.length + 1}">
                <button type="button" onclick="removeMatchingARow(this)" class="text-red-500">&times;</button>
            `;

            container.appendChild(row);
        }

        function removeMatchingARow(btn) {
            const row = btn.closest('.matching-a-row');
            if (row) row.remove();
        }

        function onQuestionTypeChange() {
            const sel = document.getElementById('q-type');
            if (!sel) return; // Exit early if element doesn't exist
            currentQType = sel.value;
            const optsContainer = document.getElementById('q-opts-container');
            const buttons = document.querySelectorAll('.c-btn');
            const answerTextContainer = document.getElementById('q-answer-text-container');
            const tfContainer = document.getElementById('q-tf-container');
            if (!optsContainer) return; // Exit early if container doesn't exist
            const qText = document.getElementById('q-text');
            const qOpsiGroup = document.getElementById('q-opsi-group');
            if (qText) qText.classList.remove('hidden');
            if (qOpsiGroup) qOpsiGroup.classList.remove('hidden');

            if (currentQType === 'text') {
                optsContainer.classList.add('hidden');
                answerTextContainer.classList.remove('hidden');
                tfContainer.classList.add('hidden');
            } else if (currentQType === 'tf') {
                optsContainer.classList.add('hidden');
                answerTextContainer.classList.add('hidden');
                tfContainer.classList.remove('hidden');
            } else if (currentQType === 'matching') {
                optsContainer.classList.add('hidden');
                answerTextContainer.classList.add('hidden');
                tfContainer.classList.add('hidden');
                if (qText) qText.classList.add('hidden');
                if (qOpsiGroup) qOpsiGroup.classList.add('hidden');
            } else {
                optsContainer.classList.remove('hidden');
                answerTextContainer.classList.add('hidden');
                tfContainer.classList.add('hidden');
                optsContainer.querySelectorAll('.q-opt').forEach(inp => {
                    inp.disabled = false;
                    inp.parentElement && (inp.parentElement.style.display = '');
                });
            }
            // show or hide correct-button group for tf/text/matching
            const correctButtonsGroup = document.getElementById('q-correct-buttons-group');
            if (correctButtonsGroup) {
                if (currentQType === 'tf' || currentQType === 'text' || currentQType === 'matching') {
                    correctButtonsGroup.style.display = 'none';
                } else {
                    correctButtonsGroup.style.display = '';
                }
            }
            // update correct button labels/hide as needed
            if (buttons && buttons.length >= 4) {
                if (currentQType === 'tf') {
                    buttons[0].innerText = 'Benar';
                    buttons[1].innerText = 'Salah';
                    buttons[2].style.display = 'none';
                    buttons[3].style.display = 'none';
                } else {
                    ['A', 'B', 'C', 'D'].forEach((l, i) => {
                        buttons[i].innerText = l;
                        buttons[i].style.display = '';
                    });
                }
            }
            // reset correct state
            activeCorrect = 0;
            activeCorrectMultiple = [];
            renderCorrectButtons();
        }

        function openQuestionModal() {
            console.log('openQuestionModal called');
            try {
                editQuestionIndex = null;

                // Show the modal first
                const modal = document.getElementById('question-modal');
                if (!modal) {
                    console.error('question-modal not found');
                    return;
                }
                modal.classList.remove('hidden');
                modal.classList.add('flex');

                // Reset form fields
                const typeEl = document.getElementById('q-type');
                if (typeEl) typeEl.value = 'single';

                const textEl = document.getElementById('q-text');
                if (textEl) textEl.value = '';

                const ansEl = document.getElementById('q-answer-text');
                if (ansEl) ansEl.value = '';

                // Clear options
                document.querySelectorAll('.q-opt').forEach(opt => {
                    opt.value = '';
                });

                // Clear image
                const imgFile = document.getElementById('q-image-file');
                if (imgFile) imgFile.value = null;

                // Clear multiple images preview
                const imgPreviewContainer = document.getElementById('q-images-preview');
                if (imgPreviewContainer) imgPreviewContainer.innerHTML = '';
                const imgListContainer = document.getElementById('q-images-list');
                if (imgListContainer) imgListContainer.innerHTML = '';
                window.storedImages = [];

                // Reset TF rows
                const tfCont = document.getElementById('q-tf-container');
                if (tfCont) {
                    tfCont.querySelectorAll('.tf-row').forEach(r => r.remove());
                    if (typeof addTfRow === 'function') {
                        addTfRow();
                        addTfRow();
                    }
                }

                // Populate dropdowns and update UI
                populateSelects(['q-mapel', 'q-rombel']);

                // Filter for teacher mode
                if (window.isTeacherMode) {
                    const teacher = db.students.find(s => s.id === currentSiswa.id);
                    if (teacher) {
                        // Filter mapel
                        const mapelSelect = document.getElementById('q-mapel');
                        if (mapelSelect && teacher.subjects) {
                            const names = teacherSubjectNames(teacher);
                            mapelSelect.innerHTML = '<option value="">--Pilih Mapel--</option>' + names.map(n => `<option value="${n}">${n}</option>`).join('');
                        }
                        // Filter rombel (update when mapel changes)
                        const rombelSelect = document.getElementById('q-rombel');
                        if (rombelSelect) {
                            const updateRombs = (chosen) => {
                                let rombelsToUse;
                                if (chosen) {
                                    rombelsToUse = teacherAllowedRombels(teacher, chosen);
                                } else {
                                    rombelsToUse = teacherCombinedRombels(teacher).length > 0 ? teacherCombinedRombels(teacher) : db.rombels;
                                }
                                rombelSelect.innerHTML = '<option value="">--Pilih Rombel--</option>' + rombelsToUse.map(r => `<option value="${r}">${r}</option>`).join('');
                            };
                            updateRombs(mapelSelect ? mapelSelect.value : '');
                            if (mapelSelect) mapelSelect.addEventListener('change', () => updateRombs(mapelSelect.value));
                        }
                    }
                }

                onQuestionTypeChange();

                console.log('openQuestionModal completed successfully');
            } catch (err) {
                console.error('Error opening question modal:', err, err.stack);
                alert('Terjadi kesalahan: ' + err.message);
            }
        }

        function openEditQuestionModal(idx) {
            editQuestionIndex = idx;
            const q = db.questions[idx];
            populateSelects(['q-mapel', 'q-rombel']);

            // Filter for teacher mode
            if (window.isTeacherMode) {
                const teacher = db.students.find(s => s.id === currentSiswa.id);
                if (teacher) {
                    // Filter mapel
                    const mapelSelect = document.getElementById('q-mapel');
                    if (mapelSelect && teacher.subjects) {
                        const names = teacherSubjectNames(teacher);
                        mapelSelect.innerHTML = '<option value="">--Pilih Mapel--</option>' + names.map(n => `<option value="${n}">${n}</option>`).join('');
                    }
                    // Filter rombel (update when mapel changes)
                    const rombelSelect = document.getElementById('q-rombel');
                    if (rombelSelect) {
                        const updateRombs = (chosen) => {
                            let rombelsToUse;
                            if (chosen) {
                                rombelsToUse = teacherAllowedRombels(teacher, chosen);
                            } else {
                                rombelsToUse = teacherCombinedRombels(teacher).length > 0 ? teacherCombinedRombels(teacher) : db.rombels;
                            }
                            rombelSelect.innerHTML = '<option value="">--Pilih Rombel--</option>' + rombelsToUse.map(r => `<option value="${r}">${r}</option>`).join('');
                        };
                        updateRombs(mapelSelect ? mapelSelect.value : '');
                        if (mapelSelect) mapelSelect.addEventListener('change', () => updateRombs(mapelSelect.value));
                    }
                }
            }

            document.getElementById('q-mapel').value = q.mapel;
            document.getElementById('q-rombel').value = q.rombel;
            document.getElementById('q-text').value = q.text;
            if (q.type === 'text') {
                document.getElementById('q-answer-text').value = q.correct || '';
            } else {
                document.getElementById('q-answer-text').value = '';
            }
            document.getElementById('q-type').value = q.type || 'single';
            onQuestionTypeChange();
            if (q.type === 'tf') {
                // SELF-HEALING: If text box contains a long sentence and options are empty/generic
                const textLower = (q.text || '').toLowerCase();
                const looksLikeInstruction = textLower.includes('pilihlah') || textLower.includes('tentukan') || textLower.includes('berikut ini') || textLower.includes('instruksi');
                const isGeneric = (opt) => {
                    if (!opt || String(opt).trim() === '') return true;
                    const clean = String(opt).replace(/[\[\]\-\(\)\.\–\—\_]/g, '').trim().toLowerCase();
                    return /^(benar|salah|true|false|ya|tidak|ok|yes|no|pilihan|option)$/.test(clean);
                };
                const optionsAreGeneric = !q.options || q.options.length === 0 || q.options.every(isGeneric);

                if (q.text && q.text.length > 25 && !looksLikeInstruction && optionsAreGeneric) {
                    q.options = [q.text.replace(/^pernyataan\s*[:\-–]\s*/i, '').trim()];
                    q.text = "Tentukan apakah pernyataan berikut Benar atau Salah:";
                    if (!Array.isArray(q.correct) || q.correct.length === 0) q.correct = [false];
                    // Update UI field for main text
                    document.getElementById('q-text').value = q.text;
                }

                const tfCont = document.getElementById('q-tf-container');
                if (tfCont) {
                    tfCont.querySelectorAll('.tf-row').forEach(r => r.remove());
                    // Ensure at least 3 rows if empty, otherwise use existing options
                    const optionCount = (Array.isArray(q.options) && q.options.length > 0) ? q.options.length : 3;
                    for (let i = 0; i < optionCount; i++) {
                        addTfRow();
                    }
                    document.querySelectorAll('#q-tf-container .tf-row').forEach((row, i) => {
                        const inp = row.querySelector('.tf-statement');
                        const sel = row.querySelector('.tf-correct');
                        if (inp) inp.value = (q.options && q.options[i]) || '';
                        if (sel) sel.value = (q.correct && Array.isArray(q.correct) ? String(q.correct[i]) : '');
                    });
                }
            } else if (q.type === 'matching') {
                const qCont = document.getElementById('q-matching-questions');
                const aCont = document.getElementById('q-matching-answers');
                if (qCont && aCont) {
                    qCont.innerHTML = '';
                    aCont.innerHTML = '';
                    const questions = Array.isArray(q.questions) && q.questions.length ? q.questions : [''];
                    const answers = Array.isArray(q.answers) && q.answers.length ? q.answers : [''];
                    questions.forEach(() => addMatchingQRow());
                    answers.forEach(() => addMatchingARow());
                    document.querySelectorAll('#q-matching-questions .matching-question').forEach((inp, i) => {
                        if (inp) inp.value = questions[i] || '';
                    });
                    document.querySelectorAll('#q-matching-answers .matching-answer').forEach((inp, i) => {
                        if (inp) inp.value = answers[i] || '';
                    });
                }
            } else {
                const opts = document.querySelectorAll('.q-opt');
                (q.options || []).forEach((opt, i) => { if (opts[i]) opts[i].value = opt; });
            }
            if (q.type === 'multiple') {
                activeCorrectMultiple = Array.isArray(q.correct) ? q.correct.slice() : [];
            } else {
                activeCorrect = q.correct || 0;
            }
            renderCorrectButtons();

            // Load images for editing
            if (q.images && Array.isArray(q.images) && q.images.length > 0) {
                window.storedImages = q.images.slice();
                renderImagePreviews();
            } else if (q.image) {
                // Backward compatibility for single image
                window.storedImages = [q.image];
                renderImagePreviews();
            } else {
                window.storedImages = [];
                renderImagePreviews();
            }
            document.getElementById('question-modal-title').innerText = 'Edit Soal';
            document.getElementById('save-question-btn').innerText = 'UPDATE SOAL';
            document.getElementById('question-modal').classList.replace('hidden', 'flex');
        }

        async function uploadImageToServer(base64OrBlob, fileName = 'image.jpg') {
            const formData = new FormData();
            
            let blob;
            if (typeof base64OrBlob === 'string' && base64OrBlob.startsWith('data:')) {
                const resp = await fetch(base64OrBlob);
                blob = await resp.blob();
            } else {
                blob = base64OrBlob;
            }
            
            formData.append('image', blob, fileName);
            
            const res = await fetch(getApiBaseUrl() + '/api/upload-image', {
                method: 'POST',
                body: formData
            });
            
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Upload failed' }));
                throw new Error(err.error || 'Server error');
            }
            
            const data = await res.json();
            return data.url;
        }

        async function addImageUrl() {
            const urlInput = document.getElementById('q-image-url');
            const url = urlInput.value.trim();
            if (!url) return;

            if (!window.storedImages) window.storedImages = [];
            
            if (url.startsWith('data:image')) {
                showToast('Mengunggah data gambar...', 'info');
                try {
                    const compressed = await compressImage(url);
                    const cloudUrl = await uploadImageToServer(compressed, 'pasted-image.jpg');
                    window.storedImages.push(cloudUrl);
                    showToast('Gambar berhasil diunggah ke cloud', 'success');
                } catch (err) {
                    console.error('Failed to upload pasted image:', err);
                    showToast('Gagal upload ke cloud: ' + err.message, 'error');
                    window.storedImages.push(url);
                }
            } else {
                window.storedImages.push(url);
            }
            
            urlInput.value = '';
            renderImagePreviews();
        }

        function compressImage(base64Str, maxWidth = 1024, maxHeight = 1024, quality = 0.7) {
            return new Promise((resolve) => {
                const img = new Image();
                img.src = base64Str;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxWidth) {
                            height *= maxWidth / width;
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width *= maxHeight / height;
                            height = maxHeight;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
            });
        }

        async function previewQuestionImages(event) {
            const files = Array.from(event.target.files);
            if (files.length === 0) return;

            if (!window.storedImages) window.storedImages = [];

            showToast('Memproses gambar...', 'info');

            for (const file of files) {
                try {
                    const base64 = await new Promise(resolve => {
                        const reader = new FileReader();
                        reader.onload = e => resolve(e.target.result);
                        reader.readAsDataURL(file);
                    });
                    
                    if (file.type.startsWith('image/')) {
                        const compressed = await compressImage(base64);
                        const cloudUrl = await uploadImageToServer(compressed, file.name);
                        window.storedImages.push(cloudUrl);
                        console.log(`[STORAGE] Uploaded: ${file.name} -> ${cloudUrl}`);
                    } else {
                        window.storedImages.push(base64);
                    }
                } catch (err) {
                    console.error('Failed to upload image:', file.name, err);
                    showToast('Gagal upload ' + file.name + ': ' + err.message, 'error');
                }
            }
            showToast('Proses upload selesai', 'success');
            renderImagePreviews();
        }

        function renderImagePreviews() {
            const previewContainer = document.getElementById('q-images-preview');
            const listContainer = document.getElementById('q-images-list');
            previewContainer.innerHTML = '';
            listContainer.innerHTML = '';

            if (!window.storedImages) return;

            window.storedImages.forEach((img, idx) => {
                const isUrl = typeof img === 'string' && (img.startsWith('http') || img.startsWith('https'));
                const isBase64 = typeof img === 'string' && img.startsWith('data:image');

                // Show thumbnail preview
                const thumb = document.createElement('div');
                thumb.className = 'relative w-24 h-24 border-2 border-sky-300 rounded-lg overflow-hidden group hover:border-red-400 transition-all cursor-pointer';
                thumb.onclick = () => {
                    window.storedImages.splice(idx, 1);
                    renderImagePreviews();
                };

                const imgEl = document.createElement('img');
                imgEl.src = img;
                imgEl.className = 'w-full h-full object-cover';

                const badge = document.createElement('div');
                badge.className = 'absolute top-1 right-1 bg-sky-600 text-white text-[10px] rounded px-1 font-bold';
                badge.textContent = idx + 1;

                const overlay = document.createElement('div');
                overlay.className = 'absolute inset-0 bg-red-500/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity';
                overlay.innerHTML = '<i class="fas fa-trash text-white text-xs"></i>';

                thumb.appendChild(imgEl);
                thumb.appendChild(badge);
                thumb.appendChild(overlay);
                previewContainer.appendChild(thumb);

                // Add to list
                const item = document.createElement('div');
                item.className = 'flex justify-between items-center bg-slate-50 p-1.5 rounded-lg';
                const label = isUrl ? '🔗 URL' : '📁 File';
                const name = isUrl ? (img.length > 30 ? img.substring(0, 30) + '...' : img) : `Gambar ${idx + 1}`;
                item.innerHTML = `<span class="text-[10px] font-bold text-slate-500">${label}: ${name}</span>`;
                listContainer.appendChild(item);
            });
        }

        function renderCorrectButtons() {
            document.querySelectorAll('.c-btn').forEach((b, i) => {
                let selected = false;
                if (currentQType === 'multiple') {
                    selected = activeCorrectMultiple.includes(i);
                } else {
                    selected = activeCorrect === i;
                }
                b.className = selected ? 'c-btn flex-1 py-3 border-2 border-sky-600 bg-sky-50 text-sky-600 font-bold rounded-xl' : 'c-btn flex-1 py-3 border-2 border-slate-100 text-slate-400 font-bold rounded-xl';
            });
        }

        function setActiveCorrect(idx) {
            if (currentQType === 'multiple') {
                const pos = activeCorrectMultiple.indexOf(idx);
                if (pos === -1) activeCorrectMultiple.push(idx);
                else activeCorrectMultiple.splice(pos, 1);
            } else {
                activeCorrect = idx;
                activeCorrectMultiple = [];
            }
            renderCorrectButtons();
        }

        function updateQuestionTypeDisplay(type) {
            const answerTextContainer = document.getElementById('q-answer-text-container');
            const tfContainer = document.getElementById('q-tf-container');
            const matchingContainer = document.getElementById('q-matching-container');
            const optsContainer = document.getElementById('q-opts-container');
            const correctButtonsGroup = document.getElementById('q-correct-buttons-group');
            const qText = document.getElementById('q-text');
            const qOpsiGroup = document.getElementById('q-opsi-group');

            // Hide all containers first
            if (answerTextContainer) answerTextContainer.classList.add('hidden');
            if (tfContainer) tfContainer.classList.add('hidden');
            if (matchingContainer) matchingContainer.classList.add('hidden');
            if (optsContainer) optsContainer.classList.add('hidden');
            if (correctButtonsGroup) correctButtonsGroup.classList.add('hidden');
            if (qText) qText.classList.remove('hidden');
            if (qOpsiGroup) qOpsiGroup.classList.add('hidden');

            // Show relevant containers based on type
            if (type === 'text') {
                if (answerTextContainer) answerTextContainer.classList.remove('hidden');
            } else if (type === 'tf') {
                if (tfContainer) tfContainer.classList.remove('hidden');
                // Ensure at least 3 statements for TF questions
                const existingRows = tfContainer.querySelectorAll('.tf-row').length;
                for (let i = existingRows; i < 3; i++) {
                    addTfRow();
                }
            } else if (type === 'matching') {
                if (matchingContainer) matchingContainer.classList.remove('hidden');
                if (qText) qText.classList.add('hidden');
            } else {
                // single or multiple
                if (optsContainer) optsContainer.classList.remove('hidden');
                if (correctButtonsGroup) correctButtonsGroup.classList.remove('hidden');
                if (qOpsiGroup) qOpsiGroup.classList.remove('hidden');
            }
        }

        function saveQuestion() {
            const text = document.getElementById('q-text').value;
            const options = Array.from(document.querySelectorAll('.q-opt')).map(i => i.value);
            const mapel = document.getElementById('q-mapel').value;
            const rombel = document.getElementById('q-rombel').value;
            let imagesData = window.storedImages || [];
            window.storedImages = [];

            const type = document.getElementById('q-type').value;
            if (type !== 'matching' && !text) return alert("Lengkapi pertanyaan!");
            let record = { text, mapel, rombel, type, images: imagesData };
            if (type === 'multiple') {
                if (options.some(o => !o)) return alert("Lengkapi semua pilihan!");
                const corr = activeCorrectMultiple.slice();
                if (corr.length < 2 || corr.length > 3) return alert('Pilih 2-3 jawaban benar untuk soal pilihan ganda kompleks!');
                record.options = options;
                record.correct = corr;
            } else if (type === 'text') {
                const ans = document.getElementById('q-answer-text').value.trim();
                if (!ans) return alert('Tuliskan jawaban esai yang benar!');
                record.correct = ans;
            } else if (type === 'tf') {
                const rows = Array.from(document.querySelectorAll('#q-tf-container .tf-row'));
                if (rows.length < 1) return alert('Soal Benar/Salah harus memiliki minimal 1 pernyataan!');
                const stmts = [];
                const corrs = [];
                for (const r of rows) {
                    const stmt = r.querySelector('.tf-statement').value.trim();
                    const sel = r.querySelector('.tf-correct').value;
                    if (!stmt || sel === '') return alert('Lengkapi pernyataan dan pilih Benar/Salah!');
                    stmts.push(stmt);
                    corrs.push(sel === 'true');
                }
                record.options = stmts;
                record.correct = corrs;
            } else if (type === 'matching') {
                const qRows = Array.from(document.querySelectorAll('#q-matching-questions .matching-question'));
                const aRows = Array.from(document.querySelectorAll('#q-matching-answers .matching-answer'));
                const questions = qRows.map(inp => inp.value.trim()).filter(v => v);
                const answers = aRows.map(inp => inp.value.trim()).filter(v => v);
                if (questions.length === 0 || answers.length === 0) return alert('Tambahkan minimal satu pertanyaan dan satu jawaban!');
                if (questions.length !== answers.length) return alert('Jumlah pertanyaan dan jawaban harus sama!');
                record.questions = questions;
                record.answers = answers;
                record.correct = answers.slice();
            } else {
                if (options.some(o => !o)) return alert("Lengkapi semua pilihan!");
                record.options = options;
                record.correct = activeCorrect;
            }
            if (editQuestionIndex !== null) {
                db.questions[editQuestionIndex] = record;
            } else {
                db.questions.push(record);
            }
            save();
            if (window.isTeacherMode) {
                renderTeacherQuestions();
            } else {
                renderAdminQuestions();
            }
            closeModals();
        }

        function renderAdminQuestions() {
            const fR = document.getElementById('filter-rombel').value;
            const fM = document.getElementById('filter-mapel').value;
            const searchTerm = document.getElementById('search-questions').value.toLowerCase();
            const tbody = document.getElementById('questions-table-body');
            const selectAllCheckbox = document.getElementById('admin-select-all-checkbox');

            let filtered = db.questions.filter(q => (fR === 'ALL' || q.rombel === fR) && (fM === 'ALL' || q.mapel === fM));

            // Apply search filter
            if (searchTerm) {
                filtered = filtered.filter(q => q.text.toLowerCase().includes(searchTerm));
            }

            // Update statistics
            document.getElementById('total-questions').textContent = db.questions.length;
            document.getElementById('filtered-questions').textContent = filtered.length;
            document.getElementById('total-count').textContent = db.questions.length;
            document.getElementById('filtered-count').textContent = filtered.length;

            const allSelected = filtered.length > 0 && filtered.every(q => selectedAdminQuestions.has(q));
            if (selectAllCheckbox) selectAllCheckbox.checked = allSelected;

            tbody.innerHTML = filtered.map((q, i) => {
                let typeName = { 'single': 'Pilihan Ganda', 'multiple': 'PG Kompleks', 'text': 'Uraian', 'tf': 'Benar/Salah', 'matching': 'Menjodohkan' }[q.type || 'single'] || 'Pilihan Ganda';
                let corrText = '';
                if (q.type === 'multiple') {
                    corrText = (Array.isArray(q.correct) ? q.correct.map(x => ['A', 'B', 'C', 'D'][x]).join(',') : q.correct);
                } else if (q.type === 'text') {
                    corrText = 'Teks';
                } else if (q.type === 'tf') {
                    if (Array.isArray(q.options)) {
                        corrText = q.options.map((stmt, j) => {
                            const val = Array.isArray(q.correct) ? q.correct[j] : false;
                            return `${stmt} (${val ? 'Benar' : 'Salah'})`;
                        }).join(' / ');
                    } else {
                        corrText = 'Benar/Salah';
                    }
                } else if (q.type === 'matching') {
                    corrText = 'Match';
                } else {
                    corrText = ['A', 'B', 'C', 'D'][q.correct];
                }
                const originalIndex = db.questions.indexOf(q);
                return `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="px-6 py-4 text-center">
                        <div class="flex items-center justify-center gap-2">
                            <input type="checkbox" id="admin-select-${originalIndex}" data-index="${originalIndex}" class="rounded border-slate-300 text-sky-600 focus:ring-sky-500" ${selectedAdminQuestions.has(q) ? 'checked' : ''} onclick="toggleAdminQuestionSelection(event)">
                            <div class="flex flex-col gap-1 items-center">
                                <span class="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">${originalIndex + 1}</span>
                                <div class="flex gap-1">
                                    <button type="button" onclick="moveQuestionUp(${originalIndex})" class="text-slate-400 hover:text-slate-600 text-xs p-1 rounded hover:bg-slate-100 transition-colors ${originalIndex === 0 ? 'opacity-50 cursor-not-allowed' : ''}" ${originalIndex === 0 ? 'disabled' : ''}><i class="fas fa-chevron-up"></i></button>
                                    <button type="button" onclick="moveQuestionDown(${originalIndex})" class="text-slate-400 hover:text-slate-600 text-xs p-1 rounded hover:bg-slate-100 transition-colors ${originalIndex === db.questions.length - 1 ? 'opacity-50 cursor-not-allowed' : ''}" ${originalIndex === db.questions.length - 1 ? 'disabled' : ''}><i class="fas fa-chevron-down"></i></button>
                                </div>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4">
                        <div style="word-wrap: break-word; white-space: pre-wrap; max-width: none;" class="font-bold mb-1">${q.text}</div>
                        ${q.type === 'tf' && Array.isArray(q.options) && q.options.length > 0 ? `
                            <div class="mt-2 pl-3 border-l-2 border-sky-200 space-y-1">
                                ${q.options.map((opt, idx) => `<div class="text-xs text-slate-600"><span class="font-bold text-sky-600 mr-1">${idx + 1}.</span> ${opt}</div>`).join('')}
                            </div>
                        ` : ''}
                        ${(q.images && Array.isArray(q.images) && q.images.length > 0) ? `<div class="flex items-center gap-1 mt-1"><i class="fas fa-images text-xs text-sky-500"></i><span class="text-xs text-sky-600">${q.images.length} gambar</span></div>` : (q.image ? '<div class="flex items-center gap-1 mt-1"><i class="fas fa-image text-xs text-slate-400"></i><span class="text-xs text-slate-500">1 gambar</span></div>' : '')}
                    </td>
                    <td class="px-6 py-4">
                        <div class="flex flex-col gap-1 items-start">
                            <span class="px-3 py-1 bg-sky-100 text-sky-700 rounded-full text-[10px] font-bold text-center inline-block">${q.mapel}</span>
                            <span class="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-bold text-center inline-block">${q.rombel}</span>
                        </div>
                    </td>
                    <td class="px-6 py-4">
                        <span style="word-wrap: break-word; white-space: pre-wrap; max-width: none; font-weight: bold; color: #0369a1; font-size: 0.875rem;">${corrText}</span>
                    </td>
                    <td class="px-6 py-4">
                        <span class="inline-flex items-center justify-center px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold whitespace-nowrap">${typeName}</span>
                    </td>
                    <td class="px-6 py-4 text-center">
                        <div class="flex items-center justify-center gap-1">
                            <button type="button" onclick="openEditQuestionModal(${originalIndex})" class="p-2 text-sky-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" title="Edit"><i class="fas fa-edit"></i></button>
                            <button type="button" onclick="deleteQuestion(${originalIndex})" class="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Hapus"><i class="fas fa-trash"></i></button>
                        </div>
                    </td>
                </tr>
            `}).join('');

            // Show empty state if no questions
            if (filtered.length === 0) {
                tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="px-6 py-12 text-center">
                        <div class="flex flex-col items-center gap-3">
                            <i class="fas fa-inbox text-4xl text-slate-300"></i>
                            <p class="text-slate-500 text-sm">Tidak ada soal ditemukan</p>
                            <p class="text-slate-400 text-xs">Coba ubah filter atau tambah soal baru</p>
                        </div>
                    </td>
                </tr>
                `;
            }
        }

        function deleteQuestion(idx) {
            if (confirm("Hapus soal?")) {
                db.questions.splice(idx, 1);
                save();
                if (window.isTeacherMode || (currentSiswa && currentSiswa.role === 'teacher')) {
                    if (typeof renderTeacherQuestions === 'function') renderTeacherQuestions();
                } else if (typeof renderAdminQuestions === 'function') {
                    renderAdminQuestions();
                }
            }
        }

        function toggleAdminQuestionSelection(event) {
            const idx = Number(event.target.dataset.index);
            if (Number.isNaN(idx)) return;
            const question = db.questions[idx];
            if (!question) return;
            if (event.target.checked) {
                selectedAdminQuestions.add(question);
            } else {
                selectedAdminQuestions.delete(question);
            }
            renderAdminQuestions();
        }

        function toggleAdminSelectAll(event) {
            const checked = event.target.checked;
            const fR = document.getElementById('filter-rombel').value;
            const fM = document.getElementById('filter-mapel').value;
            const filtered = db.questions.filter(q => (fR === 'ALL' || q.rombel === fR) && (fM === 'ALL' || q.mapel === fM));
            filtered.forEach(q => {
                if (checked) {
                    selectedAdminQuestions.add(q);
                } else {
                    selectedAdminQuestions.delete(q);
                }
            });
            renderAdminQuestions();
        }

        function deleteSelectedAdminQuestions() {
            if (selectedAdminQuestions.size === 0) {
                return alert('Pilih soal yang ingin dihapus terlebih dahulu.');
            }
            if (!confirm(`Hapus ${selectedAdminQuestions.size} soal terpilih?`)) return;
            db.questions = db.questions.filter(q => !selectedAdminQuestions.has(q));
            selectedAdminQuestions.clear();
            save();
            renderAdminQuestions();
        }

        function deleteFilteredQuestions() {
            const fR = document.getElementById('filter-rombel').value;
            const fM = document.getElementById('filter-mapel').value;

            // Find questions matching current filters
            const toDelete = db.questions.filter(q =>
                (fR === 'ALL' || q.rombel === fR) && (fM === 'ALL' || q.mapel === fM)
            );

            if (toDelete.length === 0) {
                alert('Tidak ada soal yang sesuai dengan filter saat ini.');
                return;
            }

            // Build confirmation message
            const rombelLabel = fR === 'ALL' ? 'Semua Rombel' : fR;
            const mapelLabel = fM === 'ALL' ? 'Semua Mapel' : fM;
            const msg = `Anda akan menghapus ${toDelete.length} soal dengan filter:\n\n• Rombel: ${rombelLabel}\n• Mapel: ${mapelLabel}\n\nTindakan ini tidak dapat dibatalkan. Lanjutkan?`;

            if (!confirm(msg)) return;

            // Double confirm if deleting all
            if (fR === 'ALL' && fM === 'ALL') {
                if (!confirm(`PERINGATAN: Anda akan menghapus SEMUA ${toDelete.length} soal dari database!\n\nApakah Anda benar-benar yakin?`)) return;
            }

            // Remove matching questions
            db.questions = db.questions.filter(q =>
                !((fR === 'ALL' || q.rombel === fR) && (fM === 'ALL' || q.mapel === fM))
            );

            selectedAdminQuestions.clear();
            save();
            renderAdminQuestions();
            updateStats();
            alert(`${toDelete.length} soal berhasil dihapus.`);
        }

        function deleteTeacherFilteredQuestions() {
            if (!currentSiswa || currentSiswa.role !== 'teacher') return;

            const fM = document.getElementById('teacher-filter-mapel')?.value || '';
            const fR = document.getElementById('teacher-filter-rombel')?.value || '';

            // Find questions that belong to the teacher AND match current filters
            const toDelete = db.questions.filter(q => {
                const qSubject = typeof q.mapel === 'string' ? q.mapel : q.mapel?.name || q.mapel;
                // Must be teacher's subject
                if (!teacherSubjectNames(currentSiswa).includes(qSubject)) return false;
                // Must be in teacher's allowed rombels for that subject
                const allowed = teacherAllowedRombels(currentSiswa, qSubject);
                if (!allowed.includes(q.rombel)) return false;
                // Apply mapel filter
                if (fM && qSubject !== fM) return false;
                // Apply rombel filter
                if (fR && q.rombel !== fR) return false;
                return true;
            });

            if (toDelete.length === 0) {
                alert('Tidak ada soal yang sesuai dengan filter saat ini.');
                return;
            }

            const mapelLabel = fM || 'Semua Mapel';
            const rombelLabel = fR || 'Semua Rombel';
            const msg = `Anda akan menghapus ${toDelete.length} soal dengan filter:\n\n• Mapel: ${mapelLabel}\n• Rombel: ${rombelLabel}\n\nTindakan ini tidak dapat dibatalkan. Lanjutkan?`;

            if (!confirm(msg)) return;

            // Build a Set of references to delete
            const deleteSet = new Set(toDelete);
            db.questions = db.questions.filter(q => !deleteSet.has(q));

            selectedTeacherQuestions.clear();
            save();
            renderTeacherQuestions();
            updateStats();
            alert(`${toDelete.length} soal berhasil dihapus.`);
        }

        function exportQuestions() {
            let questionsToExport = [];
            if (window.isTeacherMode || (currentSiswa && currentSiswa.role === 'teacher')) {
                // Konteks guru: export sesuai filter yang aktif dan hanya soal milik guru tersebut
                const fM = document.getElementById('teacher-filter-mapel')?.value || '';
                const fR = document.getElementById('teacher-filter-rombel')?.value || '';
                questionsToExport = db.questions.filter(q => {
                    const qSubject = typeof q.mapel === 'string' ? q.mapel : q.mapel?.name || q.mapel;
                    if (!teacherSubjectNames(currentSiswa).includes(qSubject)) return false;
                    const allowed = teacherAllowedRombels(currentSiswa, qSubject);
                    if (!allowed.includes(q.rombel)) return false;
                    if (fM && qSubject !== fM) return false;
                    if (fR && q.rombel !== fR) return false;
                    return true;
                });
            } else {
                // Konteks admin: export sesuai filter admin
                const fR = document.getElementById('filter-rombel').value;
                const fM = document.getElementById('filter-mapel').value;
                questionsToExport = db.questions.filter(q =>
                    (fR === 'ALL' || q.rombel === fR) && (fM === 'ALL' || q.mapel === fM)
                );
            }

            if (questionsToExport.length === 0) {
                alert('Tidak ada soal yang bisa diexport berdasarkan filter saat ini.');
                return;
            }

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(questionsToExport, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `soal_cbt_export_${new Date().getTime()}.json`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        }

        function importQuestionsJSON() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';

            input.onchange = (event) => {
                const file = event.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = function (e) {
                    try {
                        const imported = JSON.parse(e.target.result);
                        if (!Array.isArray(imported)) {
                            alert('Format file JSON tidak valid. Harus berupa array soal (JSON).');
                            return;
                        }

                        let added = 0;
                        imported.forEach(q => {
                            // Validasi dasar minimal ada text dan type soal
                            if (q.text && q.type) {
                                db.questions.push(q);
                                added++;
                            }
                        });

                        if (added > 0) {
                            save();
                            if (window.isTeacherMode || (currentSiswa && currentSiswa.role === 'teacher')) {
                                renderTeacherQuestions();
                            } else {
                                renderAdminQuestions();
                            }
                            updateStats();
                            alert(`${added} soal berhasil diimport.`);
                        } else {
                            alert('Tidak ada soal valid yang ditemukan dalam file ini.');
                        }
                    } catch (err) {
                        alert('Gagal memproses file JSON: ' + err.message);
                    }
                };
                reader.readAsText(file);
            };

            input.click();
        }

        function exportQuestionsExcel() {
            let questionsToExport = [];
            if (window.isTeacherMode || (currentSiswa && currentSiswa.role === 'teacher')) {
                const fM = document.getElementById('teacher-filter-mapel')?.value || '';
                const fR = document.getElementById('teacher-filter-rombel')?.value || '';
                questionsToExport = db.questions.filter(q => {
                    const qSubject = typeof q.mapel === 'string' ? q.mapel : q.mapel?.name || q.mapel;
                    if (!teacherSubjectNames(currentSiswa).includes(qSubject)) return false;
                    const allowed = teacherAllowedRombels(currentSiswa, qSubject);
                    if (!allowed.includes(q.rombel)) return false;
                    if (fM && qSubject !== fM) return false;
                    if (fR && q.rombel !== fR) return false;
                    return true;
                });
            } else {
                const fR = document.getElementById('filter-rombel').value;
                const fM = document.getElementById('filter-mapel').value;
                questionsToExport = db.questions.filter(q =>
                    (fR === 'ALL' || q.rombel === fR) && (fM === 'ALL' || q.mapel === fM)
                );
            }

            if (questionsToExport.length === 0) {
                alert('Tidak ada soal yang bisa diexport berdasarkan filter saat ini.');
                return;
            }

            const flatData = questionsToExport.map(q => {
                let opsiText = '';
                if (q.options && Array.isArray(q.options)) {
                    opsiText = q.options.join(' || ');
                }
                let kunciText = '';
                if (q.correct !== undefined) {
                    if (Array.isArray(q.correct)) {
                        kunciText = q.correct.join(' || ');
                    } else {
                        kunciText = q.correct;
                    }
                }

                let matchQ = '';
                let matchA = '';
                if (q.questions && Array.isArray(q.questions)) matchQ = q.questions.join(' || ');
                if (q.answers && Array.isArray(q.answers)) matchA = q.answers.join(' || ');

                return {
                    'Tipe': q.type || 'single',
                    'Mapel': typeof q.mapel === 'string' ? q.mapel : q.mapel?.name || q.mapel,
                    'Rombel': q.rombel || '',
                    'Pertanyaan': q.text || '',
                    'Opsi': opsiText,
                    'Jawaban Benar atau Kunci': kunciText,
                    'Pertanyaan Matching (Kiri)': matchQ,
                    'Jawaban Matching (Kanan)': matchA,
                    'Catatan': 'Gambar tidak dieskpor via format Excel'
                };
            });

            const worksheet = XLSX.utils.json_to_sheet(flatData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "BankSoal");

            XLSX.writeFile(workbook, `soal_cbt_export_${new Date().getTime()}.xlsx`);
        }

        function importQuestionsExcel() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.xlsx, .xls';

            input.onchange = (event) => {
                const file = event.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = function (e) {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                        const jsonData = XLSX.utils.sheet_to_json(firstSheet);

                        let added = 0;
                        jsonData.forEach(row => {
                            if (row['Pertanyaan']) {
                                let type = row['Tipe'] || 'single';

                                let options = [];
                                if (row['Opsi']) {
                                    options = row['Opsi'].toString().split('||').map(s => s.trim()).filter(s => s);
                                }

                                let correctStr = row['Jawaban Benar atau Kunci']?.toString() || '';
                                let correct;
                                if (type === 'multiple' || type === 'tf' || type === 'matching') {
                                    correct = correctStr.split('||').map(s => {
                                        let trimmed = s.trim();
                                        if (trimmed.toLowerCase() === 'true') return true;
                                        if (trimmed.toLowerCase() === 'false') return false;
                                        if (!isNaN(trimmed) && trimmed !== '') return Number(trimmed);
                                        return trimmed;
                                    }).filter(s => s !== '');
                                } else {
                                    if (!isNaN(correctStr) && correctStr !== '') {
                                        correct = Number(correctStr);
                                    } else {
                                        correct = correctStr;
                                    }
                                }

                                let matchQ = [];
                                let matchA = [];
                                if (row['Pertanyaan Matching (Kiri)']) {
                                    matchQ = row['Pertanyaan Matching (Kiri)'].toString().split('||').map(s => s.trim());
                                }
                                if (row['Jawaban Matching (Kanan)']) {
                                    matchA = row['Jawaban Matching (Kanan)'].toString().split('||').map(s => s.trim());
                                }

                                const newQ = {
                                    type: type,
                                    mapel: row['Mapel'] || 'General',
                                    rombel: row['Rombel'] || '',
                                    text: row['Pertanyaan'],
                                };

                                if (options.length > 0) newQ.options = options;
                                if (correct !== undefined && correct !== '') newQ.correct = correct;
                                if (matchQ.length > 0) newQ.questions = matchQ;
                                if (matchA.length > 0) newQ.answers = matchA;

                                db.questions.push(newQ);
                                added++;
                            }
                        });

                        if (added > 0) {
                            save();
                            if (window.isTeacherMode || (currentSiswa && currentSiswa.role === 'teacher')) {
                                renderTeacherQuestions();
                            } else {
                                renderAdminQuestions();
                            }
                            updateStats();
                            alert(`${added} soal dari Excel berhasil diimport.`);
                        } else {
                            alert('Tidak ada soal valid yang ditemukan dalam file Excel ini atau format kolom tidak sesuai.');
                        }
                    } catch (err) {
                        alert('Gagal memproses file Excel: ' + err.message);
                    }
                };
                reader.readAsArrayBuffer(file);
            };

            input.click();
        }

        function moveQuestionUp(idx) {
            if (idx > 0) {
                [db.questions[idx], db.questions[idx - 1]] = [db.questions[idx - 1], db.questions[idx]];
                save();
                if (window.isTeacherMode || (currentSiswa && currentSiswa.role === 'teacher')) {
                    renderTeacherQuestions();
                } else {
                    renderAdminQuestions();
                }
            }
        }

        function moveQuestionDown(idx) {
            if (idx < db.questions.length - 1) {
                [db.questions[idx], db.questions[idx + 1]] = [db.questions[idx + 1], db.questions[idx]];
                save();
                if (window.isTeacherMode || (currentSiswa && currentSiswa.role === 'teacher')) {
                    renderTeacherQuestions();
                } else {
                    renderAdminQuestions();
                }
            }
        }

        function shuffleQuestions() {
            let questionsToShuffleIndices = [];
            let fM = '';
            let fR = '';

            const isTeacher = window.isTeacherMode || (typeof currentSiswa !== 'undefined' && currentSiswa && currentSiswa.role === 'teacher');

            if (isTeacher) {
                fM = document.getElementById('teacher-filter-mapel')?.value || '';
                fR = document.getElementById('teacher-filter-rombel')?.value || '';

                for (let i = 0; i < db.questions.length; i++) {
                    const q = db.questions[i];
                    const qSubject = typeof q.mapel === 'string' ? q.mapel : q.mapel?.name || q.mapel;
                    if (!teacherSubjectNames(currentSiswa).includes(qSubject)) continue;
                    const allowed = teacherAllowedRombels(currentSiswa, qSubject);
                    if (!allowed.includes(q.rombel)) continue;
                    if (fM && qSubject !== fM) continue;
                    if (fR && q.rombel !== fR) continue;

                    questionsToShuffleIndices.push(i);
                }
            } else {
                fR = document.getElementById('filter-rombel')?.value || 'ALL';
                fM = document.getElementById('filter-mapel')?.value || 'ALL';

                for (let i = 0; i < db.questions.length; i++) {
                    const q = db.questions[i];
                    if ((fR === 'ALL' || q.rombel === fR) && (fM === 'ALL' || q.mapel === fM)) {
                        questionsToShuffleIndices.push(i);
                    }
                }
            }

            if (questionsToShuffleIndices.length === 0) {
                alert('Tidak ada soal yang sesuai dengan filter saat ini untuk diacak.');
                return;
            }

            let msg = "Acak urutan semua soal?";
            if (isTeacher) {
                const mapelLabel = fM ? fM : 'Semua Mapel';
                const rombelLabel = fR ? fR : 'Semua Rombel';
                if (fM || fR) {
                    msg = `Acak urutan ${questionsToShuffleIndices.length} soal dengan filter:\nMapel: ${mapelLabel}\nRombel: ${rombelLabel}?`;
                } else {
                    msg = `Acak urutan ${questionsToShuffleIndices.length} soal milik Anda?`;
                }
            } else {
                if (fR !== 'ALL' || fM !== 'ALL') {
                    const rombelLabel = fR === 'ALL' ? 'Semua Rombel' : fR;
                    const mapelLabel = fM === 'ALL' ? 'Semua Mapel' : fM;
                    msg = `Acak urutan ${questionsToShuffleIndices.length} soal dengan filter:\nRombel: ${rombelLabel}\nMapel: ${mapelLabel}?`;
                }
            }

            if (confirm(msg)) {
                // Extract those questions
                const filteredQuestions = questionsToShuffleIndices.map(i => db.questions[i]);

                // Shuffle extracted questions
                for (let i = filteredQuestions.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [filteredQuestions[i], filteredQuestions[j]] = [filteredQuestions[j], filteredQuestions[i]];
                }

                // Put them back at their original indices (so non-filtered stay in place)
                for (let i = 0; i < questionsToShuffleIndices.length; i++) {
                    db.questions[questionsToShuffleIndices[i]] = filteredQuestions[i];
                }

                save();
                
                if (isTeacher) {
                    if (typeof renderTeacherQuestions === 'function') renderTeacherQuestions();
                } else {
                    if (typeof renderAdminQuestions === 'function') renderAdminQuestions();
                }
            }
        }

        function clearSearch() {
            document.getElementById('search-questions').value = '';
            renderAdminQuestions();
        }

        function clearFilters() {
            document.getElementById('search-questions').value = '';
            document.getElementById('filter-rombel').value = 'ALL';
            document.getElementById('filter-mapel').value = 'ALL';
            renderAdminQuestions();
        }

        async function pingBackend() {
            try {
                const res = await fetch(getApiBaseUrl() + '/api/ips', { cache: 'no-store' });
                return res.ok;
            } catch (e) {
                return false;
            }
        }

        async function openImportModal() {
            populateSelects(['import-mapel', 'import-rombel']);
            if (window.isTeacherMode) {
                const mapelSelect = document.getElementById('import-mapel');
                const teacherSubjects = teacherSubjectNames(currentSiswa);
                mapelSelect.innerHTML = teacherSubjects.map(subj => `<option value="${subj}">${subj}</option>`).join('');
            }
            document.getElementById('import-text-area').value = '';
            document.getElementById('import-word-file').value = null;

            // check backend availability so user isn’t surprised by 404 later
            const warningEl = document.getElementById('import-backend-warning');
            const btn = document.querySelector('[onclick="processImport()"]');
            const fileInput = document.getElementById('import-word-file');
            const backendOk = await pingBackend();
            if (!backendOk) {
                warningEl.textContent = '⚠️ Server tidak tersedia. Jalankan backend untuk menggunakan fitur ini.';
                fileInput.disabled = true;
                btn.disabled = true;
            } else {
                warningEl.textContent = '';
                fileInput.disabled = false;
                btn.disabled = false;
            }

            document.getElementById('import-word-file').value = null;
            document.getElementById('import-modal').classList.replace('hidden', 'flex');
        }

        function processImport() {
            const mapel = document.getElementById('import-mapel').value;
            const rombel = document.getElementById('import-rombel').value;

            if (window.isTeacherMode && !teacherSubjectNames(currentSiswa).includes(mapel)) {
                alert('Anda hanya dapat mengimport soal untuk mata pelajaran yang Anda ajar!');
                return;
            }

            let added = 0, failed = 0;
            const importLog = [];

            // If Word parsing already produced questions (new backend feature), use them
            if (window.importedQuestions && window.importedQuestions.length > 0) {
                const questions = window.importedQuestions;
                console.log('🔄 Processing', questions.length, 'imported questions');

                questions.forEach((q, idx) => {
                    try {
                        if (!q.text) {
                            failed++;
                            importLog.push(`❌ Soal ${idx + 1}: Text kosong`);
                            return;
                        }
                        const qCopy = {
                            ...q,
                            mapel: q.mapel || mapel || 'General',
                            rombel: q.rombel || rombel || ''
                        };
                        db.questions.push(qCopy);
                        added++;
                    } catch (err) {
                        console.error('Error adding question:', err);
                        failed++;
                    }
                });

                window.importedQuestions = null;
                window.importCount = 0;
            } else {
                // legacy text import
                let raw = document.getElementById('import-text-area').value.trim();
                if (!raw) return alert('Tempel teks soal terlebih dahulu atau pilih file Word!');

                const blocks = raw.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);

                blocks.forEach(block => {
                    // capture everything after "Kunci:" as keyText
                    const keyFullMatch = block.match(/kunci\s*[:\-]?\s*(.+)/i);
                    let keyText = keyFullMatch ? keyFullMatch[1].trim() : null;
                    let keyLetters = [];
                    let isEssay = false;
                    if (keyText) {
                        const letterPattern = /^([A-D](?:\s*,\s*[A-D])*)$/i;
                        const letterMatch = keyText.match(letterPattern);
                        if (letterMatch) {
                            keyLetters = letterMatch[1].toUpperCase().split(/\s*,\s*/);
                        } else {
                            isEssay = true;
                        }
                    }

                    // remove the key line entirely from content
                    let content = block.replace(/kunci\s*[:\-]?\s*.+/i, '').trim();

                    // split question text and options by detecting letters A.–D. preceded by space or newline
                    const parts = content.split(/[\s\n]+(?=[A-D][\.\)\:\-\s]\s*)/i);
                    const qText = parts[0].replace(/^[0-9]+\.\s*/, '').trim();
                    const opts = [];
                    for (let i = 1; i < parts.length; i++) {
                        opts.push(parts[i].replace(/^[A-D][\.\)\:\-\s]\s*/i, '').trim());
                    }

                    // fallback: try splitting by " A. " if not enough opts
                    if (opts.length < 2) {
                        const alt = content.split(/\s+(?=[A-D][\.\)\:\-\s])/i).slice(1);
                        if (alt.length >= 2) {
                            opts.length = 0;
                            alt.forEach(a => opts.push(a.trim()));
                        }
                    }

                    if (isEssay) {
                        // essay type question
                        if (qText && keyText) {
                            db.questions.push({ text: qText, mapel, rombel, type: 'text', correct: keyText });
                            added++;
                        } else {
                            failed++;
                        }
                    } else if (opts.length >= 2 && keyLetters.length > 0) {
                        // multiple-choice question (single or complex)
                        const indices = keyLetters.map(l => l.charCodeAt(0) - 65).filter(i => i >= 0 && i < opts.length);
                        const qType = indices.length > 1 ? 'multiple' : 'single';
                        const correctVal = qType === 'multiple' ? indices : indices[0];
                        db.questions.push({ text: qText, options: opts.slice(0, 4), mapel, rombel, type: qType, correct: correctVal });
                        added++;
                    } else {
                        // unable to parse
                        failed++;
                    }
                });
            }


            save();

            // Show detailed result
            const resultMsg = `✅ Import Berhasil!\n\nDitambahkan: ${added} soal\n${failed > 0 ? `Gagal: ${failed} soal` : 'Semua soal berhasil diproses!'}`;
            alert(resultMsg);

            console.log('✅ Import complete. Added:', added, 'Failed:', failed);
            console.log(importLog.join('\n'));

            if (window.isTeacherMode) {
                renderTeacherQuestions();
            } else {
                renderAdminQuestions();
            }
            closeModals();
        }

        function importDatabase(event) {
            const file = event?.target?.files?.[0];
            if (!file) return;
            if (!confirm('Restore database akan menggantikan data saat ini. Lanjutkan?')) return;
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const parsed = JSON.parse(e.target.result);
                    if (parsed && typeof parsed === 'object') {
                        db = parsed;
                        save();
                        alert('Restore berhasil. Halaman akan dimuat ulang.');
                        location.reload();
                    } else {
                        alert('Format file tidak valid.');
                    }
                } catch (err) {
                    alert('Gagal membaca file: ' + err.message);
                }
            };
            reader.readAsText(file);
            // reset input value so same file can be selected again
            event.target.value = '';
        }



        // --- WORD IMPORT HANDLER ---
        async function handleWordFile(event) {
            const file = event.target.files[0];
            if (!file) return;
            // quick backend ping before doing anything else
            const backendOk = await pingBackend();
            if (!backendOk) {
                const textarea = document.getElementById('import-text-area');
                textarea.value = 'Copy Paste secara manual dengan format\n\n' +
                    'Contoh format word pilihan ganda\n' +
                    '1. Apa itu teks prosedur....\n' +
                    'A. Langkah-langkah\n' +
                    'B. Rangkaian\n' +
                    'C. Informasi\n' +
                    'D. Berita\n' +
                    'Kunci: A\n\n' +
                    'Contoh format word pilihan ganda kompleks\n' +
                    '1. Apa itu teks prosedur....\n' +
                    'A. Langkah-langkah\n' +
                    'B. Rangkaian\n' +
                    'C. Informasi\n' +
                    'D. Berita\n' +
                    'Kunci: A, B\n\n' +
                    'Contoh format word urauan/esai\n' +
                    '1. Apa itu teks prosedur....\n' +
                    'Kunci: Teks yang memuat langkah-langkah';
                alert('Tidak dapat menghubungi server. Silakan copy-paste manual di sini mengikuti contoh di textarea.');
                return;
            }


            try {
                // Show loading state
                const btn = document.querySelector('[onclick="processImport()"]');
                const originalText = btn.textContent;
                const textarea = document.getElementById('import-text-area');

                btn.disabled = true;
                btn.textContent = '⏳ Memproses Word...';
                textarea.value = '⏳ Sedang membaca file Word...';

                // Create FormData and send to backend
                const formData = new FormData();
                formData.append('file', file);
                formData.append('subject', document.getElementById('import-mapel').value);
                formData.append('class', document.getElementById('import-rombel').value);

                console.log('📤 Sending Word file to server:', file.name);

                const response = await fetch(getApiBaseUrl() + '/api/import-word', {
                    method: 'POST',
                    body: formData
                });

                console.log('📥 Response status:', response.status);
                // the backend should always send JSON, but if the server is unreachable / misconfigured
                // we may get an HTML error page (which starts with "<!DOCTYPE"). parsing that as JSON
                // throws a syntax error and leads to the issue seen in the console. guard against it.
                let result;
                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    result = await response.json();
                } else {
                    // fallback: try to read text to aid debugging
                    const text = await response.text();
                    console.error('⚠️ Expected JSON but received:', text);
                    let hint = 'Pastikan server berjalan dan endpoint benar.';
                    if (response.status === 404) {
                        hint = 'Endpoint tidak ditemukan (404) – apakah backend diaktifkan pada origin ini?';
                    }
                    throw new Error(`Server returned non-JSON response (status ${response.status}). ${hint} Lihat console untuk detail.`);
                }
                console.log('📦 Parsed result:', result);

                if (!response.ok) {
                    const errorMsg = result.error || result.message || 'Unknown error';
                    textarea.value = `❌ Gagal membaca Word:\n\n${errorMsg}\n\n` +
                        `Contoh format word pilihan ganda\n` +
                        `1. Apa itu teks prosedur\n` +
                        `A. Langkah-langkah\n` +
                        `B. Rangkaian\n` +
                        `C. Informasi\n` +
                        `D. Berita\n` +
                        `Kunci: A\n\n` +
                        `Contoh format word pilihan ganda kompleks\n` +
                        `1. Apa itu teks prosedur\n` +
                        `A. Langkah-langkah\n` +
                        `B. Rangkaian\n` +
                        `C. Informasi\n` +
                        `D. Berita\n` +
                        `Kunci: A, B\n\n` +
                        `Contoh format word urauan/esai\n` +
                        `1. Apa itu teks prosedur\n` +
                        `Kunci: Teks yang memuat langkah-langkah`;
                    alert('Gagal membaca Word: ' + errorMsg + '\nSilakan periksa format dokumen di textarea.');
                    btn.disabled = false;
                    btn.textContent = originalText;
                    return;
                }

                // Store imported questions for preview
                window.importedQuestions = result.questions || [];
                window.importCount = result.imported || 0;

                console.log('✅ Successfully parsed:', window.importedQuestions.length, 'questions');

                // Show success message with detailed preview
                if (result.imported > 0) {
                    const preview = result.questions.map((q, i) => {
                        const optionsList = q.options && q.options.length > 0
                            ? `\n   Pilihan: ${q.options.map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${opt}`).join(', ')}`
                            : '';
                        let correctInfo = '';
                        if (q.type === 'text') {
                            correctInfo = `\n   Jawab: ${q.correct}`;
                        } else if (q.type === 'multiple') {
                            const correctLetters = Array.isArray(q.correct) ? q.correct.map(idx => String.fromCharCode(65 + idx)).join(', ') : String.fromCharCode(65 + q.correct);
                            correctInfo = `\n   Kunci: ${correctLetters}`;
                        } else if (q.type === 'single') {
                            const correctLetter = String.fromCharCode(65 + q.correct);
                            correctInfo = `\n   Kunci: ${correctLetter}`;
                        } else {
                            correctInfo = `\n   Jawab: ${Array.isArray(q.correct) ? q.correct.map(idx => q.options[idx] || `[${idx}]`).join(', ') : q.options[q.correct] || `[${q.correct}]`}`;
                        }
                        return `${i + 1}. ${q.text}${optionsList}${correctInfo}\n   Tipe: ${q.type === 'multiple' ? 'Pilihan Ganda Kompleks' : q.type} | Mapel: ${q.mapel} | Kelas: ${q.rombel}`;
                    }).join('\n\n');

                    textarea.value = `✅ BERHASIL MEMBACA ${result.imported} SOAL\n\n${preview}`;
                    alert(`✅ Berhasil membaca ${result.imported} soal dari Word!\n\nKlik "PROSES IMPORT" untuk menambahkan ke database.`);
                } else {
                    textarea.value = '⚠️ Tidak ada soal ditemukan dalam dokumen Word.\n\nPastikan file Anda menggunakan format yang didukung (tabel dengan kolom: Soal | Pilihan1 | ... | Jawaban atau format teks tanpa tabel seperti panduan).';
                    alert('⚠️ Tidak ada soal ditemukan. Periksa format tabel atau teks dan coba lagi.');
                }

                btn.disabled = false;
                btn.textContent = originalText;

            } catch (err) {
                console.error('❌ Error:', err);
                const btn = document.querySelector('[onclick="processImport()"]');
                btn.disabled = false;
                const textarea = document.getElementById('import-text-area');
                textarea.value = 'Copy Paste secara manual dengan format\n\n' +
                    'Contoh format word pilihan ganda\n' +
                    '1. Apa itu teks prosedur....\n' +
                    'A. Langkah-langkah\n' +
                    'B. Rangkaian\n' +
                    'C. Informasi\n' +
                    'D. Berita\n' +
                    'Kunci: A\n\n' +
                    'Contoh format word pilihan ganda kompleks\n' +
                    '1. Apa itu teks prosedur....\n' +
                    'A. Langkah-langkah\n' +
                    'B. Rangkaian\n' +
                    'C. Informasi\n' +
                    'D. Berita\n' +
                    'Kunci: A, B\n\n' +
                    'Contoh format word urauan/esai\n' +
                    '1. Apa itu teks prosedur....\n' +
                    'Kunci: Teks yang memuat langkah-langkah';
                alert('Gagal membaca Word. Silakan gunakan copy-paste manual seperti format di textarea.');
            }
        }

        // --- RESULTS & CONFIG ---

        // --- EXPLICIT SAVE / LOAD DB (admin actions) ---
        async function saveDatabaseToServer() {
            try {
                const res = await fetch(getApiBaseUrl() + '/api/db', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(db)
                });
                if (res.ok) {
                    alert('Database berhasil disimpan ke server.');
                } else {
                    const txt = await res.text();
                    alert('Gagal menyimpan ke server: ' + (txt || res.statusText));
                }
            } catch (err) {
                alert('Error saat menyimpan ke server: ' + (err.message || err));
            }
        }

        async function loadDatabaseFromServer() {
            if (!confirm('Ambil database dari server akan menggantikan data saat ini. Lanjutkan?')) return;
            try {
                const res = await fetch(getApiBaseUrl() + '/api/db');
                if (!res.ok) throw new Error(res.statusText || res.status);
                const payload = await res.json();
                if (payload && typeof payload === 'object') {
                    // compare result counts so we don't lose local-only data
                    const localCount = Array.isArray(db.results) ? db.results.length : 0;
                    const serverCount = Array.isArray(payload.results) ? payload.results.length : 0;
                    if (serverCount < localCount) {
                        const isAdmin = currentSiswa && currentSiswa.role === 'admin';
                        const shouldMerge = isAdmin ?
                            confirm('Data server memiliki lebih sedikit hasil ujian daripada data lokal. Ingin menggabungkan keduanya? (Cancel berarti tetap menggunakan data lokal)') :
                            true; // Non-admin silently merges to preserve local work

                        if (shouldMerge) {
                            db.results = mergeResults(db.results, payload.results);
                            db = { ...payload, results: db.results };
                        }
                    } else if (serverCount > localCount) {
                        // merge to pick up any extra entries
                        db.results = mergeResults(db.results, payload.results);
                        db = { ...payload, results: db.results };
                    } else {
                        // same size, just merge to dedupe
                        db.results = mergeResults(db.results, payload.results);
                        db = { ...payload, results: db.results };
                    }

                    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { }
                    updateStats();
                    renderAdminStudents();
                    renderAdminQuestions();
                    renderAdminResults();
                    alert('Database berhasil diambil dari server.');
                } else {
                    throw new Error('Format data tidak valid');
                }
            } catch (err) {
                alert('Gagal mengambil database: ' + (err.message || err));
            }
        }

        function updateAdminAccount() {
            const admin = db.students.find(x => x.role === 'admin');
            if (!admin) return alert('Administrator tidak ditemukan.');
            const oldPass = document.getElementById('set-admin-old-pass').value;
            const newId = document.getElementById('set-admin-id').value.trim();
            const newPass = document.getElementById('set-admin-new-pass').value;

            if (oldPass !== admin.password) return alert('Password saat ini salah.');
            if (newId) admin.id = newId;
            if (newPass) admin.password = newPass;
            save();
            alert('Perubahan tersimpan.');
            showAdminSection('settings');
        }

        // --- SUBJECT LOCK MANAGEMENT ---
        function renderSubjectsLockManagement() {
            const container = document.getElementById('subjects-lock-container');
            if (!container) return;

            container.innerHTML = db.subjects.map((subject, idx) => {
                const subjectName = getSubjectName(subject);
                const isLocked = subject.locked;
                return `
                    <div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between hover:shadow-md transition-all" data-subject-index="${idx}">
                        <div>
                            <h3 class="font-bold text-slate-800">${subjectName}</h3>
                            <p class="text-xs text-slate-400 mt-1">Status: ${isLocked ? '<span class="text-red-600 font-bold">🔒 TERKUNCI</span>' : '<span class="text-emerald-600 font-bold">🔓 TERBUKA</span>'}</p>
                        </div>
                        <div class="flex gap-2">
                            ${isLocked ?
                        `<button class="toggle-lock-btn px-4 py-2 bg-emerald-600 text-white font-bold rounded-xl text-sm hover:bg-emerald-700 transition-all flex items-center gap-2"><i class="fas fa-unlock"></i> Buka</button>` :
                        `<button class="toggle-lock-btn px-4 py-2 bg-red-600 text-white font-bold rounded-xl text-sm hover:bg-red-700 transition-all flex items-center gap-2"><i class="fas fa-lock"></i> Kunci</button>`
                    }
                        </div>
                    </div>
                `;
            }).join('');

            // Attach event listeners to buttons
            document.querySelectorAll('.toggle-lock-btn').forEach(btn => {
                btn.addEventListener('click', function () {
                    const idx = parseInt(this.closest('[data-subject-index]').dataset.subjectIndex);
                    toggleSubjectLock(idx);
                });
            });
        }

        function toggleSubjectLock(idx) {
            if (idx < 0 || idx >= db.subjects.length) return;

            const subject = db.subjects[idx];
            subject.locked = !subject.locked;
            save();
            renderSubjectsLockManagement();
            renderStudentExamList(); // Update student view if they're looking at exam list

            const subjectName = getSubjectName(subject);
            const status = subject.locked ? 'TERKUNCI' : 'TERBUKA';
            console.log(`Mata pelajaran "${subjectName}" sekarang ${status}`);
        }

        // --- RESULTS & CONFIG ---
        function renderAdminResults() {
            const tbody = document.getElementById('results-table-body');
            const from = document.getElementById('results-date-from')?.value;
            const to = document.getElementById('results-date-to')?.value;
            const fromTs = from ? new Date(from + 'T00:00:00').getTime() : null;
            const toTs = to ? new Date(to + 'T23:59:59').getTime() : null;

            const rows = db.results
                .map((r, i) => ({ r, i }))
                .filter(({ r }) => !r.deleted)
                .filter(({ r }) => {
                    const rombelFilter = document.getElementById('results-filter-rombel')?.value;
                    const mapelFilter = document.getElementById('results-filter-mapel')?.value;

                    if (rombelFilter && rombelFilter !== 'ALL' && r.rombel !== rombelFilter) return false;
                    if (mapelFilter && mapelFilter !== 'ALL' && r.mapel !== mapelFilter) return false;

                    if (!fromTs && !toTs) return true;
                    if (!r.date) return false;
                    const t = new Date(r.date).getTime();
                    if (fromTs && t < fromTs) return false;
                    if (toTs && t > toTs) return false;
                    return true;
                })
                .map(({ r, i }) => {
                    const hasEssay = Array.isArray(r.questions) && r.questions.some(q => q.type === 'text');
                    const allEssayDone = hasEssay && Array.isArray(r.questions) &&
                        r.questions.every((q, qi) => q.type !== 'text' || (r.manualScores && r.manualScores[qi] !== undefined && r.manualScores[qi] !== null));
                    const scoreDisplay = r.score != null && !isNaN(Number(r.score)) ? Number(r.score).toFixed(1) : '-';

                    let aiBtn = '';
                    if (hasEssay) {
                        if (allEssayDone) {
                            aiBtn = `<button onclick="batchAiCorrectEssay(${i})" id="ai-batch-btn-${i}" title="Koreksi ulang semua esai dengan AI" class="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-violet-100 hover:bg-violet-200 text-violet-700 text-[10px] font-black rounded-lg border border-violet-300 transition-all"><i class="fas fa-robot"></i> ✓ Koreksi Ulang</button>`;
                        } else {
                            aiBtn = `<button onclick="batchAiCorrectEssay(${i})" id="ai-batch-btn-${i}" title="Koreksi semua soal esai dengan AI" class="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-black rounded-lg transition-all shadow-sm"><i class="fas fa-magic"></i> Koreksi AI</button>`;
                        }
                    }

                    return `
                <tr>
                    <td class="px-6 py-4 font-bold">${r.studentName}</td>
                    <td class="px-6 py-4 text-xs">${r.rombel}</td>
                    <td class="px-6 py-4 text-xs font-medium">${r.mapel}</td>
                    <td class="px-6 py-4 text-xs">${r.date ? new Date(r.date).toLocaleString() : '-'}</td>
                    <td class="px-6 py-4 text-center">
                        <span class="font-black text-sky-600">${scoreDisplay}</span>
                        ${aiBtn}
                    </td>
                    <td class="px-6 py-4 text-center">
                        <button onclick="viewDetailedResult(${i})" class="text-sky-400 hover:text-sky-600 mr-2" title="Lihat Jawaban"><i class="fas fa-eye"></i></button>
                        <button onclick="deleteResult(${i})" class="text-red-400 hover:text-red-600" title="Hapus"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `;
                }).join('');

            tbody.innerHTML = rows;
        }

        function clearResultsFilter() {
            const f = document.getElementById('results-date-from');
            const t = document.getElementById('results-date-to');
            if (f) f.value = '';
            if (t) t.value = '';
            renderAdminResults();
        }

        function deleteResult(idx) {
            if (!confirm('Hapus hasil ujian ini?')) return;
            if (!db.results[idx]) return;
            db.results[idx].deleted = true;
            db.results[idx].updatedAt = Date.now();
            updateCompletionCharts();
            save();

            // Check which dashboard is currently active and render accordingly
            const adminDash = document.getElementById('admin-dashboard');
            const teacherDash = document.getElementById('teacher-dashboard');

            if (adminDash && !adminDash.classList.contains('hidden')) {
                renderAdminResults();
            } else if (teacherDash && !teacherDash.classList.contains('hidden')) {
                renderTeacherResults();
            }
        }

        function clearAllResults() {
            const activeResults = (db.results || []).filter(r => !r.deleted);
            if (activeResults.length === 0) {
                alert('Tidak ada hasil ujian tersisa untuk dihapus.');
                return;
            }

            if (!confirm('Anda yakin ingin menghapus semua data skor hasil ujian? Tindakan ini tidak dapat dibatalkan.')) return;

            const now = Date.now();
            // Tandai semua hasil sebagai dihapus; ini penting agar merge server menyampaikan status deleted.
            db.results = (db.results || []).map(r => ({
                ...r,
                deleted: true,
                updatedAt: now
            }));

            save();
            updateCompletionCharts();
            renderAdminResults();

            alert('Semua hasil ujian telah dihapus secara permanen.');
        }

        function viewDetailedResult(idx) {
            const result = db.results[idx];
            if (!result || result.deleted) {
                alert('Hasil ujian tidak ditemukan atau sudah dihapus.');
                return;
            }

            // VALIDASI: Ensure both answers dan questions exist dan valid
            const questions = Array.isArray(result.questions) ? result.questions : [];
            const answers = Array.isArray(result.answers) ? result.answers : [];

            if (questions.length === 0) {
                alert('Data soal tidak tersedia untuk hasil ujian ini.');
                return;
            }

            // Ensure arrays sama panjang
            while (answers.length < questions.length) {
                answers.push(null);
            }

            console.log(`Viewing result #${idx}: ${questions.length} soal, ${answers.length} jawaban`);

            // Helper function to escape HTML
            const escapeHtml = (text) => {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            };

            let content = `<div class="mb-8">
                <h3 class="text-2xl font-black text-slate-800 mb-2">Detail Jawaban - ${escapeHtml(result.studentName)}</h3>
                <p class="text-slate-600 text-sm font-medium">Rombel: <span class="font-bold text-slate-800">${result.rombel}</span> | Mata Pelajaran: <span class="font-bold text-slate-800">${result.mapel}</span> | Skor: <span class="font-bold text-sky-600 text-lg">${result.score}</span></p>
            </div>`;

            questions.forEach((q, i) => {
                // DEFENSIVE: Handle missing or invalid question
                if (!q || typeof q !== 'object') {
                    console.warn(`Question ${i} is invalid:`, q);
                    return;
                }

                const studentAnswer = answers[i];
                const correctAnswer = q.correct !== undefined ? q.correct : null;
                const qType = q.type || 'single';

                content += `<div class="mb-8 p-6 bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl border border-slate-200 shadow-sm">
                    <div class="flex items-center gap-3 mb-4">
                        <span class="w-8 h-8 bg-sky-600 text-white rounded-full flex items-center justify-center text-sm font-bold">${i + 1}</span>
                        <h4 class="font-bold text-slate-800 text-lg">Soal</h4>
                    </div>
                    <div class="text-slate-800 mb-4 leading-relaxed">${q.text}</div>
                    <p class="text-xs text-slate-500 mb-2"><strong>Jenis:</strong> ${qType === 'single' ? 'Pilihan ganda' : qType === 'multiple' ? 'Pilihan ganda (Kompleks)' : qType === 'text' ? 'Esai' : qType === 'tf' ? 'Benar / Salah' : escapeHtml(qType)}</p>`;

                if (q.images && Array.isArray(q.images) && q.images.length > 0) {
                    content += '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">';
                    q.images.forEach((img, imgIdx) => {
                        const imgSrc = typeof img === 'string' ? img : (img.data || '');
                        content += `<div class="relative">
                            <img src="${imgSrc}" alt="Gambar soal ${imgIdx + 1}" class="w-full h-auto rounded-lg border border-slate-300 shadow-sm">
                            <span class="absolute top-2 right-2 bg-sky-600 text-white text-xs font-bold px-2 py-1 rounded">${imgIdx + 1}</span>
                        </div>`;
                    });
                    content += '</div>';
                } else if (q.image) {
                    // Backward compatibility for single image
                    const imgSrcSingle = typeof q.image === 'string' ? q.image : (q.image.data || '');
                    content += `<img src="${imgSrcSingle}" alt="Gambar soal" class="mb-4 max-w-full h-auto rounded-lg border border-slate-300 shadow-sm">`;
                }

                // Display options and answers
                const qOptions = Array.isArray(q.options) ? q.options : [];

                if (qType === 'single' || qType === 'multiple') {
                    content += '<div class="space-y-2 mt-4">';
                    qOptions.forEach((opt, optIdx) => {
                        let isStudentAnswer = false;
                        let isCorrectAnswer = false;

                        if (qType === 'single') {
                            isStudentAnswer = studentAnswer === optIdx;
                            isCorrectAnswer = correctAnswer === optIdx;
                        } else if (qType === 'multiple') {
                            isStudentAnswer = Array.isArray(studentAnswer) && studentAnswer.includes(optIdx);
                            isCorrectAnswer = Array.isArray(correctAnswer) && correctAnswer.includes(optIdx);
                        }

                        let className = 'p-3 rounded-xl text-sm font-medium transition-all border-2 ';
                        let icon = '';

                        if (isCorrectAnswer && isStudentAnswer) {
                            className += 'bg-emerald-50 text-emerald-900 border-emerald-400 shadow-sm';
                            icon = '<i class="fas fa-check-circle text-emerald-600 mr-2"></i>';
                        } else if (isCorrectAnswer && !isStudentAnswer) {
                            className += 'bg-emerald-50 text-emerald-900 border-emerald-400 shadow-sm';
                            icon = '<i class="fas fa-lightbulb text-emerald-600 mr-2"></i>';
                        } else if (isStudentAnswer) {
                            className += 'bg-red-50 text-red-900 border-red-400 shadow-sm';
                            icon = '<i class="fas fa-times-circle text-red-600 mr-2"></i>';
                        } else {
                            className += 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50';
                            icon = '';
                        }

                        content += `<div class="${className}">${icon}<span class="font-bold">${String.fromCharCode(65 + optIdx)}.</span> ${opt}</div>`;
                    });
                    content += '</div>';
                } else if (qType === 'text') {
                    const studentText = studentAnswer || '';
                    const correctText = correctAnswer || '';
                    const manualScore = result.manualScores ? result.manualScores[i] : undefined;
                    const hasManualScore = manualScore !== undefined && manualScore !== null;
                    const aiFeedback = result.aiEssayFeedback ? result.aiEssayFeedback[i] : '';
                    content += `<div class="space-y-3 mt-4">
                        <div class="bg-white border-2 border-slate-200 rounded-xl p-4">
                            <p class="text-xs font-black text-slate-400 uppercase tracking-wider mb-2">Jawaban Siswa:</p>
                            <p class="text-slate-800 leading-relaxed whitespace-pre-wrap border-l-4 border-sky-400 pl-3">${escapeHtml(studentText) || '<em class="text-slate-400">Tidak dijawab</em>'}</p>
                        </div>
                        <div class="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4">
                            <p class="text-xs font-black text-emerald-600 uppercase tracking-wider mb-2">Kunci Jawaban:</p>
                            <p class="text-emerald-900 leading-relaxed whitespace-pre-wrap border-l-4 border-emerald-500 pl-3">${escapeHtml(correctText) || '<em class="text-emerald-500">Tidak ada kunci</em>'}</p>
                        </div>
                        ${hasManualScore ? `
                        <div class="rounded-xl border-2 border-violet-300 bg-violet-50 p-4">
                            <div class="flex items-center justify-between mb-2">
                                <p class="text-xs font-black text-violet-600 uppercase tracking-wider flex items-center gap-1"><i class="fas fa-robot"></i> Hasil Koreksi AI</p>
                                <span class="inline-flex items-center gap-1 px-3 py-1 bg-violet-600 text-white rounded-full text-xs font-black"><i class="fas fa-star"></i> ${Number(manualScore).toFixed(1)} / 5</span>
                            </div>
                            ${aiFeedback ? `<p class="text-slate-700 text-sm leading-relaxed italic mb-3">"${escapeHtml(aiFeedback)}"</p>` : ''}
                            <div class="flex items-center gap-2 flex-wrap mt-1">
                                <label class="text-xs text-slate-500 font-semibold">Ubah Skor Manual:</label>
                                <input type="number" id="ai-essay-score-input-${idx}-${i}" min="0" max="5" step="0.5" value="${Number(manualScore).toFixed(1)}" class="w-20 border border-slate-300 rounded-lg px-2 py-1 text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-violet-400">
                                <button onclick="applyEssayScore(${idx}, ${i}, document.getElementById('ai-essay-score-input-${idx}-${i}').value)" class="px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-lg transition-colors"><i class="fas fa-check mr-1"></i>Terapkan</button>
                            </div>
                        </div>` : `
                        <div class="rounded-xl border-2 border-dashed border-violet-200 bg-violet-50/40 p-4 text-center">
                            <i class="fas fa-robot text-violet-300 text-2xl mb-2"></i>
                            <p class="text-violet-400 text-xs font-semibold">Belum dikoreksi AI.<br>Gunakan tombol <strong>"Koreksi AI"</strong> di tabel hasil ujian.</p>
                        </div>`}
                    </div>`;

                } else if (qType === 'tf') {
                    content += '<div class="space-y-2 mt-4">';
                    qOptions.forEach((opt, optIdx) => {
                        const studentAns = Array.isArray(studentAnswer) ? studentAnswer[optIdx] : null;
                        const correctAns = Array.isArray(correctAnswer) ? correctAnswer[optIdx] : null;
                        const isCorrect = studentAns === correctAns;
                        const studentText = studentAns === true ? 'Benar' : studentAns === false ? 'Salah' : 'Tidak dijawab';
                        const correctText = correctAns === true ? 'Benar' : correctAns === false ? 'Salah' : 'N/A';

                        let className = 'p-4 rounded-xl text-sm font-medium border-2 transition-all ';
                        let icon = '';

                        if (isCorrect) {
                            className += 'bg-emerald-50 text-emerald-900 border-emerald-400 shadow-sm';
                            icon = '<i class="fas fa-check-circle text-emerald-600 mr-2"></i>';
                        } else {
                            className += 'bg-red-50 text-red-900 border-red-400 shadow-sm';
                            icon = '<i class="fas fa-times-circle text-red-600 mr-2"></i>';
                        }

                        content += `<div class="${className}">
                            ${icon}
                            <div class="flex justify-between items-start">
                                <span class="flex-1">${opt}</span>
                                <div class="text-right ml-4">
                                    <div class="text-xs text-slate-500 mb-1">Siswa: <span class="font-bold">${studentText}</span></div>
                                    <div class="text-xs text-slate-500">Kunci: <span class="font-bold">${correctText}</span></div>
                                </div>
                            </div>
                        </div>`;
                    });
                    content += '</div>';
                } else if (qType === 'matching') {
                    // Fallback: If questions/answers were not saved in result, try to find them in the bank
                    let qSubQuestions = q.questions || [];
                    let qSubAnswers = q.answers || [];

                    if (qSubQuestions.length === 0) {
                        const originalQ = db.questions.find(orig => (orig.text === q.text || orig.type === 'matching') && orig.mapel === q.mapel && orig.rombel === q.rombel && orig.type === 'matching');
                        if (originalQ) {
                            qSubQuestions = originalQ.questions || [];
                            qSubAnswers = originalQ.answers || [];
                        }
                    }

                    content += '<div class="space-y-3 mt-4">';
                    if (qSubQuestions.length === 0) {
                        content += '<div class="p-4 bg-yellow-50 text-yellow-700 text-xs rounded-xl border border-yellow-200">Data pertanyaan menjodohkan tidak ditemukan.</div>';
                    }
                    qSubQuestions.forEach((subQ, qi) => {
                        const sAns = Array.isArray(studentAnswer) ? studentAnswer[qi] : 'Tidak dijawab';
                        const cAns = Array.isArray(correctAnswer) ? correctAnswer[qi] : 'N/A';
                        const isCorrect = sAns === cAns;

                        let className = 'p-4 rounded-2xl border-2 transition-all ';
                        let icon = '';

                        if (isCorrect) {
                            className += 'bg-emerald-50 border-emerald-200 text-emerald-900 shadow-sm';
                            icon = '<i class="fas fa-check-circle text-emerald-500"></i>';
                        } else {
                            className += 'bg-red-50 border-red-200 text-red-900 shadow-sm';
                            icon = '<i class="fas fa-times-circle text-red-500"></i>';
                        }

                        content += `
                        <div class="${className}">
                            <div class="flex items-center justify-between gap-4">
                                <div class="flex items-center gap-3 flex-1 min-w-0">
                                    <div class="w-8 h-8 rounded-lg bg-white/50 flex items-center justify-center text-xs font-bold border border-current/10 flex-shrink-0">${qi + 1}</div>
                                    <div class="truncate font-semibold">${subQ}</div>
                                </div>
                                <div class="flex items-center gap-3">
                                    <div class="text-right">
                                        <div class="text-[10px] uppercase font-black opacity-40 mb-1">Pasangan</div>
                                        <div class="text-sm font-black">${String(sAns || 'Kosong')}</div>
                                        ${!isCorrect ? `<div class="text-[10px] text-emerald-600 font-bold mt-1">Kunci: ${String(cAns)}</div>` : ''}
                                    </div>
                                    <div class="text-lg">${icon}</div>
                                </div>
                            </div>
                        </div>`;
                    });
                    content += '</div>';
                } else {
                    content += `<div class="bg-yellow-50 border border-yellow-300 rounded-xl p-4 text-yellow-800 text-sm">
                        <i class="fas fa-exclamation-triangle mr-2"></i>
                        Tipe soal tidak dikenali: ${escapeHtml(qType)}
                    </div>`;
                }

                content += '</div>';
            });

            // Create modal
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm';
            modal.innerHTML = `
                <div class="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto animate-fade-in">
                    <div class="flex justify-between items-center p-8 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white sticky top-0">
                        <h2 class="text-2xl font-black text-slate-800">Detail Jawaban Ujian</h2>
                        <button onclick="this.closest('.fixed').remove()" class="text-slate-400 hover:text-slate-600 text-2xl transition-colors">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="p-8">
                        ${content}
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        async function batchAiCorrectAllStudents() {
            // Determine which results are currently visible (respects active filters)
            const isTeacher = document.getElementById('teacher-dashboard') && !document.getElementById('teacher-dashboard').classList.contains('hidden');

            let targetResults = []; // { resultIdx, result }

            if (isTeacher && currentSiswa && currentSiswa.subjects) {
                const selectedMapel = document.getElementById('teacher-results-filter-mapel')?.value || '';
                const selectedRombel = document.getElementById('teacher-results-filter-rombel')?.value || '';
                db.results.forEach((r, i) => {
                    if (r.deleted) return;
                    if (!teacherSubjectNames(currentSiswa).includes(r.mapel)) return;
                    const allowed = teacherAllowedRombels(currentSiswa, r.mapel);
                    if (!allowed.includes(r.rombel)) return;
                    if (selectedMapel && r.mapel !== selectedMapel) return;
                    if (selectedRombel && r.rombel !== selectedRombel) return;
                    if (Array.isArray(r.questions) && r.questions.some(q => q.type === 'text')) {
                        targetResults.push({ resultIdx: i, result: r });
                    }
                });
            } else {
                const rombelFilter = document.getElementById('results-filter-rombel')?.value;
                const mapelFilter = document.getElementById('results-filter-mapel')?.value;
                const from = document.getElementById('results-date-from')?.value;
                const to = document.getElementById('results-date-to')?.value;
                const fromTs = from ? new Date(from + 'T00:00:00').getTime() : null;
                const toTs = to ? new Date(to + 'T23:59:59').getTime() : null;

                db.results.forEach((r, i) => {
                    if (r.deleted) return;
                    if (rombelFilter && rombelFilter !== 'ALL' && r.rombel !== rombelFilter) return;
                    if (mapelFilter && mapelFilter !== 'ALL' && r.mapel !== mapelFilter) return;
                    if (fromTs || toTs) {
                        if (!r.date) return;
                        const t = new Date(r.date).getTime();
                        if (fromTs && t < fromTs) return;
                        if (toTs && t > toTs) return;
                    }
                    if (Array.isArray(r.questions) && r.questions.some(q => q.type === 'text')) {
                        targetResults.push({ resultIdx: i, result: r });
                    }
                });
            }

            if (targetResults.length === 0) {
                alert('Tidak ada data hasil ujian dengan soal esai yang ditemukan sesuai filter saat ini.');
                return;
            }

            // Count total essays across all students
            const totalEssays = targetResults.reduce((sum, { result }) =>
                sum + (result.questions || []).filter(q => q.type === 'text').length, 0);

            if (!confirm(`Akan mengoreksi ${totalEssays} soal esai dari ${targetResults.length} siswa menggunakan AI.\n\nProses ini mungkin membutuhkan waktu beberapa menit. Lanjutkan?`)) return;

            // Show master progress overlay
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-slate-900/80 flex items-center justify-center z-50 backdrop-blur-sm';
            overlay.innerHTML = `
                <div class="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full mx-4 text-center">
                    <div class="w-16 h-16 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
                        <i class="fas fa-robot text-white text-2xl"></i>
                    </div>
                    <h3 class="text-lg font-black text-slate-800 mb-1">Koreksi AI Semua Siswa</h3>
                    <p id="batch-all-student-label" class="text-slate-500 text-sm mb-1">Menyiapkan...</p>
                    <p id="batch-all-question-label" class="text-violet-500 text-xs font-semibold mb-4"></p>
                    <div class="w-full bg-slate-100 rounded-full h-3 mb-2">
                        <div id="batch-all-progress" class="h-3 bg-gradient-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-300" style="width:0%"></div>
                    </div>
                    <p id="batch-all-counter" class="text-xs text-slate-400 font-semibold">0 / ${totalEssays} soal esai</p>
                </div>`;
            document.body.appendChild(overlay);

            const studentLabel = document.getElementById('batch-all-student-label');
            const questionLabel = document.getElementById('batch-all-question-label');
            const progressBar = document.getElementById('batch-all-progress');
            const counterEl = document.getElementById('batch-all-counter');

            let doneEssays = 0;
            let totalSuccess = 0;
            let totalError = 0;

            for (let si = 0; si < targetResults.length; si++) {
                const { resultIdx, result } = targetResults[si];
                const questions = result.questions || [];
                const answers = result.answers || [];
                const essayIndices = questions.reduce((acc, q, i) => { if (q.type === 'text') acc.push(i); return acc; }, []);

                if (studentLabel) studentLabel.textContent = `Siswa ${si + 1}/${targetResults.length}: ${result.studentName}`;

                if (!result.manualScores) result.manualScores = {};
                if (!result.aiEssayFeedback) result.aiEssayFeedback = {};

                for (let ei = 0; ei < essayIndices.length; ei++) {
                    const qi = essayIndices[ei];
                    const q = questions[qi];
                    const studentAnswer = answers[qi];

                    if (questionLabel) questionLabel.textContent = `Soal esai ${ei + 1}/${essayIndices.length}: "${(q.text || '').substring(0, 60)}..."`;
                    doneEssays++;
                    const pct = Math.round((doneEssays / totalEssays) * 100);
                    if (progressBar) progressBar.style.width = pct + '%';
                    if (counterEl) counterEl.textContent = `${doneEssays} / ${totalEssays} soal esai`;

                    try {
                        const response = await fetch(getApiBaseUrl() + '/api/ai-correct-essay', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                questionText: q.text || '',
                                studentAnswer: typeof studentAnswer === 'string' ? studentAnswer : '',
                                referenceAnswer: q.correct || '',
                                teacherId: currentSiswa ? currentSiswa.id : null
                            })
                        });
                        const data = await response.json();
                        if (response.ok && data.ok) {
                            result.manualScores[qi] = data.score;
                            result.aiEssayFeedback[qi] = data.feedback;
                            totalSuccess++;
                        } else {
                            totalError++;
                        }
                    } catch (e) {
                        console.error(`[batchAll] Error student ${result.studentName} q${qi}:`, e.message);
                        totalError++;
                    }
                }

                // Recalculate score for this student
                let totalItems = 0, correctCount = 0;
                questions.forEach((q, i) => {
                    const ans = answers[i];
                    const qType = q.type || 'single';
                    if (qType === 'text') {
                        totalItems += 5;
                        correctCount += (result.manualScores[i] !== undefined && result.manualScores[i] !== null) ? result.manualScores[i] : 0;
                    } else if (qType === 'tf' && Array.isArray(q.options)) {
                        const ansArr = Array.isArray(ans) ? ans : [];
                        q.options.forEach((_, j) => { totalItems++; if (ansArr[j] === (Array.isArray(q.correct) ? q.correct[j] : false)) correctCount++; });
                    } else if (qType === 'multiple') {
                        const corr = Array.isArray(q.correct) ? q.correct : [];
                        const ansArr = Array.isArray(ans) ? ans : [];
                        totalItems += corr.length > 0 ? corr.length : 1;
                        correctCount += ansArr.filter(idx => corr.includes(idx)).length;
                    } else if (qType === 'matching') {
                        const ansArr = Array.isArray(ans) ? ans : [];
                        if (Array.isArray(q.questions)) { q.questions.forEach((_, qi2) => { totalItems++; if (ansArr[qi2] !== null && ansArr[qi2] !== undefined && ansArr[qi2] === (q.correct ? q.correct[qi2] : null)) correctCount++; }); }
                        else totalItems++;
                    } else {
                        totalItems++;
                        if (ans === q.correct) correctCount++;
                    }
                });

                result.score = totalItems > 0 ? ((correctCount / totalItems) * 100).toFixed(1) : '0.0';
                result.updatedAt = Date.now();
                db.results[resultIdx] = result;
            }

            // Save all at once
            if (studentLabel) studentLabel.textContent = 'Menyimpan semua hasil...';
            try { await save(); } catch (e) { console.error('[batchAll] Save error:', e.message); }

            overlay.remove();

            // Refresh active dashboard
            const adminDash = document.getElementById('admin-dashboard');
            const teacherDash = document.getElementById('teacher-dashboard');
            if (adminDash && !adminDash.classList.contains('hidden')) renderAdminResults();
            else if (teacherDash && !teacherDash.classList.contains('hidden')) renderTeacherResults();

            const msg = totalError === 0
                ? `✅ Selesai! ${totalSuccess} soal esai dari ${targetResults.length} siswa berhasil dikoreksi AI.`
                : `⚠️ ${totalSuccess} berhasil, ${totalError} gagal dari total ${totalEssays} soal esai.`;
            alert(msg);
        }

        async function batchAiCorrectEssay(resultIdx) {
            const result = db.results[resultIdx];
            if (!result) return;

            const questions = result.questions || [];
            const answers = result.answers || [];

            // Collect all essay question indices
            const essayIndices = questions.reduce((acc, q, i) => {
                if (q.type === 'text') acc.push(i);
                return acc;
            }, []);

            if (essayIndices.length === 0) {
                alert('Tidak ada soal esai dalam ujian ini.');
                return;
            }

            // Show progress overlay
            const overlay = document.createElement('div');
            overlay.id = 'ai-batch-overlay';
            overlay.className = 'fixed inset-0 bg-slate-900/70 flex items-center justify-center z-50 backdrop-blur-sm';
            overlay.innerHTML = `
                <div class="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center">
                    <div class="w-16 h-16 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
                        <i class="fas fa-robot text-white text-2xl"></i>
                    </div>
                    <h3 class="text-lg font-black text-slate-800 mb-1">AI Sedang Mengoreksi</h3>
                    <p id="ai-batch-status" class="text-slate-500 text-sm mb-4">Memproses soal esai...</p>
                    <div class="w-full bg-slate-100 rounded-full h-3 mb-2">
                        <div id="ai-batch-progress" class="h-3 bg-gradient-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-500" style="width: 0%"></div>
                    </div>
                    <p id="ai-batch-counter" class="text-xs text-slate-400 font-semibold">0 / ${essayIndices.length} soal</p>
                </div>`;
            document.body.appendChild(overlay);

            const statusEl = document.getElementById('ai-batch-status');
            const progressEl = document.getElementById('ai-batch-progress');
            const counterEl = document.getElementById('ai-batch-counter');

            const btn = document.getElementById(`ai-batch-btn-${resultIdx}`);
            if (btn) btn.disabled = true;

            let successCount = 0;
            let errorCount = 0;

            if (!result.manualScores) result.manualScores = {};
            if (!result.aiEssayFeedback) result.aiEssayFeedback = {};

            for (let idx = 0; idx < essayIndices.length; idx++) {
                const qi = essayIndices[idx];
                const q = questions[qi];
                const studentAnswer = answers[qi];

                if (statusEl) statusEl.textContent = `Mengoreksi soal ${idx + 1} dari ${essayIndices.length}...`;
                if (progressEl) progressEl.style.width = `${((idx) / essayIndices.length) * 100}%`;
                if (counterEl) counterEl.textContent = `${idx} / ${essayIndices.length} soal selesai`;

                try {
                    const response = await fetch(getApiBaseUrl() + '/api/ai-correct-essay', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            questionText: q.text || '',
                            studentAnswer: typeof studentAnswer === 'string' ? studentAnswer : '',
                            referenceAnswer: q.correct || '',
                            teacherId: currentSiswa ? currentSiswa.id : null
                        })
                    });
                    const data = await response.json();
                    if (response.ok && data.ok) {
                        result.manualScores[qi] = data.score;
                        result.aiEssayFeedback[qi] = data.feedback;
                        successCount++;
                    } else {
                        errorCount++;
                    }
                } catch (e) {
                    console.error(`[batchAiCorrect] Error on question ${qi}:`, e.message);
                    errorCount++;
                }
            }

            // Final progress
            if (progressEl) progressEl.style.width = '100%';
            if (counterEl) counterEl.textContent = `${essayIndices.length} / ${essayIndices.length} soal selesai`;
            if (statusEl) statusEl.textContent = 'Menghitung ulang skor...';

            // Recalculate total score
            let totalItems = 0;
            let correctCount = 0;
            questions.forEach((q, i) => {
                const ans = answers[i];
                const qType = q.type || 'single';
                if (qType === 'text') {
                    const essayScore = (result.manualScores[i] !== undefined && result.manualScores[i] !== null) ? result.manualScores[i] : 0;
                    totalItems += 5;
                    correctCount += essayScore;
                } else if (qType === 'tf' && Array.isArray(q.options)) {
                    const ansArr = Array.isArray(ans) ? ans : [];
                    q.options.forEach((_, j) => {
                        totalItems++;
                        const corrVal = Array.isArray(q.correct) ? q.correct[j] : false;
                        if (ansArr[j] === corrVal) correctCount++;
                    });
                } else if (qType === 'multiple') {
                    const corr = Array.isArray(q.correct) ? q.correct : [];
                    const ansArr = Array.isArray(ans) ? ans : [];
                    const totalCorrectOpts = corr.length > 0 ? corr.length : 1;
                    totalItems += totalCorrectOpts;
                    correctCount += ansArr.filter(idx2 => corr.includes(idx2)).length;
                } else if (qType === 'matching') {
                    const ansArr = Array.isArray(ans) ? ans : [];
                    if (Array.isArray(q.questions)) {
                        q.questions.forEach((_, qi2) => {
                            totalItems++;
                            if (ansArr[qi2] !== null && ansArr[qi2] !== undefined && ansArr[qi2] === (q.correct ? q.correct[qi2] : null)) correctCount++;
                        });
                    } else {
                        totalItems++;
                    }
                } else {
                    totalItems++;
                    if (ans === q.correct) correctCount++;
                }
            });

            const newScore = totalItems > 0 ? ((correctCount / totalItems) * 100).toFixed(1) : '0.0';
            result.score = newScore;
            result.updatedAt = Date.now();
            db.results[resultIdx] = result;

            // Save and close overlay
            try {
                await save();
            } catch (e) {
                console.error('[batchAiCorrect] Save error:', e.message);
            }

            overlay.remove();
            if (btn) btn.disabled = false;

            // Refresh the active dashboard
            const adminDash = document.getElementById('admin-dashboard');
            const teacherDash = document.getElementById('teacher-dashboard');
            if (adminDash && !adminDash.classList.contains('hidden')) {
                renderAdminResults();
            } else if (teacherDash && !teacherDash.classList.contains('hidden')) {
                renderTeacherResults();
            }

            const msg = errorCount === 0
                ? `✅ Semua ${successCount} soal esai berhasil dikoreksi AI!\nSkor baru: ${newScore}`
                : `⚠️ ${successCount} soal berhasil, ${errorCount} soal gagal.\nSkor baru: ${newScore}`;
            alert(msg);
        }

        async function runAiCorrection(resultIdx, qIdx) {
            const result = db.results[resultIdx];
            if (!result) return;
            const q = (result.questions || [])[qIdx];
            const studentAnswer = (result.answers || [])[qIdx];

            const btnEl = document.getElementById(`ai-essay-btn-${resultIdx}-${qIdx}`);
            const loadingEl = document.getElementById(`ai-essay-loading-${resultIdx}-${qIdx}`);
            const resultEl = document.getElementById(`ai-essay-result-${resultIdx}-${qIdx}`);
            const panelEl = document.getElementById(`ai-essay-panel-${resultIdx}-${qIdx}`);

            if (btnEl) btnEl.disabled = true;
            if (loadingEl) { loadingEl.classList.remove('hidden'); loadingEl.style.display = 'flex'; }

            try {
                const response = await fetch(getApiBaseUrl() + '/api/ai-correct-essay', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        questionText: q ? q.text : '',
                        studentAnswer: typeof studentAnswer === 'string' ? studentAnswer : '',
                        referenceAnswer: q ? (q.correct || '') : '',
                        teacherId: currentSiswa ? currentSiswa.id : null
                    })
                });

                const data = await response.json();
                if (!response.ok || !data.ok) {
                    alert('Gagal koreksi AI: ' + (data.error || 'Terjadi kesalahan.'));
                    return;
                }

                const score = data.score;
                const feedback = data.feedback;

                // Display result in UI
                if (resultEl) {
                    resultEl.innerHTML = `
                        <p class="text-slate-700 text-sm leading-relaxed mb-3 italic">"${feedback.replace(/</g,'&lt;').replace(/>/g,'&gt;')}"</p>
                        <div class="flex items-center gap-2 flex-wrap">
                            <label class="text-xs text-slate-500 font-semibold">Skor AI: <strong class="text-violet-700">${score.toFixed(1)}/5</strong> &nbsp;|&nbsp; Ubah:</label>
                            <input type="number" id="ai-essay-score-input-${resultIdx}-${qIdx}" min="0" max="5" step="0.5" value="${score.toFixed(1)}" class="w-20 border border-slate-300 rounded-lg px-2 py-1 text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-violet-400">
                            <button onclick="applyEssayScore(${resultIdx}, ${qIdx}, document.getElementById('ai-essay-score-input-${resultIdx}-${qIdx}').value)" class="px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-lg transition-colors"><i class="fas fa-check mr-1"></i>Terapkan Skor</button>
                        </div>`;
                    resultEl.classList.remove('hidden');
                }

                // Update panel badge
                if (panelEl) {
                    panelEl.classList.remove('border-slate-200');
                    panelEl.classList.add('border-violet-300', 'bg-violet-50');
                    const badgeContainer = panelEl.querySelector('.flex.items-center.justify-between');
                    if (badgeContainer) {
                        const existingBadge = badgeContainer.querySelector('span');
                        if (existingBadge) existingBadge.remove();
                        const badge = document.createElement('span');
                        badge.className = 'inline-flex items-center gap-1 px-3 py-1 bg-violet-500 text-white rounded-full text-xs font-black';
                        badge.innerHTML = `<i class="fas fa-star"></i> Skor AI: ${score.toFixed(1)} / 5`;
                        badgeContainer.appendChild(badge);
                    }
                }

                if (btnEl) btnEl.textContent = '✦ Koreksi Ulang dengan AI';

            } catch (e) {
                alert('Error: ' + e.message);
            } finally {
                if (loadingEl) { loadingEl.classList.add('hidden'); loadingEl.style.display = ''; }
                if (btnEl) btnEl.disabled = false;
            }
        }

        async function applyEssayScore(resultIdx, qIdx, rawScore) {
            const result = db.results[resultIdx];
            if (!result) return;

            const score = Math.min(5, Math.max(0, parseFloat(rawScore) || 0));

            // Save manual score and feedback
            if (!result.manualScores) result.manualScores = {};
            result.manualScores[qIdx] = score;

            // Also persist AI feedback if available
            const feedbackEl = document.getElementById(`ai-essay-result-${resultIdx}-${qIdx}`)?.querySelector('p.italic');
            if (feedbackEl) {
                if (!result.aiEssayFeedback) result.aiEssayFeedback = {};
                result.aiEssayFeedback[qIdx] = feedbackEl.textContent.replace(/^"|"$/g, '');
            }

            // Recalculate total score
            // Essay questions get a weight of 5 (max). Others use the existing per-item scoring.
            const questions = result.questions || [];
            const answers = result.answers || [];
            let totalItems = 0;
            let correctCount = 0;

            questions.forEach((q, i) => {
                const ans = answers[i];
                const qType = q.type || 'single';

                if (qType === 'text') {
                    // Essay contributes 5 points max
                    const essayScore = (result.manualScores && result.manualScores[i] !== undefined && result.manualScores[i] !== null)
                        ? result.manualScores[i]
                        : 0;
                    totalItems += 5;
                    correctCount += essayScore;
                } else if (qType === 'tf' && Array.isArray(q.options)) {
                    const ansArr = Array.isArray(ans) ? ans : [];
                    q.options.forEach((_, j) => {
                        totalItems++;
                        const corrVal = Array.isArray(q.correct) ? q.correct[j] : false;
                        if (ansArr[j] === corrVal) correctCount++;
                    });
                } else if (qType === 'multiple') {
                    const corr = Array.isArray(q.correct) ? q.correct : [];
                    const ansArr = Array.isArray(ans) ? ans : [];
                    const totalCorrectOpts = corr.length > 0 ? corr.length : 1;
                    totalItems += totalCorrectOpts;
                    correctCount += ansArr.filter(idx => corr.includes(idx)).length;
                } else if (qType === 'matching') {
                    const ansArr = Array.isArray(ans) ? ans : [];
                    if (Array.isArray(q.questions)) {
                        q.questions.forEach((_, qi) => {
                            totalItems++;
                            if (ansArr[qi] !== null && ansArr[qi] !== undefined && ansArr[qi] === (q.correct ? q.correct[qi] : null)) correctCount++;
                        });
                    } else {
                        totalItems++;
                    }
                } else {
                    totalItems++;
                    if (ans === q.correct) correctCount++;
                }
            });

            const newScore = totalItems > 0 ? ((correctCount / totalItems) * 100).toFixed(1) : '0.0';
            result.score = newScore;
            result.updatedAt = Date.now();

            // Update in db array
            db.results[resultIdx] = result;

            // Persist to backend
            try {
                await save();
                // Refresh score in modal badge
                const panelEl = document.getElementById(`ai-essay-panel-${resultIdx}-${qIdx}`);
                if (panelEl) {
                    const badgeContainer = panelEl.querySelector('.flex.items-center.justify-between');
                    if (badgeContainer) {
                        const existingBadge = badgeContainer.querySelector('span');
                        if (existingBadge) {
                            existingBadge.innerHTML = `<i class="fas fa-star"></i> Skor: ${score.toFixed(1)} / 5`;
                            existingBadge.className = 'inline-flex items-center gap-1 px-3 py-1 bg-violet-600 text-white rounded-full text-xs font-black';
                        }
                    }
                }
                // Refresh active results table
                const adminDash2 = document.getElementById('admin-dashboard');
                const teacherDash2 = document.getElementById('teacher-dashboard');
                if (adminDash2 && !adminDash2.classList.contains('hidden')) {
                    renderAdminResults();
                } else if (teacherDash2 && !teacherDash2.classList.contains('hidden')) {
                    renderTeacherResults();
                }
                alert(`✅ Skor esai berhasil diterapkan! Skor baru: ${score.toFixed(1)}/5 → Total ujian: ${newScore}`);

            } catch (e) {
                alert('Gagal menyimpan skor: ' + e.message);
            }
        }

        function exportResultsToExcel() {
            const from = document.getElementById('results-date-from')?.value;
            const to = document.getElementById('results-date-to')?.value;
            const fromTs = from ? new Date(from + 'T00:00:00').getTime() : null;
            const toTs = to ? new Date(to + 'T23:59:59').getTime() : null;

            // Filter the results using the same logic as renderAdminResults
            const filteredResults = db.results.filter(r => {
                const rombelFilter = document.getElementById('results-filter-rombel')?.value;
                const mapelFilter = document.getElementById('results-filter-mapel')?.value;

                if (rombelFilter && rombelFilter !== 'ALL' && r.rombel !== rombelFilter) return false;
                if (mapelFilter && mapelFilter !== 'ALL' && r.mapel !== mapelFilter) return false;

                if (!fromTs && !toTs) return true;
                if (!r.date) return false;
                const t = new Date(r.date).getTime();
                if (fromTs && t < fromTs) return false;
                if (toTs && t > toTs) return false;
                return true;
            });

            // Prepare data for Excel
            const excelData = filteredResults.map(r => {
                let row = {
                    'Nama Siswa': r.studentName,
                    'Rombel': r.rombel,
                    'Mata Pelajaran': r.mapel,
                    'Tanggal': r.date ? new Date(r.date).toLocaleString() : '-',
                    'Skor Akhir': r.score
                };

                // Add answers if available
                if (r.questions && r.answers) {
                    r.questions.forEach((q, i) => {
                        // catat jenis soal
                        row[`Jenis Soal ${i + 1}`] = q.type || 'single';

                        const studentAnswer = r.answers[i];
                        let answerText = '';

                        if (q.type === 'single') {
                            answerText = studentAnswer !== undefined && q.options ? q.options[studentAnswer] || 'Tidak dijawab' : 'Tidak dijawab';
                        } else if (q.type === 'multiple') {
                            if (Array.isArray(studentAnswer) && q.options) {
                                answerText = studentAnswer.map(idx => q.options[idx]).join('; ') || 'Tidak dijawab';
                            } else {
                                answerText = 'Tidak dijawab';
                            }
                        } else if (q.type === 'text') {
                            answerText = studentAnswer || 'Tidak dijawab';
                        } else if (q.type === 'tf') {
                            if (Array.isArray(studentAnswer) && q.options) {
                                answerText = q.options.map((opt, idx) => `${opt}: ${studentAnswer[idx] ? 'Benar' : 'Salah'}`).join('; ');
                            } else {
                                answerText = 'Tidak dijawab';
                            }
                        } else if (q.type === 'matching') {
                            let qSubQuestions = q.questions || [];
                            if (qSubQuestions.length === 0) {
                                const orig = db.questions.find(o => (o.text === q.text || o.type === 'matching') && o.mapel === q.mapel && o.type === 'matching');
                                if (orig) qSubQuestions = orig.questions || [];
                            }
                            if (Array.isArray(studentAnswer) && qSubQuestions.length > 0) {
                                answerText = qSubQuestions.map((sq, idx) => `${sq}: ${studentAnswer[idx] || 'Tidak dijawab'}`).join('; ');
                            } else {
                                answerText = 'Tidak dijawab';
                            }
                        }

                        row[`Jawaban Soal ${i + 1}`] = answerText;
                    });
                }

                return row;
            });

            // Create workbook and worksheet
            const worksheet = XLSX.utils.json_to_sheet(excelData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Hasil Ujian');

            // Set column widths
            worksheet['!cols'] = [
                { wch: 25 },  // Nama Siswa
                { wch: 12 },  // Rombel
                { wch: 20 },  // Mata Pelajaran
                { wch: 18 },  // Tanggal
                { wch: 12 }   // Skor Akhir
            ];

            // Generate filename with timestamp
            const timestamp = new Date().toISOString().split('T')[0];
            const filename = `Hasil_Ujian_${timestamp}.xlsx`;

            // Write the file
            XLSX.writeFile(workbook, filename);
        }

        function exportTeacherResultsToExcel() {
            if (!currentSiswa || !currentSiswa.subjects) {
                alert('Data guru tidak valid');
                return;
            }

            // Get filter values
            const selectedMapel = document.getElementById('teacher-results-filter-mapel')?.value || '';
            const selectedRombel = document.getElementById('teacher-results-filter-rombel')?.value || '';

            // Filter results using the same logic as renderTeacherResults
            let filteredResults = db.results.filter(r => {
                // Filter out deleted results
                if (r.deleted) return false;

                // Filter by teacher's subjects (normalized)
                if (!teacherSubjectNames(currentSiswa).includes(r.mapel)) return false;
                // also restrict by rombels per subject
                const allowed = teacherAllowedRombels(currentSiswa, r.mapel);
                if (!allowed.includes(r.rombel)) return false;

                // Filter by selected mapel
                if (selectedMapel && r.mapel !== selectedMapel) return false;

                // Filter by selected rombel
                if (selectedRombel && r.rombel !== selectedRombel) return false;

                return true;
            });

            // Prepare data for Excel
            const excelData = filteredResults.map(r => {
                let row = {
                    'Nama Siswa': r.studentName,
                    'Rombel': r.rombel,
                    'Mata Pelajaran': r.mapel,
                    'Tanggal': r.date ? new Date(r.date).toLocaleString() : '-',
                    'Skor Akhir': r.score
                };

                // Add answers if available
                if (r.questions && r.answers) {
                    r.questions.forEach((q, i) => {
                        // sertakan jenis soal
                        row[`Jenis Soal ${i + 1}`] = q.type || 'single';

                        const studentAnswer = r.answers[i];
                        let answerText = '';

                        if (q.type === 'single') {
                            answerText = studentAnswer !== undefined && q.options ? q.options[studentAnswer] || 'Tidak dijawab' : 'Tidak dijawab';
                        } else if (q.type === 'multiple') {
                            if (Array.isArray(studentAnswer) && q.options) {
                                answerText = studentAnswer.map(idx => q.options[idx]).join('; ') || 'Tidak dijawab';
                            } else {
                                answerText = 'Tidak dijawab';
                            }
                        } else if (q.type === 'text') {
                            answerText = studentAnswer || 'Tidak dijawab';
                        } else if (q.type === 'tf') {
                            if (Array.isArray(studentAnswer) && q.options) {
                                answerText = q.options.map((opt, idx) => `${opt}: ${studentAnswer[idx] ? 'Benar' : 'Salah'}`).join('; ');
                            } else {
                                answerText = 'Tidak dijawab';
                            }
                        } else if (q.type === 'matching') {
                            let qSubQuestions = q.questions || [];
                            if (qSubQuestions.length === 0) {
                                const orig = db.questions.find(o => (o.text === q.text || o.type === 'matching') && o.mapel === q.mapel && o.type === 'matching');
                                if (orig) qSubQuestions = orig.questions || [];
                            }
                            if (Array.isArray(studentAnswer) && qSubQuestions.length > 0) {
                                answerText = qSubQuestions.map((sq, idx) => `${sq}: ${studentAnswer[idx] || 'Tidak dijawab'}`).join('; ');
                            } else {
                                answerText = 'Tidak dijawab';
                            }
                        }

                        row[`Jawaban Soal ${i + 1}`] = answerText;
                    });
                }

                return row;
            });

            // Create workbook and worksheet
            const worksheet = XLSX.utils.json_to_sheet(excelData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Hasil Ujian');

            // Set column widths
            worksheet['!cols'] = [
                { wch: 25 },  // Nama Siswa
                { wch: 12 },  // Rombel
                { wch: 20 },  // Mata Pelajaran
                { wch: 18 },  // Tanggal
                { wch: 12 }   // Skor Akhir
            ];

            // Generate filename with timestamp
            const timestamp = new Date().toISOString().split('T')[0];
            const filename = `Hasil_Ujian_Siswa_${timestamp}.xlsx`;

            // Write the file
            XLSX.writeFile(workbook, filename);
        }

        function openConfigModal(type) {
            currentConfigType = type;
            document.getElementById('config-title').innerText = "Tambah " + (type === 'mapel' ? 'Mata Pelajaran' : 'Rombel');
            document.getElementById('config-modal').classList.replace('hidden', 'flex');
        }

        function saveConfig() {
            const val = document.getElementById('config-input').value.trim();
            if (!val) return;
            if (currentConfigType === 'mapel') {
                // Check if subject already exists
                if (!db.subjects.find(s => getSubjectName(s) === val)) {
                    db.subjects.push({ name: val, locked: false });
                }
            } else {
                db.rombels.push(val);
            }
            save();
            closeModals();
            showAdminSection('rombel');
        }

        function exportDatabase() {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db));
            const dl = document.createElement('a');
            dl.setAttribute("href", dataStr);
            dl.setAttribute("download", `BACKUP_DORKAS_${new Date().toISOString().slice(0, 10)}.json`);
            dl.click();
        }

        // --- STUDENT EXAM LOGIC ---
        function renderStudentExamList() {
            const container = document.getElementById('student-exam-list');
            const myRombel = currentSiswa.rombel;
            const availableMapels = [...new Set(db.questions.filter(q => q.rombel === myRombel).map(q => q.mapel))];

            if (availableMapels.length === 0) {
                container.innerHTML = `<div class="col-span-full text-center py-20"><p class="text-slate-400 font-bold">Belum ada ujian tersedia untuk rombel Anda.</p></div>`;
                return;
            }

            container.innerHTML = availableMapels.map(m => {
                const subjectObj = db.subjects.find(s => getSubjectName(s) === m);
                const scheduleKey = `${myRombel}|${m}`;
                const isScheduleActive = !db.schedules || db.schedules.length === 0 || db.schedules.includes(scheduleKey);
                const isLocked = subjectObj && subjectObj.locked;
                const alreadyDone = db.results.find(r => r.studentId === currentSiswa.id && r.mapel === m && !r.deleted);
                const isNotAccessible = !isScheduleActive || isLocked;

                return `
                    <div class="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm transition-all hover:shadow-xl">
                        <div class="flex justify-between items-start mb-6">
                            <div class="w-12 h-12 bg-sky-100 text-sky-600 rounded-2xl flex items-center justify-center text-xl"><i class="fas fa-file-alt"></i></div>
                            ${isNotAccessible ? '<span class="px-3 py-1 bg-red-100 text-red-600 rounded-full text-[10px] font-black uppercase flex items-center gap-1"><i class="fas fa-lock"></i> Belum Dibuka</span>' : alreadyDone ? '<span class="px-3 py-1 bg-emerald-100 text-emerald-600 rounded-full text-[10px] font-black uppercase">Selesai</span>' : '<span class="px-3 py-1 bg-amber-100 text-amber-600 rounded-full text-[10px] font-black uppercase">Tersedia</span>'}
                        </div>
                        <h3 class="text-lg font-black text-slate-800 mb-1">${m}</h3>
                        <p class="text-slate-400 text-xs mb-6 font-medium">Ujian Semester - SMP Kristen Dorkas</p>
                        ${isNotAccessible ?
                        `<button disabled class="w-full py-4 bg-slate-300 text-slate-600 font-bold rounded-2xl cursor-not-allowed">BELUM DIBUKA</button>` :
                        alreadyDone ?
                            `<div class="flex items-center gap-2 text-sky-600 font-black">Skor: ${alreadyDone.score}</div>` :
                            `<button onclick="startExam('${m}')" class="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-sky-600 transition-all">MULAI UJIAN</button>`
                    }
                    </div>
                `;
            }).join('');
        }

        // examData keeps track of current exam state. answers array holds either
        // - a single index for single-choice questions
        // - an array of indices for multiple-choice questions
        // - a string for text/complex questions
        let examData = { mapel: "", questions: [], currentIdx: 0, answers: [], ragu: [], timer: null };

        function showStudentInstructionModal() {
            const modal = document.getElementById('student-instruction-modal');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
        }

        function closeStudentInstructionModal() {
            const modal = document.getElementById('student-instruction-modal');
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
        }

        function startExam(mapel) {
            const qs = db.questions.filter(q => q.mapel === mapel && q.rombel === currentSiswa.rombel);

            // PENTING: Normalisasi setiap soal (tambahkan type jika belum ada)
            const normalizedQuestions = qs.map(q => ({
                ...q,
                type: q.type || 'single'  // Default ke 'single' jika tidak ada type
            }));

            // initialise answers based on question type (multiple => [], text => "", single => null)
            const answers = normalizedQuestions.map(q => {
                if (q.type === 'multiple') return [];
                if (q.type === 'text') return '';
                if (q.type === 'matching') return [];
                return null; // default single-choice
            });
            const ragu = normalizedQuestions.map(_ => false);
            examData = { mapel, questions: normalizedQuestions, currentIdx: 0, answers, ragu };

            // Tampilkan petunjuk ujian untuk siswa
            showStudentInstructionModal();

            // Reset and start anti-cheat
            cheatingCount = 0;
            isExamActive = true;
            
            // Request fullscreen for exam
            if (typeof requestFullscreen === 'function') {
                requestFullscreen();
            }
            document.getElementById('cheat-mask').classList.add('hidden');

            document.getElementById('student-exam-list').classList.add('hidden');
            document.getElementById('exam-screen').classList.remove('hidden');
            document.getElementById('exam-meta').innerText = `${mapel} | ${currentSiswa.rombel}`;

            showQuestion(0);
            updateQuestionStatus();
            updateProgress();

            const timeLimits = db.timeLimits || {};
            const key = `${currentSiswa.rombel}|${mapel}`.toLowerCase().trim();
            const timeLimit = timeLimits[key] || 30; // default 30 menit
            console.log('Starting exam for', key, 'timeLimit:', timeLimit, 'timeLimits:', timeLimits);
            startTimer(timeLimit * 60);
        }

        function showQuestion(idx) {
            examData.currentIdx = idx;
            const q = examData.questions[idx];
            document.getElementById('curr-q-num').innerText = idx + 1;
            document.getElementById('total-q-num').innerText = examData.questions.length;
            document.getElementById('exam-q-text').innerHTML = q.text;
            // refresh progress display (including type)
            updateProgress();

            // show images if available
            const imgContainer = document.getElementById('exam-images');
            imgContainer.innerHTML = '';
            if (q.images && Array.isArray(q.images) && q.images.length > 0) {
                q.images.forEach((img, imgIdx) => {
                    const imgSrc = typeof img === 'string' ? img : (img.data || '');
                    imgContainer.innerHTML += `<div class="relative w-full cursor-pointer group hover:opacity-90 transition-opacity" onclick="openImageZoom(${idx}, ${imgIdx})">
                        <img src="${imgSrc}" alt="Gambar soal ${imgIdx + 1}" class="w-full h-auto rounded-lg border border-slate-300 shadow-sm object-contain" loading="lazy">
                        <span class="absolute top-2 right-2 bg-sky-600 text-white text-xs font-bold px-2 py-1 rounded">${imgIdx + 1}</span>
                        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <i class="fas fa-search-plus text-white text-3xl"></i>
                        </div>
                    </div>`;
                });
                imgContainer.classList.remove('hidden');
            } else if (q.image) {
                const imgSrcSingle = typeof q.image === 'string' ? q.image : (q.image.data || '');
                imgContainer.innerHTML = `<div class="relative w-full cursor-pointer group hover:opacity-90 transition-opacity" onclick="openImageZoom(${idx}, 0)">
                    <img src="${imgSrcSingle}" alt="Gambar soal" class="w-full h-auto rounded-lg border border-slate-300 shadow-sm object-contain" loading="lazy">
                    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <i class="fas fa-search-plus text-white text-3xl"></i>
                    </div>
                </div>`;
                imgContainer.classList.remove('hidden');
            } else {
                imgContainer.classList.add('hidden');
            }

            let optionHtml = '';
            if (q.type === 'multiple') {
                // render checkboxes for multiple-choice
                optionHtml = q.options
                    .map((opt, i) => ({ opt, i }))
                    .filter(item => item.opt && item.opt.trim() !== '')
                    .map((item, displayIdx) => {
                        const { opt, i } = item;
                        const checked = (examData.answers[idx] || []).includes(i) ? 'checked' : '';
                        const label = String.fromCharCode(65 + displayIdx);
                        return `
                    <label class="flex items-center w-full p-4 md:p-5 rounded-2xl border-2 transition-all ${checked ? 'border-sky-600 bg-sky-50 text-sky-700 font-bold' : 'border-slate-50 hover:bg-slate-50 text-slate-600'}">
                        <input type="checkbox" class="mr-3 w-5 h-5"
                            onchange="toggleAnswer(${i})" ${checked} />
                        <span class="inline-block w-8 font-bold">${label}.</span>
                        <span class="flex-1 text-sm md:text-base">${opt}</span>
                    </label>`;
                    }).join('');

            } else if (q.type === 'text') {
                const value = examData.answers[idx] || '';
                optionHtml = `
                    <textarea id="text-answer" class="w-full p-4 md:p-5 border rounded-lg h-28 md:h-32 text-sm md:text-base" 
                        oninput="setAnswerText(this.value)">${value}</textarea>`;
            } else if (q.type === 'tf') {
                const ansArr = examData.answers[idx] || [];
                optionHtml = q.options.map((stmt, j) => {
                    const val = ansArr[j];
                    return `
                    <div class="flex items-center w-full p-4 md:p-5 rounded-2xl border-2 transition-all ${val === true ? 'border-sky-600 bg-sky-50 text-sky-700 font-bold' : ''}">
                        <span class="flex-1 text-sm md:text-base">${stmt}</span>
                        <div class="flex gap-2">
                            <button onclick="setAnswerTF(${j}, true)" class="px-3 py-1 rounded ${val === true ? 'bg-sky-600 text-white' : 'bg-slate-100'}">Benar</button>
                            <button onclick="setAnswerTF(${j}, false)" class="px-3 py-1 rounded ${val === false ? 'bg-sky-600 text-white' : 'bg-slate-100'}">Salah</button>
                        </div>
                    </div>`;
                }).join('');
            } else if (q.type === 'matching') {
                // Pastikan pilihan jawaban (pool) diacak sekali
                if (!Array.isArray(q._shuffledAnswers) || q._shuffledAnswers.length !== (q.answers?.length || 0)) {
                    q._shuffledAnswers = shuffleArray(q.answers || []);
                }
                const shuffledAnswers = q._shuffledAnswers;
                examData.shuffledAnswers = shuffledAnswers;

                // Pastikan urutan pertanyaan (kiri) diacak sekali
                if (!Array.isArray(q._shuffledQuestionIndices) || q._shuffledQuestionIndices.length !== (q.questions?.length || 0)) {
                    const indices = (q.questions || []).map((_, i) => i);
                    q._shuffledQuestionIndices = shuffleArray(indices);
                }
                const questionIndices = q._shuffledQuestionIndices;
                const selected = examData.answers[idx] || [];

                optionHtml = `
                    <div class="matching-box animate-fade-in">
                        <div class="matching-header">
                            <div class="flex items-center gap-2 mb-3">
                                <i class="fas fa-list-check text-sky-600"></i>
                                <span class="text-xs font-black text-slate-500 uppercase tracking-widest">Referensi Pilihan Jawaban</span>
                            </div>
                            <div class="matching-legend-grid">
                                ${shuffledAnswers.map((ans, ai) => `
                                    <div class="matching-legend-item">
                                        <span class="matching-legend-label">${String.fromCharCode(65 + ai)}.</span>
                                        <span>${ans}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <div class="flex items-center gap-2 mb-4">
                            <i class="fas fa-layer-group text-sky-600"></i>
                            <span class="text-xs font-black text-slate-500 uppercase tracking-widest">Pasangkan Jawaban</span>
                        </div>
                        
                        <div class="matching-select-wrapper">
                            ${questionIndices.map((origQi, displayIdx) => {
                    const quest = q.questions[origQi];
                    return `
                                <div class="matching-item-card ${selected[origQi] != null ? 'answered' : ''}">
                                    <div class="flex items-center gap-3 flex-1">
                                        <div class="w-7 h-7 bg-slate-100 text-slate-600 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0">${displayIdx + 1}</div>
                                        <div class="matching-question-text">${quest}</div>
                                    </div>
                                    <div class="w-full sm:w-64 md:w-80 flex-shrink-0">
                                        <select onchange="setMatchingAnswer(${origQi}, this.value)" class="matching-select">
                                            <option value="">Pilih Pasangan...</option>
                                            ${shuffledAnswers.map((ans, ai) => `
                                                <option value="${ai}" ${selected[origQi] == ai ? 'selected' : ''}>
                                                    ${String.fromCharCode(65 + ai)}. ${ans.length > 40 ? ans.substring(0, 37) + '...' : ans}
                                                </option>
                                            `).join('')}
                                        </select>
                                    </div>
                                </div>
                            `;
                }).join('')}
                        </div>
                    </div>
                `;
            } else {
                // default single-choice
                optionHtml = q.options
                    .map((opt, i) => ({ opt, i }))
                    .filter(item => item.opt && item.opt.trim() !== '')
                    .map((item, displayIdx) => {
                        const { opt, i } = item;
                        const label = String.fromCharCode(65 + displayIdx);
                        return `
                    <button onclick="setAnswer(${i})" class="w-full p-4 md:p-5 text-left rounded-2xl border-2 transition-all ${examData.answers[idx] === i ? 'border-sky-600 bg-sky-50 text-sky-700 font-bold' : 'border-slate-50 hover:bg-slate-50 text-slate-600'}">
                        <span class="inline-block w-8 font-bold">${label}.</span>
                        <span class="text-sm md:text-base">${opt}</span>
                    </button>`;
                    }).join('');

            }
            document.getElementById('exam-options').innerHTML = optionHtml;

            // Update question status indicators
            updateQuestionStatus();
            updateDoubtBtn();
            updateProgress();

            document.getElementById('btn-prev').disabled = idx === 0;
            document.getElementById('btn-next').classList.toggle('hidden', idx === examData.questions.length - 1);
            document.getElementById('btn-finish').classList.toggle('hidden', idx !== examData.questions.length - 1);
        }

        function setAnswer(i) {
            const q = examData.questions[examData.currentIdx];
            if (q.type === 'multiple') {
                let arr = examData.answers[examData.currentIdx] || [];
                const idx = arr.indexOf(i);
                if (idx === -1) arr.push(i);
                else arr.splice(idx, 1);
                examData.answers[examData.currentIdx] = arr;
            } else {
                examData.answers[examData.currentIdx] = i;
            }
            showQuestion(examData.currentIdx);
        }
        function toggleAnswer(i) { setAnswer(i); }
        function setAnswerText(val) {
            examData.answers[examData.currentIdx] = val;
            updateQuestionStatus();
            updateProgress();
        }
        function setAnswerTF(stmtIdx, boolVal) {
            const idx = examData.currentIdx;
            const ansArr = examData.answers[idx] || [];
            ansArr[stmtIdx] = boolVal;
            examData.answers[idx] = ansArr;
            // re-render current question to update styling
            showQuestion(idx);
        }
        function setMatchingAnswer(qIdx, aIdx) {
            const idx = examData.currentIdx;
            const ansArr = examData.answers[idx] || [];
            ansArr[qIdx] = aIdx === "" ? null : parseInt(aIdx);
            examData.answers[idx] = ansArr;
            showQuestion(idx);
        }
        function navQ(dir) { showQuestion(examData.currentIdx + dir); }

        let statusShowAll = false; // show all questions when true
        const MAX_VISIBLE_STATUS = 8;
        function toggleStatusView() {
            statusShowAll = !statusShowAll;
            document.getElementById('toggle-status-btn').innerText = statusShowAll ? '(Tutup)' : '(Lihat semua)';
            updateQuestionStatus();
        }

        function toggleDoubt() {
            const idx = examData.currentIdx;
            examData.ragu[idx] = !examData.ragu[idx];
            updateQuestionStatus();
            updateDoubtBtn();
        }

        function updateDoubtBtn() {
            const btn = document.getElementById('btn-doubt');
            if (!btn) return;
            const isRagu = examData.ragu && examData.ragu[examData.currentIdx];
            btn.classList.toggle('bg-yellow-600', isRagu);
        }
        function updateQuestionStatus() {
            const statusContainer = document.getElementById('question-status');

            const total = examData.questions.length;
            const unansweredIndices = [];
            examData.questions.forEach((_, i) => {
                const ans = examData.answers[i];
                const isAnswered = ans !== null && ans !== undefined && (
                    Array.isArray(ans) ? ans.length > 0 :
                        typeof ans === 'string' ? ans.trim() !== '' :
                            true
                );
                if (!isAnswered) unansweredIndices.push(i);
            });

            let indicesToRender;
            if (statusShowAll) {
                indicesToRender = [...Array(total).keys()];
            } else {
                if (unansweredIndices.length <= MAX_VISIBLE_STATUS) {
                    indicesToRender = unansweredIndices.length ? unansweredIndices.slice() : [...Array(total).keys()];
                } else {
                    indicesToRender = unansweredIndices.slice(0, MAX_VISIBLE_STATUS);
                }
            }
            if (!indicesToRender.includes(examData.currentIdx)) {
                indicesToRender.unshift(examData.currentIdx);
            }

            const buttons = indicesToRender.map(i => {
                const ans = examData.answers[i];
                const isAnswered = ans !== null && ans !== undefined && (
                    Array.isArray(ans) ? ans.length > 0 :
                        typeof ans === 'string' ? ans.trim() !== '' :
                            true
                );
                const isRagu = examData.ragu && examData.ragu[i];
                const isCurrent = i === examData.currentIdx;
                let bgColor;
                if (isRagu) {
                    bgColor = 'bg-yellow-500 text-white hover:bg-yellow-600';
                } else if (isAnswered) {
                    bgColor = 'bg-emerald-500 text-white hover:bg-emerald-600';
                } else {
                    bgColor = 'bg-red-500 text-white hover:bg-red-600';
                }
                const ringClass = isCurrent ? 'ring-2 ring-sky-400 ring-offset-2' : '';
                return `<button onclick="showQuestion(${i})" class="w-10 h-10 rounded-lg font-bold text-sm transition-all ${bgColor} ${ringClass}">${i + 1}</button>`;
            });
            if (!statusShowAll && total > indicesToRender.length) {
                buttons.push(`<button onclick="toggleStatusView()" class="view-all w-10 h-10 rounded-lg font-bold text-sm transition-all">⋯</button>`);
            }
            if (statusShowAll && total > MAX_VISIBLE_STATUS) {
                buttons.push(`<button onclick="toggleStatusView()" class="view-all w-10 h-10 rounded-lg font-bold text-sm transition-all">×</button>`);
            }
            statusContainer.innerHTML = buttons.join('');
        }

        function getTypeLabel(type) {
            if (type === 'single') return 'Pilihan ganda';
            if (type === 'multiple') return 'Pilihan ganda (Kompleks)';
            if (type === 'text') return 'Uraian';
            if (type === 'tf') return 'Benar / Salah';
            if (type === 'matching') return 'Menjodohkan';
            return type;
        }

        function updateProgress() {
            const total = examData.questions.length;
            const answeredCount = examData.answers.reduce((count, ans) => {
                const isAnswered = ans !== null && ans !== undefined && (
                    Array.isArray(ans) ? ans.length > 0 :
                        typeof ans === 'string' ? ans.trim() !== '' :
                            true
                );
                return count + (isAnswered ? 1 : 0);
            }, 0);
            const percentage = total ? (answeredCount / total) * 100 : 0;
            document.getElementById('progress-bar').style.width = `${percentage}%`;
            document.getElementById('progress-text').innerText = `${Math.round(percentage)}%`;

            // update current question type label
            if (examData && examData.questions && typeof examData.currentIdx === 'number') {
                const q = examData.questions[examData.currentIdx];
                const typeLabel = q ? getTypeLabel(q.type || 'single') : '';
                document.getElementById('progress-type').innerText = typeLabel;
            }
        }

        function shuffleArray(array) {
            const arr = [...array];
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }

        function startTimer(sec) {
            clearInterval(examData.timer);
            const timerEl = document.getElementById('timer');
            if (timerEl) timerEl.classList.remove('animate-blink-red');

            examData.timer = setInterval(() => {
                sec--;
                const h = Math.floor(sec / 3600);
                const m = Math.floor((sec % 3600) / 60);
                const s = sec % 60;
                if (h > 0) {
                    document.getElementById('timer').innerText = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                } else {
                    document.getElementById('timer').innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                }

                // Efek visual berkedip merah saat sisa 5 menit
                if (sec <= 300 && timerEl) {
                    timerEl.classList.add('animate-blink-red');
                }

                // Tambahkan peringatan sisa waktu
                if (sec === 300) {
                    showToast("Peringatan: Sisa waktu 5 menit!", "info");
                } else if (sec === 60) {
                    showToast("Peringatan: Sisa waktu 1 menit! Segera selesaikan jawaban Anda.", "error");
                }

                if (sec <= 0) {
                    showToast("Waktu habis! Jawaban Anda otomatis dikirim.", "error");
                    submitExam();
                }
            }, 1000);
        }

        function closeConfirmModal() {
            const modal = document.getElementById('confirm-finish-modal');
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
        }

        async function finishExam() {
            // Calculate answered vs total
            const total = examData.questions.length;
            const answeredCount = examData.answers.reduce((count, ans) => {
                const isAnswered = ans !== null && ans !== undefined && (
                    Array.isArray(ans) ? ans.length > 0 :
                        typeof ans === 'string' ? ans.trim() !== '' :
                            true
                );
                return count + (isAnswered ? 1 : 0);
            }, 0);
            const unansweredCount = total - answeredCount;

            // Update modal UI
            document.getElementById('confirm-answered-count').innerText = answeredCount;
            document.getElementById('confirm-unanswered-count').innerText = unansweredCount;

            const warning = document.getElementById('unanswered-warning');
            if (unansweredCount > 0) {
                warning.classList.remove('hidden');
                warning.classList.add('flex');
            } else {
                warning.classList.add('hidden');
                warning.classList.remove('flex');
            }

            // Show modal
            const modal = document.getElementById('confirm-finish-modal');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        async function submitExam() {
            // IMMEDIATE UI TRANSITION: Stop exam and hide screens before processing heavy data
            isExamActive = false;
            // Release fullscreen and wake lock
            exitFullscreen();
            releaseWakeLock();
            closeConfirmModal();
            closeCheatWarning();
            clearInterval(examData.timer);

            // Hide question UI immediately so it doesn't look "stuck"
            document.getElementById('exam-screen').classList.add('hidden');

            // Show processing modal
            const savingModal = document.getElementById('saving-modal');
            const savingProg = document.getElementById('saving-progress-bar');
            if (savingModal) {
                savingModal.classList.remove('hidden');
                savingModal.classList.add('flex');
                if (savingProg) savingProg.style.width = '30%';
            }

            // RANDOM DELAY: 2-12 seconds to ensure stability (Sequential Render Queue)
            const randomDelay = Math.floor(Math.random() * (12000 - 2000 + 1)) + 2000;
            console.log(`[QUEUE] Enforcing sequential wait: ${randomDelay}ms`);

            // Simulasikan progress bar visual
            const progressInterval = setInterval(() => {
                if (savingProg) {
                    const currentWidth = parseFloat(savingProg.style.width);
                    if (currentWidth < 90) savingProg.style.width = (currentWidth + 5) + '%';
                }
            }, randomDelay / 10);

            await new Promise(resolve => setTimeout(resolve, randomDelay));
            clearInterval(progressInterval);
            if (savingProg) savingProg.style.width = '100%';

            let correctCount = 0;

            // VALIDASI: Pastikan questions dan answers punya panjang yang sama
            if (!Array.isArray(examData.questions) || !Array.isArray(examData.answers)) {
                console.error('ERROR: Questions atau answers bukan array!');
                alert('Terjadi error saat merekam ujian. Silakan hubungi administrator.');
                return;
            }

            if (examData.questions.length !== examData.answers.length) {
                console.warn(`WARNING: Jumlah soal (${examData.questions.length}) != jumlah jawaban (${examData.answers.length})`);
                // Pad answers array jika kurang
                while (examData.answers.length < examData.questions.length) {
                    examData.answers.push(null);
                }
            }

            // Each question contributes one point to the final score.
            // For TF questions we treat every individual statement as a
            // separate scoring item; for complex multiple-choice each
            // option is an item.  The student's score is calculated as
            // (#correctItems / #totalItems) * 100.  In other words, the
            // one-point question is divided evenly across all statements /
            // options (i.e. score per statement = 1/totalItems), so a
            // partially correct TF/multiple question gives fractional credit.
            // This matches the requirement: "skor 1 soal dibagi pernyataan
            // yang dijawab dengan benar" (and similarly for multiple choice).
            // The debug logs below print the intermediate counts.
            // count answers at the granularity of TF statements
            let totalItems = 0;
            examData.questions.forEach((q, i) => {
                const ans = examData.answers[i];

                // VALIDASI: Pastikan question memiliki kunci jawaban (gunakan default type 'single' jika tidak ada)
                if (!q || q.correct === undefined) {
                    console.warn(`WARNING: Soal ${i} tidak valid:`, q);
                    return;
                }
                const qType = q.type || 'single'; // Default ke single-choice jika tidak ada type

                if (qType === 'tf' && Array.isArray(q.options)) {
                    // tiap pernyataan dianggap satu item dalam perhitungan skor
                    const ansArr = Array.isArray(ans) ? ans : [];
                    q.options.forEach((stmt, j) => {
                        totalItems++;
                        const corrVal = Array.isArray(q.correct) ? q.correct[j] : false;
                        const studentVal = ansArr[j];
                        if (studentVal === corrVal) {
                            correctCount++;
                        }
                    });
                } else if (qType === 'multiple') {
                    // per-option scoring untuk pilihan ganda kompleks
                    const corr = Array.isArray(q.correct) ? q.correct : [];
                    const ansArr = Array.isArray(ans) ? ans : [];
                    const selectedCorrect = ansArr.filter(idx => corr.includes(idx)).length;

                    const totalCorrectOptions = corr.length > 0 ? corr.length : 1;
                    totalItems += totalCorrectOptions;
                    correctCount += selectedCorrect;
                } else if (qType === 'matching') {
                    const ansArr = Array.isArray(ans) ? ans : [];
                    const shuffled = Array.isArray(q._shuffledAnswers) ? q._shuffledAnswers : (q.answers || []);

                    // SAFETY: Ensure both prompt questions and correct answers exist
                    if (Array.isArray(q.questions) && Array.isArray(q.correct)) {
                        q.questions.forEach((_, qi) => {
                            totalItems++;
                            const selectedIdx = ansArr[qi];
                            if (selectedIdx != null && shuffled[selectedIdx] === q.correct[qi]) {
                                correctCount++;
                            }
                        });
                    } else {
                        console.warn(`[SCORE] SKIPPING matching question ${i} due to missing questions/correct data`);
                        // Still increment totalItems by 1 to represent the question exists
                        totalItems += 1;
                    }
                } else {
                    // non-TF and non-multiple questions still contribute satu item
                    totalItems++;
                    let correct = false;

                    if (qType === 'text') {
                        const corrText = (typeof q.correct === 'string' ? q.correct : '').trim().toLowerCase();
                        correct = typeof ans === 'string' && ans.trim().toLowerCase() === corrText;
                    } else {
                        // Single choice (default)
                        correct = ans === q.correct;
                    }

                    if (correct) correctCount++;
                }
            });

            // DEBUG: Log perhitungan skor
            console.log('[SCORE DEBUG] Total items:', totalItems, 'Jawaban benar:', correctCount);
            console.log('[SCORE DEBUG] Perhitungan: (', correctCount, '/', totalItems, ') * 100 =', (totalItems ? (correctCount / totalItems) * 100 : 0));

            const score = totalItems ? ((correctCount / totalItems) * 100).toFixed(1) : 0;

            // Save essential question data (without images) so teachers/admins can view answers.
            // Images are stripped to keep payload small and prevent 500 errors.
            const savedQuestions = examData.questions.map(q => {
                const essential = {
                    text: q.text || '',
                    type: q.type || 'single',
                    correct: q.correct,
                };
                if (Array.isArray(q.options)) essential.options = q.options;
                if (Array.isArray(q.questions)) essential.questions = q.questions; // for matching
                if (Array.isArray(q.answers)) essential.answers = q.answers;       // for matching
                // intentionally omit q.images / q.image to keep payload small
                return essential;
            });

            // Transform matching answers from indices to strings before saving
            const savedAnswers = examData.answers.map((ans, i) => {
                const q = examData.questions[i];
                if (q.type === 'matching' && Array.isArray(ans)) {
                    const shuffled = q._shuffledAnswers || q.answers || [];
                    return ans.map(ai => (ai !== null && ai !== undefined) ? shuffled[ai] : null);
                }
                return ans;
            });

            const newEntry = {
                studentId: currentSiswa.id,
                studentName: currentSiswa.name,
                rombel: currentSiswa.rombel,
                mapel: examData.mapel,
                score: score,
                date: new Date().toISOString(),
                answers: savedAnswers, // Save transformed answers
                questions: savedQuestions // Save the questions with all essential data
            };
            db.results.push(newEntry);
            updateCompletionCharts();

            let directSyncError = null;
            let backgroundSaveError = null;

            try {
                // 1. Mandatory Single Result Sync (The most critical part)
                try {
                    await sendResult(newEntry);
                } catch (e) {
                    console.warn('[SUBMIT] Direct result sync failed, relying on background save:', e.message || e);
                    directSyncError = e;
                }

                // 2. Background Full DB Save (Updates IndexedDB and triggers fallback sync)
                try {
                    await save();
                } catch (e) {
                    console.warn('[SUBMIT] Background database save encountered an issue:', e.message || e);
                    backgroundSaveError = e;
                }
            } finally {
                // ALWAYS close the modal regardless of network state
                if (savingModal) {
                    savingModal.classList.add('hidden');
                    savingModal.classList.remove('flex');
                }
            }

            if (directSyncError || backgroundSaveError) {
                // Hapus entry yang gagal dari state agar tidak dobel saat ditekan "Coba Lagi"
                db.results.pop();
                
                const failModal = document.getElementById('failed-result');
                if (failModal) {
                    let errMsg = "Koneksi ke server terputus atau gagal terakses.";
                    if (backgroundSaveError) errMsg = "Penyimpanan lokal dan server mengalami masalah.";
                    document.getElementById('failed-result-msg').innerHTML = `${errMsg}<br>Silakan periksa koneksi internet atau server, lalu <b>coba lagi</b>.`;
                    failModal.classList.remove('hidden');
                    const scoreRes = document.getElementById('score-result');
                    if(scoreRes) scoreRes.classList.add('hidden');
                } else {
                    alert('GAGAL TERSIMPAN: Periksa koneksi Anda dan coba lagi.');
                }
                return; // Stop here, so we don't show the success UI
            }

            // refresh admin/teacher views if they're visible so the new score
            // shows up right away
            if (document.getElementById('admin-dashboard') &&
                !document.getElementById('admin-dashboard').classList.contains('hidden') &&
                !document.getElementById('admin-results').classList.contains('hidden')) {
                renderAdminResults();
            }
            if (document.getElementById('teacher-dashboard') &&
                !document.getElementById('teacher-dashboard').classList.contains('hidden') &&
                document.getElementById('teacher-tab-hasil-ujian') &&
                !document.getElementById('teacher-tab-hasil-ujian').classList.contains('text-slate-400')) {
                renderTeacherResults();
            }

            const successModal = document.getElementById('score-result');
            if(successModal) successModal.classList.remove('hidden');
            const failModalUI = document.getElementById('failed-result');
            if(failModalUI) failModalUI.classList.add('hidden');
            document.getElementById('final-score-val').innerText = score;
        }

        // --- IMAGE ZOOM FUNCTIONALITY ---
        let currentZoomQuestion = null;
        let currentZoomImageIndex = 0;

        function openImageZoom(qIdx, imgIdx) {
            try {
                currentZoomQuestion = qIdx;
                currentZoomImageIndex = imgIdx;
                const q = examData.questions[qIdx];
                if (!q) {
                    console.warn('Question not found at index:', qIdx);
                    return;
                }
                const images = q.images && Array.isArray(q.images) ? q.images : (q.image ? [q.image] : []);

                if (images.length > 0) {
                    const zoomModal = document.getElementById('image-zoom-modal');
                    const zoomImage = document.getElementById('zoom-image-display');
                    const counter = document.getElementById('zoom-image-counter');

                    if (!zoomModal || !zoomImage || !counter) {
                        console.error('Modal elements not found');
                        return;
                    }

                    const zoomImgSrc = typeof images[imgIdx] === 'string' ? images[imgIdx] : (images[imgIdx].data || '');
                    zoomImage.src = zoomImgSrc;
                    counter.textContent = `${imgIdx + 1}/${images.length}`;
                    zoomModal.classList.remove('hidden');
                    zoomModal.style.display = 'flex';
                    console.log('Zoom modal opened for image', imgIdx + 1, 'of', images.length);
                } else {
                    console.warn('No images found for question');
                }
            } catch (error) {
                console.error('Error opening image zoom:', error);
            }
        }

        function closeImageZoom() {
            try {
                const zoomModal = document.getElementById('image-zoom-modal');
                if (zoomModal) {
                    zoomModal.classList.add('hidden');
                    zoomModal.style.display = 'none';
                }
            } catch (error) {
                console.error('Error closing image zoom:', error);
            }
        }

        function nextZoomImage() {
            const q = examData.questions[currentZoomQuestion];
            const images = q.images && Array.isArray(q.images) ? q.images : (q.image ? [q.image] : []);
            currentZoomImageIndex = (currentZoomImageIndex + 1) % images.length;
            const zoomImage = document.getElementById('zoom-image-display');
            const counter = document.getElementById('zoom-image-counter');
            const zoomImgSrc = typeof images[currentZoomImageIndex] === 'string' ? images[currentZoomImageIndex] : (images[currentZoomImageIndex].data || '');
            zoomImage.src = zoomImgSrc;
            counter.textContent = `${currentZoomImageIndex + 1}/${images.length}`;
        }

        function previousZoomImage() {
            const q = examData.questions[currentZoomQuestion];
            const images = q.images && Array.isArray(q.images) ? q.images : (q.image ? [q.image] : []);
            currentZoomImageIndex = (currentZoomImageIndex - 1 + images.length) % images.length;
            const zoomImage = document.getElementById('zoom-image-display');
            const counter = document.getElementById('zoom-image-counter');
            const zoomImgSrc = typeof images[currentZoomImageIndex] === 'string' ? images[currentZoomImageIndex] : (images[currentZoomImageIndex].data || '');
            zoomImage.src = zoomImgSrc;
            counter.textContent = `${currentZoomImageIndex + 1}/${images.length}`;
        }

        // --- AI QUESTION GENERATION ---
        function openAiModal() {
            const modal = document.getElementById('ai-modal');
            if (!modal) return;
            modal.classList.remove('hidden');
            modal.classList.add('flex');

            // Reset blueprint file and label
            const blueprintInput = document.getElementById('ai-blueprint-file');
            if (blueprintInput) blueprintInput.value = '';
            const label = document.getElementById('ai-materi-label');
            if (label) label.innerText = 'Materi / Topik Utama';

            const mapelSel = document.getElementById('ai-mapel');
            const rombelSel = document.getElementById('ai-rombel');

            if (mapelSel && db.subjects) {
                mapelSel.innerHTML = db.subjects.map(s => {
                    const name = (typeof s === 'object') ? s.name : s;
                    return `<option value="${name}">${name}</option>`;
                }).join('');
            }
            if (rombelSel && db.rombels) {
                rombelSel.innerHTML = db.rombels.map(r => `<option value="${r}">${r}</option>`).join('');
            }

            const targetSelectors = document.getElementById('ai-target-selectors');
            if (targetSelectors) targetSelectors.classList.remove('hidden');
            calculateAiHots();
        }

        function openTeacherAiModal() {
            openAiModal();
            if (window.currentTeacher && window.currentTeacher.subjects) {
                const mapelSel = document.getElementById('ai-mapel');
                const rombelSel = document.getElementById('ai-rombel');
                const subjects = window.currentTeacher.subjects;

                if (mapelSel && subjects.length > 0) {
                    const uniqueMapels = [...new Set(subjects.map(s => s.mapel))];
                    mapelSel.innerHTML = uniqueMapels.map(m => `<option value="${m}">${m}</option>`).join('');

                    const updateTeacherAiRombel = () => {
                        const selectedMapel = mapelSel.value;
                        const relevantRombels = subjects.filter(s => s.mapel === selectedMapel).map(s => s.rombel);
                        if (rombelSel) rombelSel.innerHTML = relevantRombels.map(r => `<option value="${r}">${r}</option>`).join('');
                    };

                    mapelSel.onchange = updateTeacherAiRombel;
                    updateTeacherAiRombel();
                }
            }
        }

        function handleAiBlueprintChange(input) {
            const label = document.getElementById('ai-materi-label');
            if (input.files && input.files.length > 0) {
                if (label) label.innerHTML = 'Materi / Topik Utama <span class="text-blue-500 font-bold lowercase text-[9px]">(Opsional jika upload file)</span>';
            } else {
                if (label) label.innerText = 'Materi / Topik Utama';
            }
        }

        function getAiTypeCounts() {
            const typeCounts = { single: 0, multiple: 0, text: 0, tf: 0, matching: 0 };
            const oldJumlah = document.getElementById('ai-jumlah');
            const oldType = document.getElementById('ai-type');

            if (oldJumlah && oldType) {
                const chosen = (oldType.value || 'single').trim();
                typeCounts[chosen] = Number(oldJumlah.value) || 0;
            } else {
                typeCounts.single = Number(document.getElementById('ai-jml-pg')?.value) || 0;
                typeCounts.multiple = Number(document.getElementById('ai-jml-pgk')?.value) || 0;
                typeCounts.text = Number(document.getElementById('ai-jml-esai')?.value) || 0;
                typeCounts.tf = Number(document.getElementById('ai-jml-bs')?.value) || 0;
                typeCounts.matching = Number(document.getElementById('ai-jml-jodoh')?.value) || 0;
            }

            return typeCounts;
        }

        function getAiLevelCounts(totalQuestions) {
            const levels = { mudah: 0, sedang: 0, hots: 0 };
            const mudah = Number(document.getElementById('ai-lvl-mudah')?.value) || 0;
            const sedang = Number(document.getElementById('ai-lvl-sedang')?.value) || 0;
            const hotsInput = document.getElementById('ai-lvl-hots');

            levels.mudah = mudah;
            levels.sedang = sedang;
            levels.hots = Math.max(0, totalQuestions - mudah - sedang);

            if (hotsInput) {
                hotsInput.value = String(levels.hots);
            }

            return levels;
        }

        function calculateAiHots() {
            const typeCounts = getAiTypeCounts();
            const total = Object.values(typeCounts).reduce((sum, n) => sum + (Number(n) || 0), 0);
            const totalDisplay = document.getElementById('ai-total-display');
            if (totalDisplay) {
                totalDisplay.textContent = String(total);
            }

            const mudahInput = document.getElementById('ai-lvl-mudah');
            const sedangInput = document.getElementById('ai-lvl-sedang');
            const hotsInput = document.getElementById('ai-lvl-hots');
            const mudah = Number(mudahInput?.value) || 0;
            const sedang = Number(sedangInput?.value) || 0;
            if (hotsInput) {
                hotsInput.value = String(Math.max(0, total - mudah - sedang));
            }
        }

        async function generateQuestionsWithAi() {
            const materi = document.getElementById('ai-materi')?.value.trim();
            const mapel = document.getElementById('ai-mapel')?.value;
            const rombel = document.getElementById('ai-rombel')?.value;
            const file = document.getElementById('ai-blueprint-file')?.files[0];
            const oldJumlah = document.getElementById('ai-jumlah');
            const oldType = document.getElementById('ai-type');

            const typeCounts = getAiTypeCounts();
            let jumlah = Object.values(typeCounts).reduce((sum, n) => sum + (Number(n) || 0), 0);
            let tipe = 'single';

            if (oldJumlah && oldType) {
                jumlah = Number(oldJumlah.value) || 0;
                tipe = oldType.value || 'single';
                if (jumlah > 0 && jumlah !== Object.values(typeCounts).reduce((sum, n) => sum + (Number(n) || 0), 0)) {
                    typeCounts[tipe] = jumlah;
                }
            }

            if (!materi && !file) {
                alert('Harap masukkan materi/topik atau upload kisi-kisi!');
                return;
            }
            if (!mapel) {
                alert('Pilih mata pelajaran!');
                return;
            }
            if (!rombel) {
                alert('Pilih rombel!');
                return;
            }
            if (jumlah <= 0) {
                alert('Harap pilih jumlah soal minimal 1!');
                return;
            }

            const levelCounts = getAiLevelCounts(jumlah);
            const opsiGambar = document.getElementById('ai-opsi-gambar')?.value || 'none';
            const loading = document.getElementById('ai-loading');
            if (loading) {
                loading.classList.remove('hidden');
                loading.classList.add('flex');
            }

            try {
                const response = await fetch(getApiBaseUrl() + '/api/generate-ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        materi, jumlah, tipe, mapel, rombel, typeCounts, levelCounts, opsiGambar,
                        teacherId: (currentSiswa && currentSiswa.role === 'teacher') ? currentSiswa.id : null
                    })
                });

                const result = await response.json();

                if (result.ok) {
                    const newQuestions = result.questions.map(q => ({
                        ...q,
                        id: Date.now() + Math.random().toString(36).substr(2, 4),
                        createdAt: new Date().toISOString()
                    }));

                    db.questions = [...db.questions, ...newQuestions];
                    await save();

                    alert(`Berhasil membuat ${newQuestions.length} soal baru dengan AI!`);
                    closeModals();

                    if (typeof renderAdminQuestions === 'function') renderAdminQuestions();
                    if (typeof renderTeacherQuestions === 'function') renderTeacherQuestions();
                } else {
                    alert('Error AI: ' + (result.error || 'Gagal generate soal'));
                }
            } catch (err) {
                console.error('AI Generation Error:', err);
                if (window.isStaticMode || window.location.hostname.includes('github.io')) {
                    alert('Kesalahan AI: Fitur ini membutuhkan Backend Node.js yang berjalan.\n\nJika anda menjalankan di GitHub, silakan hubungkan ke Backend eksternal via Administrator > Settings.');
                } else {
                    alert('Terjadi kesalahan saat memanggil AI: ' + (err.message || 'Error tidak diketahui'));
                }
            } finally {
                if (loading) {
                    loading.classList.add('hidden');
                    loading.classList.remove('flex');
                }
            }
        }

        function renderRaport() {
            const rombel = document.getElementById('raport-filter-rombel')?.value || 'ALL';
            const siswaId = document.getElementById('raport-filter-siswa')?.value || 'ALL';
            const tahun = document.getElementById('raport-tahun')?.value || '';
            const kopRombel = document.getElementById('raport-kop-rombel');
            const kopTahun = document.getElementById('raport-kop-tahun');
            const kopSiswa = document.getElementById('raport-kop-siswa');
            const kopTanggal = document.getElementById('raport-footer-date');
            const kopParent = document.getElementById('raport-footer-parent');
            const kopWali = document.getElementById('raport-footer-wali');
            const kopKepalaTitle = document.getElementById('raport-footer-kepala-title');
            const kopKepalaName = document.getElementById('raport-footer-kepala-name');
            const raportFooter = document.getElementById('raport-footer');
            const thead = document.getElementById('raport-thead');
            const tbody = document.getElementById('raport-tbody');
            const raportEmpty = document.getElementById('raport-empty');

            const parentName = document.getElementById('raport-parent-name')?.value?.trim() || 'Orang Tua / Wali Siswa';
            const waliName = document.getElementById('raport-wali-name')?.value?.trim() || 'Wali Kelas';
            const today = new Date();
            const dateLabel = today.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
            const kepalaTitle = document.getElementById('raport-kepala-title')?.value?.trim() || 'Kepala SMP Kristen Dorkas';
            const kepalaName = document.getElementById('raport-kepala-name')?.value?.trim() || 'Pujoko, S.Pd., M.Pd.';

            if (kopRombel) kopRombel.textContent = rombel === 'ALL' ? 'Semua' : rombel;
            if (kopTahun) kopTahun.textContent = tahun || '2025/2026';
            if (kopSiswa) {
                if (siswaId === 'ALL') {
                    kopSiswa.textContent = 'Semua';
                } else {
                    const siswa = (db.students || []).find(s => s.id === siswaId);
                    kopSiswa.textContent = siswa ? siswa.name : 'Tidak diketahui';
                }
            }
            if (kopTanggal) kopTanggal.textContent = `Lasem, ${dateLabel}`;
            if (kopParent) kopParent.textContent = parentName;
            if (kopWali) kopWali.textContent = waliName;
            if (kopKepalaTitle) kopKepalaTitle.textContent = kepalaTitle;
            if (kopKepalaName) kopKepalaName.textContent = kepalaName;

            const filtered = (db.results || []).filter(r => {
                if (r.deleted) return false;
                if (rombel !== 'ALL' && r.rombel !== rombel) return false;
                if (siswaId !== 'ALL' && r.studentId !== siswaId) return false;
                return true;
            });
            if (!filtered.length) {
                if (tbody) tbody.innerHTML = '';
                if (raportEmpty) {
                    raportEmpty.classList.remove('hidden');
                    raportEmpty.classList.add('flex');
                }
                if (raportFooter) raportFooter.classList.add('hidden');
                return;
            }

            if (raportEmpty) {
                raportEmpty.classList.add('hidden');
                raportEmpty.classList.remove('flex');
            }
            if (raportFooter) raportFooter.classList.remove('hidden');

            const rows = filtered.sort((a, b) => {
                const nameCompare = (a.studentName || '').localeCompare(b.studentName || '');
                if (nameCompare !== 0) return nameCompare;
                const subjectCompare = (a.mapel || '').localeCompare(b.mapel || '');
                if (subjectCompare !== 0) return subjectCompare;
                return new Date(b.date) - new Date(a.date);
            }).map((r, index) => {
                const dateText = r.date ? new Date(r.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
                return `
                    <tr class="border-b border-slate-100">
                        <td class="px-6 py-4 text-xs text-slate-600">${index + 1}</td>
                        <td class="px-6 py-4 text-xs text-slate-600">${r.mapel || '-'}</td>
                        <td class="px-6 py-4 text-xs text-slate-600">${dateText}</td>
                        <td class="px-6 py-4 text-xs text-center font-black text-sky-600">${Number(r.score).toFixed(1)}</td>
                    </tr>`;
            });

            const siswaNameEl = document.getElementById('raport-siswa-name');
            const siswaRombelEl = document.getElementById('raport-siswa-rombel');
            if (siswaNameEl && siswaRombelEl) {
                if (siswaId === 'ALL') {
                    siswaNameEl.textContent = 'Semua Siswa';
                } else {
                    const siswa = (db.students || []).find(s => s.id === siswaId);
                    siswaNameEl.textContent = siswa ? siswa.name : 'Tidak diketahui';
                }
                siswaRombelEl.textContent = rombel === 'ALL' ? 'Semua' : rombel;
            }

            if (thead) {
                thead.innerHTML = `
                    <tr>
                        <th class="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">No</th>
                        <th class="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Mata Pelajaran</th>
                        <th class="px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Tanggal</th>
                        <th class="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-500">Nilai</th>
                    </tr>`;
            }
            if (tbody) tbody.innerHTML = rows.join('');
        }

        function previewRaport() {
            renderRaport();
            const raportContainer = document.getElementById('raport-container');
            if (!raportContainer) return;

            const previewWindow = window.open('', '_blank');
            if (!previewWindow) return;

            previewWindow.document.write(`<!DOCTYPE html><html><head><title>Preview Raport</title><style>body{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:24px;color:#0f172a;} table{width:100%;border-collapse:collapse;} th,td{padding:10px;border:1px solid #e2e8f0;text-align:left;} th{background:#0f172a;color:white;font-size:11px;text-transform:uppercase;letter-spacing:.08em;} .kop{text-align:center;margin-bottom:24px;} .kop h2{margin:0;font-size:18px;} .kop p{margin:4px 0;font-size:12px;color:#475569;} .section-title{margin:36px 0 12px;font-size:14px;font-weight:700;color:#0f172a;}</style></head><body>${raportContainer.innerHTML}</body></html>`);
            previewWindow.document.close();
            previewWindow.focus();
        }

        function printRaport() {
            renderRaport();
            const raportContainer = document.getElementById('raport-container');
            if (!raportContainer) return;

            const printWindow = window.open('', '_blank');
            if (!printWindow) return;

            printWindow.document.write(`<!DOCTYPE html><html><head><title>Cetak Raport</title><style>body{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:24px;color:#0f172a;} table{width:100%;border-collapse:collapse;} th,td{padding:10px;border:1px solid #e2e8f0;text-align:left;} th{background:#0f172a;color:white;font-size:11px;text-transform:uppercase;letter-spacing:.08em;} .kop{text-align:center;margin-bottom:24px;} .kop h2{margin:0;font-size:18px;} .kop p{margin:4px 0;font-size:12px;color:#475569;} .no-print{display:none;}</style></head><body>${raportContainer.innerHTML}</body></html>`);
            printWindow.document.close();
            printWindow.focus();
            printWindow.print();
        }

        function downloadRaportPDF() {
            renderRaport();
            const raportContainer = document.getElementById('raport-container');
            if (!raportContainer || typeof html2pdf === 'undefined') return;

            const clone = raportContainer.cloneNode(true);
            clone.style.width = '210mm';
            clone.style.padding = '10mm';
            clone.style.boxSizing = 'border-box';
            const opt = {
                margin: [10, 10, 10, 10],
                filename: `Raport_${(document.getElementById('raport-siswa-name')?.textContent || 'Siswa').replace(/\s+/g, '_')}_${(document.getElementById('raport-siswa-rombel')?.textContent || 'Semua').replace(/\s+/g, '_')}_${(document.getElementById('raport-tahun')?.value || '').replace(/\D/g, '') || '2026'}.pdf`,
                html2canvas: { scale: 2, useCORS: true },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: 'avoid' }
            };
            html2pdf().set(opt).from(clone).save();
        }

        function downloadRaportExcel() {
            renderRaport();
            const rombel = document.getElementById('raport-filter-rombel')?.value || 'ALL';
            const siswaId = document.getElementById('raport-filter-siswa')?.value || 'ALL';
            const tahun = document.getElementById('raport-tahun')?.value || '';
            const filtered = (db.results || []).filter(r => {
                if (r.deleted) return false;
                if (rombel !== 'ALL' && r.rombel !== rombel) return false;
                if (siswaId !== 'ALL' && r.studentId !== siswaId) return false;
                return true;
            });
            if (!filtered.length || typeof XLSX === 'undefined') return;

            const excelData = filtered.map((r, index) => ({
                No: index + 1,
                Mata_Pelajaran: r.mapel || '',
                Tanggal: r.date ? new Date(r.date).toLocaleDateString('id-ID') : '',
                Nilai: Number(r.score).toFixed(1)
            }));
            const worksheet = XLSX.utils.json_to_sheet(excelData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Raport');
            const selectedStudent = document.getElementById('raport-filter-siswa')?.value || 'ALL';
            const studentName = (document.getElementById('raport-siswa-name')?.textContent || 'Siswa');
            const rombelName = (document.getElementById('raport-siswa-rombel')?.textContent || 'Semua');
            XLSX.writeFile(workbook, `Raport_${studentName.replace(/\s+/g, '_')}_${rombelName.replace(/\s+/g, '_')}_${tahun.replace(/\D/g, '') || '2026'}.xlsx`);
        }

        // --- KISI-KISI AI FUNCTIONALITY ---
        let currentKisiKisiData = [];

        function openKisiKisiModal() {
            const modal = document.getElementById('kisi-kisi-modal');
            if (!modal) return;
            modal.classList.remove('hidden');
            modal.classList.add('flex');

            const mapelSel = document.getElementById('kk-mapel');
            const rombelSel = document.getElementById('kk-rombel');

            // Reset UI
            document.getElementById('kisi-kisi-setup').classList.remove('hidden');
            document.getElementById('kisi-kisi-result').classList.add('hidden');

            // Populate based on current mode (Admin or Teacher)
            if (window.currentSiswa && window.currentSiswa.role === 'teacher') {
                const subjects = window.currentSiswa.subjects || [];
                const uniqueMapels = [...new Set(subjects.map(s => s.mapel))];
                mapelSel.innerHTML = uniqueMapels.map(m => `<option value="${m}">${m}</option>`).join('');

                const updateRombel = () => {
                    const selectedMapel = mapelSel.value;
                    const relevantRombels = subjects.filter(s => s.mapel === selectedMapel).map(s => s.rombel);
                    rombelSel.innerHTML = relevantRombels.map(r => `<option value="${r}">${r}</option>`).join('');
                };
                mapelSel.onchange = updateRombel;
                updateRombel();
            } else {
                // Admin mode
                mapelSel.innerHTML = db.subjects.map(s => {
                    const name = (typeof s === 'object') ? s.name : s;
                    return `<option value="${name}">${name}</option>`;
                }).join('');
                rombelSel.innerHTML = db.rombels.map(r => `<option value="${r}">${r}</option>`).join('');
                mapelSel.onchange = null;
            }
        }

        async function generateKisiKisiWithAi() {
            const mapel = document.getElementById('kk-mapel').value;
            const rombel = document.getElementById('kk-rombel').value;

            // Filter questions to send
            const questions = db.questions.filter(q => q.mapel === mapel && q.rombel === rombel);
            if (questions.length === 0) {
                alert('Tidak ada soal yang ditemukan untuk Mapel and Rombel ini!');
                return;
            }

            const loading = document.getElementById('ai-loading');
            loading.classList.remove('hidden');
            loading.classList.add('flex');

            try {
                const response = await fetch(getApiBaseUrl() + '/api/generate-kisi-kisi', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ questions, mapel, rombel })
                });

                const result = await response.json();
                if (result.ok) {
                    currentKisiKisiData = result.kisiKisi;
                    renderKisiKisiTable(currentKisiKisiData);
                    document.getElementById('kisi-kisi-setup').classList.add('hidden');
                    document.getElementById('kisi-kisi-result').classList.remove('hidden');
                    document.getElementById('kk-count').innerText = questions.length;
                } else {
                    alert('Error AI: ' + (result.error || 'Gagal generate kisi-kisi'));
                }
            } catch (err) {
                console.error('Kisi-kisi Generation Error:', err);
                alert('Terjadi kesalahan saat memanggil AI: ' + err.message);
            } finally {
                loading.classList.add('hidden');
                loading.classList.remove('flex');
            }
        }

        function renderKisiKisiTable(data) {
            const tbody = document.getElementById('kk-table-body');
            tbody.innerHTML = data.map(item => `
                <tr>
                    <td class="px-4 py-3 border border-slate-200 text-center">${item.no}</td>
                    <td class="px-4 py-3 border border-slate-200 font-medium">${item.kd}</td>
                    <td class="px-4 py-3 border border-slate-200">${item.materi}</td>
                    <td class="px-4 py-3 border border-slate-200 italic">${item.indikator}</td>
                    <td class="px-4 py-3 border border-slate-200 text-center">${item.level}</td>
                    <td class="px-4 py-3 border border-slate-200 text-center font-bold">${item.no_soal}</td>
                    <td class="px-4 py-3 border border-slate-200 text-center">${item.bentuk}</td>
                </tr>
            `).join('');
        }

        function resetKisiKisiModal() {
            document.getElementById('kisi-kisi-setup').classList.remove('hidden');
            document.getElementById('kisi-kisi-result').classList.add('hidden');
        }

        function downloadKisiKisiExcel() {
            if (!currentKisiKisiData.length) return;
            const siswaNameText = document.getElementById('raport-siswa-name')?.textContent || 'Semua';
            const siswaRombelText = document.getElementById('raport-siswa-rombel')?.textContent || 'Semua';
            const ws = XLSX.utils.json_to_sheet(currentKisiKisiData.map(item => ({
                'No': item.no,
                'Kompetensi Dasar': item.kd,
                'Materi': item.materi,
                'Indikator Soal': item.indikator,
                'Level': item.level,
                'No Soal': item.no_soal,
                'Bentuk': item.bentuk
            })));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Kisi-kisi");
            XLSX.writeFile(wb, `Kisi-kisi_${document.getElementById('kk-mapel').value}_${document.getElementById('kk-rombel').value}.xlsx`);
        }

        function downloadKisiKisiWord() {
            if (!currentKisiKisiData.length) return;
            const mapel = document.getElementById('kk-mapel').value;
            const rombel = document.getElementById('kk-rombel').value;

            let html = `
                <div style="font-family: 'Arial', sans-serif;">
                    <h2 style="text-align: center; text-transform: uppercase;">KISI-KISI INSTRUMEN UJIAN</h2>
                    <table style="margin-bottom: 20px;">
                        <tr><td>Mata Pelajaran</td><td>: ${mapel}</td></tr>
                        <tr><td>Kelas / Rombel</td><td>: ${rombel}</td></tr>
                        <tr><td>Sekolah</td><td>: SMP KRISTEN DORKAS</td></tr>
                    </table>
                    <table border="1" cellspacing="0" cellpadding="5" style="width: 100%; border-collapse: collapse;">
                        <thead style="background-color: #f2f2f2;">
                            <tr>
                                <th>No</th>
                                <th>Kompetensi Dasar</th>
                                <th>Materi</th>
                                <th>Indikator Soal</th>
                                <th>Level</th>
                                <th>No Soal</th>
                                <th>Bentuk</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${currentKisiKisiData.map(item => `
                                <tr>
                                    <td align="center">${item.no}</td>
                                    <td>${item.kd}</td>
                                    <td>${item.materi}</td>
                                    <td>${item.indikator}</td>
                                    <td align="center">${item.level}</td>
                                    <td align="center">${item.no_soal}</td>
                                    <td align="center">${item.bentuk}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            // Simple blob trick for .doc
            const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
                "xmlns:w='urn:schemas-microsoft-com:office:word' " +
                "xmlns='http://www.w3.org/TR/REC-html40'>" +
                "<head><meta charset='utf-8'><title>Export HTML to Word</title></head><body>";
            const footer = "</body></html>";
            const sourceHTML = header + html + footer;

            const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
            const fileDownload = document.createElement("a");
            document.body.appendChild(fileDownload);
            fileDownload.href = source;
            fileDownload.download = `Kisi-kisi_${mapel}_${rombel}.doc`;
            fileDownload.click();
            document.body.removeChild(fileDownload);
        }

        function showToast(message, type = 'success') {
            const container = document.getElementById('toast-container');
            if (!container) return;

            const toast = document.createElement('div');
            toast.className = `flex items-center gap-3 px-6 py-3 rounded-2xl shadow-xl transform transition-all duration-300 translate-y-10 opacity-0`;

            if (type === 'success') {
                toast.classList.add('bg-emerald-600', 'text-white');
                toast.innerHTML = `<i class="fas fa-check-circle"></i> <span class="text-xs font-bold">${message}</span>`;
            } else if (type === 'error') {
                toast.classList.add('bg-red-600', 'text-white');
                toast.innerHTML = `<i class="fas fa-exclamation-circle"></i> <span class="text-xs font-bold">${message}</span>`;
            } else {
                toast.classList.add('bg-sky-600', 'text-white');
                toast.innerHTML = `<i class="fas fa-sync fa-spin"></i> <span class="text-xs font-bold">${message}</span>`;
            }

            container.appendChild(toast);

            // Trigger animation
            setTimeout(() => {
                toast.classList.remove('translate-y-10', 'opacity-0');
            }, 10);

            // Auto hide
            setTimeout(() => {
                toast.classList.add('translate-y-[-10px]', 'opacity-0');
                setTimeout(() => toast.remove(), 300);
            }, type === 'info' ? 1500 : 3000);
        }

        function downloadKisiKisiPdf() {
            if (!currentKisiKisiData.length) return;
            const element = document.getElementById('kisi-kisi-result').cloneNode(true);
            // Hide the buttons in the clone
            element.querySelector('.flex.gap-2').style.display = 'none';
            element.querySelector('button.mt-4').style.display = 'none';

            const opt = {
                margin: 1,
                filename: `Kisi-kisi_${document.getElementById('kk-mapel').value}_${document.getElementById('kk-rombel').value}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' }
            };
            html2pdf().set(opt).from(element).save();
        }

        function showStaticModeWarning() {
            const warning = document.createElement('div');
            warning.id = 'static-mode-warning';
            warning.className = 'fixed bottom-4 right-4 bg-amber-600 text-white px-4 py-3 rounded-2xl shadow-2xl z-[9999] flex items-center gap-3 animate-bounce cursor-pointer';
            warning.innerHTML = `
                <div class="bg-white/20 w-8 h-8 rounded-full flex items-center justify-center"><i class="fas fa-exclamation-triangle"></i></div>
                <div>
                    <p class="text-[10px] font-black uppercase tracking-widest opacity-80">Static Mode</p>
                    <p class="text-xs font-bold leading-tight">Berjalan tanpa server. Perubahan tidak akan tersimpan ke server!</p>
                </div>
                <button class="ml-2 opacity-50 hover:opacity-100" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
            `;
            document.body.appendChild(warning);
        }

        // Toggle dropdown functions
        function toggleImportDropdown() {
            const dropdown = document.getElementById('import-dropdown');
            if (dropdown) dropdown.classList.toggle('hidden');
            // Hide export dropdown if open
            const exportDropdown = document.getElementById('export-dropdown');
            if (exportDropdown) exportDropdown.classList.add('hidden');
        }

        function toggleExportDropdown() {
            const dropdown = document.getElementById('export-dropdown');
            if (dropdown) dropdown.classList.toggle('hidden');
            // Hide import dropdown if open
            const importDropdown = document.getElementById('import-dropdown');
            if (importDropdown) importDropdown.classList.add('hidden');
        }

        // --- API KEY MANAGEMENT FUNCTIONS ---
        async function syncTeacherAPIKeysFromServer() {
            if (!currentSiswa || currentSiswa.role !== 'teacher') return;
            
            try {
                const response = await fetch(getApiBaseUrl() + `/api/teacher/api-keys?teacherId=${encodeURIComponent(currentSiswa.id)}`);
                if (!response.ok) {
                    console.warn('Failed to sync API keys from server:', response.status);
                    return;
                }
                
                const result = await response.json();
                if (result.ok && Array.isArray(result.apiKeys)) {
                    // Filter out global keys, only keep personal teacher keys strictly
                    const personalKeys = result.apiKeys.filter(key => 
                        !key.isGlobal && 
                        (!key.addedAt || !key.addedAt.includes('System'))
                    );
                    // Update local currentSiswa with server data
                    currentSiswa.apiKeys = personalKeys;
                    save(); // Save to local storage
                    console.log('Synced personal API keys from server:', personalKeys.length, 'keys');
                }
            } catch (e) {
                console.warn('Error syncing API keys from server:', e.message);
            }
        }

        async function syncGlobalAPIKeysFromServer() {
            try {
                // Refresh global API keys list by re-rendering
                if (typeof renderGlobalAPIKeys === 'function') {
                    await renderGlobalAPIKeys();
                }
                console.log('Synced global API keys from server');
            } catch (e) {
                console.warn('Error syncing global API keys from server:', e.message);
            }
        }

        // ─── Real-time API Keys Stats Polling ─────────────────────────────
        let apiKeysStatsPollingInterval = null;
        const STATS_POLLING_INTERVAL = 3000; // 3 detik

        async function startRealtimeStatsPolling() {
            if (!currentSiswa || currentSiswa.role !== 'teacher') return;
            
            // Clear existing interval jika ada
            if (apiKeysStatsPollingInterval) {
                clearInterval(apiKeysStatsPollingInterval);
            }
            
            // Poll immediately
            await updateRealtimeStats();
            
            // Then set interval for continuous polling
            apiKeysStatsPollingInterval = setInterval(updateRealtimeStats, STATS_POLLING_INTERVAL);
        }

        function stopRealtimeStatsPolling() {
            if (apiKeysStatsPollingInterval) {
                clearInterval(apiKeysStatsPollingInterval);
                apiKeysStatsPollingInterval = null;
            }
        }

        async function updateRealtimeStats() {
            if (!currentSiswa || currentSiswa.role !== 'teacher') return;
            
            try {
                const response = await fetch(getApiBaseUrl() + `/api/teacher/realtime-stats?teacherId=${encodeURIComponent(currentSiswa.id)}`);
                if (!response.ok) return;
                
                const data = await response.json();
                if (!data.ok) return;
                
                // Update teacher API keys stats
                if (data.teacherKeys) {
                    const keyCountEl = document.getElementById('api-keys-count');
                    if (keyCountEl) {
                        keyCountEl.textContent = `${data.teacherKeys.active}/${data.teacherKeys.total}`;
                        keyCountEl.classList.add('animate-pulse-brief');
                        setTimeout(() => keyCountEl.classList.remove('animate-pulse-brief'), 300);
                    }
                }
                
                // Update global API keys stats
                if (data.globalKeys) {
                    const globalKeyCountEl = document.getElementById('global-api-keys-count');
                    if (globalKeyCountEl) {
                        globalKeyCountEl.textContent = `${data.globalKeys.active}/${data.globalKeys.total}`;
                        globalKeyCountEl.classList.add('animate-pulse-brief');
                        setTimeout(() => globalKeyCountEl.classList.remove('animate-pulse-brief'), 300);
                    }
                }
                
                // Update last updated timestamp
                const timestamp = new Date(data.timestamp);
                const lastUpdatedEl = document.getElementById('api-keys-last-updated');
                if (lastUpdatedEl && data.timestamp) {
                    const timeStr = timestamp.toLocaleTimeString('id-ID');
                    lastUpdatedEl.textContent = `Update terakhir: ${timeStr}`;
                    lastUpdatedEl.classList.add('opacity-50');
                }
                
                // Update status badges
                updateAPIKeysStatusBadges(data.teacherKeys, data.globalKeys);
                
            } catch (err) {
                console.warn('Error updating real-time stats:', err.message);
            }
        }

        function updateAPIKeysStatusBadges(teacherKeys, globalKeys) {
            // Update teacher keys status
            const statusBadge = document.getElementById('api-keys-status-badge');
            if (statusBadge && teacherKeys) {
                if (teacherKeys.total === 0) {
                    statusBadge.innerHTML = '<i class="fas fa-info-circle mr-1"></i>Belum ada API Key pribadi';
                    statusBadge.className = 'inline-block px-3 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded-full';
                } else if (teacherKeys.active === 0) {
                    statusBadge.innerHTML = '<i class="fas fa-exclamation-circle mr-1"></i>Semua API Key habis kuota';
                    statusBadge.className = 'inline-block px-3 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-full';
                } else {
                    statusBadge.innerHTML = '<i class="fas fa-check-circle mr-1"></i>API Keys Siap Digunakan';
                    statusBadge.className = 'inline-block px-3 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full';
                }
            }
            
            // Update global keys status
            const globalStatusBadge = document.getElementById('global-api-keys-status-badge');
            if (globalStatusBadge && globalKeys) {
                if (globalKeys.total === 0) {
                    globalStatusBadge.innerHTML = '<i class="fas fa-times-circle mr-1"></i>Tidak ada key global';
                    globalStatusBadge.className = 'inline-block px-3 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded-full';
                } else if (globalKeys.active === 0) {
                    globalStatusBadge.innerHTML = '<i class="fas fa-exclamation-circle mr-1"></i>Semua global key habis';
                    globalStatusBadge.className = 'inline-block px-3 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-full';
                } else {
                    globalStatusBadge.innerHTML = '<i class="fas fa-check-circle mr-1"></i>Global keys aktif';
                    globalStatusBadge.className = 'inline-block px-3 py-1 bg-yellow-100 text-yellow-700 text-xs font-bold rounded-full';
                }
            }
        }

        function addTeacherAPIKeyForm() {
            const input = document.getElementById('new-api-key-input');
            if (!input) {
                showToast('Form tidak ditemukan', 'error');
                return;
            }
            
            const apiKey = input.value.trim();
            if (!apiKey) {
                showToast('Masukkan API Key terlebih dahulu', 'error');
                return;
            }
            
            if (!currentSiswa || currentSiswa.role !== 'teacher') {
                alert('Hanya guru yang dapat menambahkan API Key');
                return;
            }
            
            // Show loading state
            const btn = event.target;
            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
            
            // Send to server for auto-setup to Vercel
            fetch(getApiBaseUrl() + '/api/teacher/add-api-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    teacherId: currentSiswa.id,
                    apiKey: apiKey
                })
            })
            .then(res => res.json())
            .then(data => {
                if (!data.ok) {
                    showToast(data.error || 'Gagal menambahkan API Key', 'error');
                    return;
                }
                if (typeof updateApiKeysWarningBanner === 'function') {
                    updateApiKeysWarningBanner('', '');
                }
                
                // Update local state
                if (!Array.isArray(currentSiswa.apiKeys)) {
                    currentSiswa.apiKeys = [];
                }

                const trimmedKey = apiKey.trim();
                const alreadyExists = currentSiswa.apiKeys.some(entry => {
                    if (typeof entry === 'string') return entry.trim() === trimmedKey;
                    if (typeof entry === 'object' && entry.key) return entry.key.trim() === trimmedKey;
                    return false;
                });

                if (!alreadyExists) {
                    currentSiswa.apiKeys.push({
                        key: trimmedKey,
                        status: 'active',
                        addedAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        note: ''
                    });
                }

                save();
                input.value = '';
                input.type = 'password';
                if (typeof renderTeacherAPIKeys === 'function') {
                    renderTeacherAPIKeys();
                }
                
                // Update real-time stats immediately
                updateRealtimeStats();
                
                // Show success with Vercel status
                const message = data.vercelStatus 
                    ? `✅ API Key ditambahkan! ${data.vercelStatus}`
                    : '✅ API Key berhasil ditambahkan!';
                showToast(message, 'success');
                
            })
            .catch(err => {
                console.error('API Key Error:', err);
                showToast('Terjadi kesalahan: ' + err.message, 'error');
            })
            .finally(() => {
                btn.disabled = false;
                btn.innerHTML = originalText;
            });
        }

        function removeTeacherAPIKey(index) {
            if (!confirm('Apakah Anda yakin ingin menghapus API Key ini?')) {
                return;
            }
            
            if (!currentSiswa || currentSiswa.role !== 'teacher') {
                alert('Hanya guru yang dapat menghapus API Key');
                return;
            }
            
            fetch(getApiBaseUrl() + '/api/teacher/remove-api-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    teacherId: currentSiswa.id,
                    keyIndex: index
                })
            })
            .then(res => res.json())
            .then(data => {
                if (!data.ok) {
                    showToast(data.error || 'Gagal menghapus API Key', 'error');
                    return;
                }
                
                // Remove from local state
                if (Array.isArray(currentSiswa.apiKeys)) {
                    currentSiswa.apiKeys.splice(index, 1);
                }
                
                save();
                
                if (typeof renderTeacherAPIKeys === 'function') {
                    renderTeacherAPIKeys();
                }
                
                // Update real-time stats immediately
                updateRealtimeStats();
                
                showToast('✅ API Key berhasil dihapus!', 'success');
            })
            .catch(err => {
                console.error('Remove API Key Error:', err);
                showToast('Terjadi kesalahan: ' + err.message, 'error');
            });
        }

        // Make function globally accessible
        window.removeTeacherAPIKey = removeTeacherAPIKey;

        // Stub helper functions for API key management
        function updateApiKeysWarningBanner(message, type = 'error') {
            const banner = document.getElementById('api-keys-warning-banner');
            if (!banner) return;
            banner.textContent = message || '';
            if (!message) {
                banner.classList.add('hidden');
                return;
            }
            banner.classList.remove('hidden');
        }

        function renderTeacherAPIKeys() {
            const listContainer = document.getElementById('api-keys-list');
            if (!listContainer) return;
            console.log('renderTeacherAPIKeys called');
            // Minimal implementation - just update the display if needed
        }

        async function renderGlobalAPIKeys() {
            const container = document.getElementById('global-api-keys-list');
            if (!container) return;
            console.log('renderGlobalAPIKeys called');
            // Minimal implementation - if needed, fetch and render global API keys
            try {
                const response = await fetch(getApiBaseUrl() + '/api/teacher/global-api-keys');
                const result = await response.json();
                console.log('Global API keys loaded:', result);
                if (result.ok && result.globalKeys && result.globalKeys.length > 0) {
                    updateGlobalApiKeysStats(result.globalKeys);
                }
            } catch (err) {
                console.error('Error loading global API keys:', err);
            }
        }

        function toggleGlobalAPIKeysList() {
            const list = document.getElementById('global-api-keys-list');
            const icon = document.getElementById('global-api-keys-toggle-icon');
            
            if (!list || !icon) return;
            
            const isHidden = list.classList.contains('hidden');
            
            if (isHidden) {
                list.classList.remove('hidden');
                icon.style.transform = 'rotate(180deg)';
                // Load the list if it's empty (first time opening)
                if (list.children.length === 0 || list.querySelector('.fa-loader')) {
                    renderGlobalAPIKeys();
                }
            } else {
                list.classList.add('hidden');
                icon.style.transform = 'rotate(0deg)';
            }
        }

        // Make function globally accessible
        window.toggleGlobalAPIKeysList = toggleGlobalAPIKeysList;

        function updateApiKeysQuotaNote() {
            const note = document.getElementById('api-keys-quota-note');
            if (!note) return;
            // Minimal implementation - updates quota note display
            note.textContent = 'Sisa kuota tidak dapat ditentukan secara pasti oleh Google Gemini.';
        }

        function updateGlobalApiKeysStats(keys = []) {
            const countDisplay = document.getElementById('global-api-keys-count');
            const statusBadge = document.getElementById('global-api-keys-status-badge');
            
            if (!Array.isArray(keys)) keys = [];
            const totalCount = keys.length;
            const activeCount = keys.filter(k => k.status !== 'exhausted').length;
            
            if (countDisplay) {
                countDisplay.textContent = `${activeCount}/${totalCount}`;
            }
            
            if (!statusBadge) return;

            if (totalCount === 0) {
                statusBadge.innerHTML = '<i class="fas fa-exclamation-circle mr-1"></i>Tidak ada key global';
                statusBadge.className = 'inline-block px-3 py-1 bg-yellow-100 text-yellow-700 text-xs font-bold rounded-full';
            } else if (activeCount === 0) {
                statusBadge.innerHTML = '<i class="fas fa-times-circle mr-1"></i>Semua Global Key Habis';
                statusBadge.className = 'inline-block px-3 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-full';
            } else {
                statusBadge.innerHTML = '<i class="fas fa-check-circle mr-1"></i>Global Keys Siap';
                statusBadge.className = 'inline-block px-3 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full';
            }
        }

        window.addGlobalApiKey = async function() {
            const apiKey = document.getElementById('new-api-key').value.trim();
            if (!apiKey) return showToast('API Key harus diisi', 'error');

            // Auto-detect provider based on API key format
            let detectedProvider = 'OpenAI'; // Default fallback
            if (apiKey.startsWith('AIzaSy')) {
                detectedProvider = 'Gemini';
            } else if (apiKey.startsWith('sk-')) {
                detectedProvider = 'OpenAI';
            } else if (apiKey.startsWith('sk-or-v1-') || apiKey.startsWith('sk-or-')) {
                detectedProvider = 'OpenRouter';
            } else if (apiKey.startsWith('gsk_')) {
                detectedProvider = 'Groq';
            } else if (apiKey.startsWith('sk-') && apiKey.includes('deepseek')) {
                detectedProvider = 'DeepSeek';
            }

            try {
                const response = await fetch(getApiBaseUrl() + '/api/admin/add-global-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider: detectedProvider, apiKey, note: '' })
                });

                const result = await response.json();

                if (result.ok) {
                    showToast(`Global API Key berhasil ditambahkan (${detectedProvider})`, 'success');
                    document.getElementById('new-api-key').value = '';
                    renderApiKeysList(); // Refresh list
                    updateStats(); // Update stats
                } else {
                    showToast(result.error || 'Gagal menambahkan key', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        };

        async function renderApiKeysList() {
            const container = document.getElementById('api-keys-list');
            if (!container) return;

            try {
                const response = await fetch(getApiBaseUrl() + '/api/admin/global-api-keys');
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const result = await response.json();

                if (result.ok && Array.isArray(result.globalKeys)) {
                    const keys = result.globalKeys;
                    window.globalApiKeysActive = result.activeCount || 0;
                    window.globalApiKeysExhausted = result.exhaustedCount || 0;
                    updateStats(); // Update stats with new API keys data
                    
                    // Helper function to detect provider from API key
                    function detectProviderFromKey(key) {
                        if (!key) return 'Unknown';
                        if (key.startsWith('AIzaSy')) return 'Google Gemini';
                        if (key.startsWith('sk-')) return 'OpenAI (ChatGPT)';
                        if (key.startsWith('sk-or-v1-') || key.startsWith('sk-or-')) return 'OpenRouter';
                        if (key.startsWith('gsk_')) return 'Groq';
                        if (key.includes('deepseek')) return 'DeepSeek';
                        return 'Unknown';
                    }
                    
                    container.innerHTML = keys.length === 0 ? 
                        '<p class="text-xs text-slate-500">Belum ada API Key global</p>' :
                        keys.map((key, index) => {
                            const fullKey = key.key || '';
                            const displayKey = fullKey.length > 20 ? fullKey.substring(0, 20) + '...' : fullKey;
                            
                            // Use detected provider from key format, fallback to stored provider
                            const detectedProvider = detectProviderFromKey(fullKey);
                            const displayProvider = detectedProvider !== 'Unknown' ? detectedProvider : (key.provider || 'Unknown');
                            
                            const source = key.addedAt || 'Global Settings';
                            const isExternal = source.includes('Guru:') || source.includes('Vercel');

                            return `
                                <div class="flex items-center justify-between bg-slate-50 p-3 rounded-2xl border border-slate-100 mb-2">
                                    <div class="flex-1">
                                        <div class="flex items-center gap-2 mb-1">
                                            <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-slate-200 text-slate-600">${displayProvider}</span>
                                            <span class="text-[10px] font-bold px-2 py-0.5 rounded ${isExternal ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}">${source}</span>
                                        </div>
                                        <div class="flex items-center gap-2">
                                            <span class="text-xs font-mono text-slate-700">${displayKey}</span>
                                            ${key.status === 'exhausted' ? '<span class="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded border border-red-100">KUOTA HABIS</span>' : '<span class="text-[10px] font-bold text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">AKTIF</span>'}
                                        </div>
                                    </div>
                                    ${!isExternal ? `
                                    <button onclick="removeGlobalApiKey(${index})" class="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                    ` : `
                                    <div class="w-8 h-8 flex items-center justify-center text-slate-300 cursor-not-allowed" title="Key ini dikelola di sumber aslinya">
                                        <i class="fas fa-lock text-xs"></i>
                                    </div>
                                    `}
                                </div>
                            `;
                        }).join('');
                } else {
                    container.innerHTML = `<p class="text-xs text-red-500">Error: ${result.error || 'Response tidak valid'}</p>`;
                }
            } catch (err) {
                console.error('Error loading API keys:', err);
                container.innerHTML = `<p class="text-xs text-red-500">Gagal memuat API Keys: ${err.message}</p>`;
            }
        }

        window.removeGlobalApiKey = async function(index) {
            if (!confirm('Apakah Anda yakin ingin menghapus Global API Key ini?')) return;

            try {
                const response = await fetch(getApiBaseUrl() + '/api/admin/remove-global-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ keyIndex: index })
                });

                const result = await response.json();

                if (result.ok) {
                    showToast('Global API Key berhasil dihapus', 'success');
                    renderApiKeysList(); // Refresh list for admin overview
                    updateStats(); // Update stats
                } else {
                    showToast(result.error || 'Gagal menghapus key', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        };

        // ─── Detailed API Keys Modal Logic ───────────────────
        window.openApiKeysDetailModal = async function() {
            const modal = document.getElementById('api-keys-detail-modal');
            if (modal) modal.classList.remove('hidden');
            if (modal) modal.classList.add('flex');
            
            // Show loading in table body
            const tbody = document.getElementById('api-keys-detail-table-body');
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-8 text-center text-slate-400 font-bold"><i class="fas fa-spinner fa-spin mr-2"></i> Mengambil data API Keys...</td></tr>`;

            try {
                const response = await fetch(getApiBaseUrl() + '/api/admin/global-api-keys');
                if (!response.ok) throw new Error('Refresh gagal');
                const result = await response.json();
                
                if (result.ok && Array.isArray(result.globalKeys)) {
                    renderApiKeysDetailTable(result.globalKeys);
                } else {
                    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-8 text-center text-red-500 font-bold">Gagal memuat data API Keys</td></tr>`;
                }
            } catch (err) {
                if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-8 text-center text-red-500 font-bold">Error: ${err.message}</td></tr>`;
            }
        };

        window.closeApiKeysDetailModal = function() {
            const modal = document.getElementById('api-keys-detail-modal');
            if (modal) modal.classList.add('hidden');
            if (modal) modal.classList.remove('flex');
        };

        function renderApiKeysDetailTable(keys) {
            const tbody = document.getElementById('api-keys-detail-table-body');
            if (!tbody) return;

            if (keys.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-8 text-center text-slate-400 font-bold">Belum ada API Key global terdaftar.</td></tr>`;
                return;
            }

            function detectProviderFromKey(key) {
                if (!key) return 'Unknown';
                if (key.startsWith('AIzaSy')) return 'Google Gemini';
                if (key.startsWith('sk-')) return 'OpenAI (ChatGPT)';
                if (key.startsWith('sk-or-v1-') || key.startsWith('sk-or-')) return 'OpenRouter';
                if (key.startsWith('gsk_')) return 'Groq';
                if (key.includes('deepseek')) return 'DeepSeek';
                return 'Unknown';
            }

            tbody.innerHTML = keys.map((k, i) => {
                const fullKey = k.key || '';
                const provider = detectProviderFromKey(fullKey);
                const source = k.addedAt || 'Global Settings';
                const isExhausted = k.status === 'exhausted';
                const lastUpdated = k.updatedAt ? new Date(k.updatedAt).toLocaleString('id-ID') : '-';
                
                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="px-6 py-4 text-center font-bold text-slate-400">${i + 1}</td>
                        <td class="px-6 py-4">
                            <span class="text-[10px] font-black uppercase px-2 py-1 rounded bg-slate-200 text-slate-600">${provider}</span>
                        </td>
                        <td class="px-6 py-4">
                            <div class="flex items-center gap-2">
                                <code class="text-xs font-mono bg-white border border-slate-100 px-2 py-1 rounded-lg text-slate-700">${fullKey.substring(0, 8)}••••••••${fullKey.substring(fullKey.length - 4)}</code>
                                <button onclick="copyApiKey('${fullKey}')" class="text-slate-400 hover:text-sky-600 transition-all" title="Salin Key">
                                    <i class="fas fa-copy text-xs"></i>
                                </button>
                            </div>
                        </td>
                        <td class="px-6 py-4">
                            ${isExhausted ? 
                                '<span class="text-[9px] font-black bg-red-100 text-red-600 px-2.5 py-1 rounded-full flex items-center gap-1 w-fit"><i class="fas fa-times-circle"></i> KUOTA HABIS</span>' : 
                                '<span class="text-[9px] font-black bg-emerald-100 text-emerald-600 px-2.5 py-1 rounded-full flex items-center gap-1 w-fit"><i class="fas fa-check-circle"></i> AKTIF</span>'
                            }
                        </td>
                        <td class="px-6 py-4">
                            <span class="text-[10px] font-bold text-slate-500">${source}</span>
                            ${k.note ? `<p class="text-[10px] text-slate-400 mt-0.5 italic">${k.note}</p>` : ''}
                        </td>
                        <td class="px-6 py-4 text-center">
                            <button onclick="removeGlobalApiKey(${i})" class="w-8 h-8 flex items-center justify-center text-red-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all" title="Hapus Key">
                                <i class="fas fa-trash-alt text-xs"></i>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        window.copyApiKey = function(key) {
            navigator.clipboard.writeText(key).then(() => {
                showToast('API Key disalin ke clipboard!', 'success');
            }).catch(err => {
                console.error('Clipboard error:', err);
                showToast('Gagal menyalin key', 'error');
            });
        };

        // --- END API KEY MANAGEMENT FUNCTIONS ---

        // --- QUIZZ MANAGEMENT FUNCTIONS ---

        async function openQuizzAiModal() {
            const { value: formValues } = await Swal.fire({
                title: 'Buat Quizz AI',
                html:
                    '<input id="swal-q-topic" class="swal2-input" placeholder="Topik (misal: Kemajuan Teknologi)">' +
                    '<input id="swal-q-count" type="number" class="swal2-input" value="5" min="1" max="50" placeholder="Jumlah (misal: 5)">',
                focusConfirm: false,
                showCancelButton: true,
                confirmButtonText: 'Generate',
                confirmButtonColor: '#0ea5e9',
                preConfirm: () => {
                    return {
                        topic: document.getElementById('swal-q-topic').value,
                        count: document.getElementById('swal-q-count').value
                    }
                }
            });

            if (formValues && formValues.topic && formValues.count) {
                Swal.fire({
                    title: 'Membuat Quizz...',
                    html: '<div class="text-sm text-slate-500">AI sedang menyusun pertanyaan interaktif, harap tunggu.</div>',
                    allowOutsideClick: false,
                    didOpen: () => Swal.showLoading()
                });

                try {
                    let teacherId = null;
                    if (typeof currentSiswa !== 'undefined' && currentSiswa && currentSiswa.role === 'guru') {
                        teacherId = currentSiswa.id;
                    }
                    const response = await fetch(getApiBaseUrl() + '/api/generate-quizz-ai', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            topic: formValues.topic,
                            count: parseInt(formValues.count) || 5,
                            teacherId: teacherId
                        })
                    });

                    const data = await response.json();
                    if (data.ok && data.questions) {
                        if (!db.quizzes) db.quizzes = [];
                        db.quizzes.push(...data.questions);
                        await save();
                        renderAdminQuizz();
                        renderTeacherQuizz();
                        Swal.fire('Berhasil!', `${data.questions.length} soal quizz telah ditambahkan.`, 'success');
                    } else {
                        throw new Error(data.error || 'Gagal generate AI');
                    }
                } catch (e) {
                    Swal.fire('Error', e.message, 'error');
                }
            }
        }

        async function openQuizzModal() {
            const result = await Swal.fire({
                title: 'Tambah Soal Quizz Manual',
                html:
                    '<input id="quizz-q" class="swal2-input" placeholder="Pertanyaan">' +
                    '<div class="flex gap-2"><input id="quizz-a0" class="swal2-input w-full" placeholder="Opsi A"><input id="quizz-a1" class="swal2-input w-full" placeholder="Opsi B"></div>' +
                    '<div class="flex gap-2 mb-4"><input id="quizz-a2" class="swal2-input w-full" placeholder="Opsi C"><input id="quizz-a3" class="swal2-input w-full" placeholder="Opsi D"></div>' +
                    '<select id="quizz-correct" class="swal2-select w-full">' +
                    '<option value="0">Jawaban Benar: A</option>' +
                    '<option value="1">Jawaban Benar: B</option>' +
                    '<option value="2">Jawaban Benar: C</option>' +
                    '<option value="3">Jawaban Benar: D</option>' +
                    '</select>',
                focusConfirm: false,
                width: '600px',
                showCancelButton: true,
                confirmButtonText: 'Simpan',
                confirmButtonColor: '#0ea5e9',
                preConfirm: () => {
                    const q = document.getElementById('quizz-q').value;
                    const a0 = document.getElementById('quizz-a0').value;
                    const a1 = document.getElementById('quizz-a1').value;
                    if (!q || !a0 || !a1) return Swal.showValidationMessage('Pertanyaan dan minimal 2 opsi (A & B) wajib diisi!');
                    return {
                        question: q,
                        answers: [a0, a1,
                            document.getElementById('quizz-a2').value || "",
                            document.getElementById('quizz-a3').value || ""].filter(x => x && x.trim() !== ""),
                        correct: parseInt(document.getElementById('quizz-correct').value) || 0
                    }
                }
            });

            if (result.isConfirmed && result.value) {
                if (!db.quizzes) db.quizzes = [];
                const answers = result.value.answers;
                db.quizzes.push({
                    question: result.value.question,
                    answers: answers,
                    correct: Math.min(result.value.correct, answers.length - 1)
                });
                await save();
                renderAdminQuizz();
                renderTeacherQuizz();
                const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
                Toast.fire({ icon: 'success', title: 'Pertanyaan Quizz ditambahkan!' });
            }
        }

        async function deleteQuizz(idx) {
            const result = await Swal.fire({
                title: 'Hapus Pertanyaan Quizz?',
                text: 'Pertanyaan ini akan dihapus secara permanen.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#ef4444',
                confirmButtonText: 'Ya, Hapus!'
            });
            if (result.isConfirmed) {
                db.quizzes.splice(idx, 1);
                await save();
                renderAdminQuizz();
                renderTeacherQuizz();
            }
        }

        function renderAdminQuizz() {
            const tbody = document.getElementById('admin-quizz-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (!db.quizzes || db.quizzes.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-center py-8 text-slate-400"><i class="fas fa-gamepad text-3xl mb-2 opacity-30 block"></i>Belum ada pertanyaan quizz. Gunakan AI atau buat manual.</td></tr>';
                return;
            }

            db.quizzes.forEach((q, idx) => {
                const tr = document.createElement('tr');
                tr.className = 'border-b border-slate-50 hover:bg-slate-50/50 transition-colors';
                let answersHtml = q.answers.map((a, i) =>
                    `<div class="${i === q.correct ? 'text-green-600 font-bold' : 'text-slate-500'} bg-slate-50 p-1 mb-1 rounded">
                        ${String.fromCharCode(65 + i)}. ${a}
                    </div>`
                ).join('');

                tr.innerHTML = `
                    <td class="px-6 py-4">
                        <div class="text-sm font-bold text-slate-800">${q.question}</div>
                    </td>
                    <td class="px-6 py-4 text-xs w-1/2">${answersHtml}</td>
                    <td class="px-6 py-4 text-center">
                        <button onclick="deleteQuizz(${idx})" class="w-8 h-8 rounded-xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-all">
                            <i class="fas fa-trash-alt text-[10px]"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        function renderTeacherQuizz() {
            const tbody = document.getElementById('teacher-quizz-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (!db.quizzes || db.quizzes.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-center py-8 text-slate-400"><i class="fas fa-gamepad text-3xl mb-2 opacity-30 block"></i>Belum ada pertanyaan quizz. Gunakan AI atau buat manual.</td></tr>';
                return;
            }

            db.quizzes.forEach((q, idx) => {
                const tr = document.createElement('tr');
                tr.className = 'border-b border-slate-50 hover:bg-slate-50/50 transition-colors';
                let answersHtml = q.answers.map((a, i) =>
                    `<div class="${i === q.correct ? 'text-green-600 font-bold' : 'text-slate-500'} bg-slate-50 p-1 mb-1 rounded">
                        ${String.fromCharCode(65 + i)}. ${a}
                    </div>`
                ).join('');

                tr.innerHTML = `
                    <td class="px-6 py-4">
                        <div class="text-sm font-bold text-slate-800">${q.question}</div>
                    </td>
                    <td class="px-6 py-4 text-xs w-1/2">${answersHtml}</td>
                    <td class="px-6 py-4 text-center">
                        <button onclick="deleteQuizz(${idx})" class="w-8 h-8 rounded-xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-all">
                            <i class="fas fa-trash-alt text-[10px]"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        window.openQuizzAiModal = openQuizzAiModal;
        window.openQuizzModal = openQuizzModal;
        window.deleteQuizz = deleteQuizz;
        window.renderAdminQuizz = renderAdminQuizz;
        window.renderTeacherQuizz = renderTeacherQuizz;

        // --- INIT ---
        window.addEventListener('load', async () => {
            // Fallback: Hide loading overlay after 3 seconds regardless
            setTimeout(() => {
                const overlay = document.getElementById('loading-overlay');
                if (overlay && !overlay.classList.contains('hidden')) {
                    overlay.classList.add('hidden');
                    overlay.classList.remove('flex');
                }
            }, 2000);

            try {
                await init();
                console.log('App initialized, db has', db.students.length, 'students');
                const typeSel = document.getElementById('q-type');
                if (typeSel) typeSel.addEventListener('change', onQuestionTypeChange);

                // Close import/export dropdowns when clicking outside their controls
                document.addEventListener('click', (e) => {
                    const importDropdown = document.getElementById('import-dropdown');
                    const exportDropdown = document.getElementById('export-dropdown');
                    
                    if (!importDropdown || !exportDropdown) return;

                    const clickedImportToggle = e.target.closest('[onclick="toggleImportDropdown()"]');
                    const clickedExportToggle = e.target.closest('[onclick="toggleExportDropdown()"]');
                    const clickedImportDropdown = e.target.closest('#import-dropdown');
                    const clickedExportDropdown = e.target.closest('#export-dropdown');

                    if (!clickedImportToggle && !clickedExportToggle && !clickedImportDropdown && !clickedExportDropdown) {
                        importDropdown.classList.add('hidden');
                        exportDropdown.classList.add('hidden');
                    }
                });

                // Hide loading overlay after initialization
                const overlay = document.getElementById('loading-overlay');
                if (overlay) {
                    overlay.classList.add('hidden');
                    overlay.classList.remove('flex');
                }
            } catch (error) {
                console.error('Initialization error:', error);
                // Hide loading overlay even if init fails
                const overlay = document.getElementById('loading-overlay');
                if (overlay) {
                    overlay.classList.add('hidden');
                    overlay.classList.remove('flex');
                }
            }

            // Add keyboard support for zoom modal
            document.addEventListener('keydown', function (e) {
                const modal = document.getElementById('image-zoom-modal');
                if (!modal || modal.classList.contains('hidden')) return;

                if (e.key === 'Escape') {
                    closeImageZoom();
                } else if (e.key === 'ArrowRight') {
                    nextZoomImage();
                    e.preventDefault();
                } else if (e.key === 'ArrowLeft') {
                    previousZoomImage();
                    e.preventDefault();
                }
            });
        });

    