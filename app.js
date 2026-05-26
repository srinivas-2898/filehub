import { supabaseClient } from './config.js';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { isCapacitorApp, APP_AUTH_REDIRECT, handleOAuthRedirectUrl } from './platform.js';
import { appDownloadFile, appShareFile } from './app-native-files.js';

window.appDownloadFile = appDownloadFile;
window.appShareFile = appShareFile;

// App Detection & PWA Install Prompts Handling
const isApp = isCapacitorApp();
if (isApp) {
    if (document.body) {
        document.body.classList.add('is-app');
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            document.body.classList.add('is-app');
        });
    }
}
// Prevent browser's native PWA install/Add to Home screen prompt globally
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
});

let currentUser = null;
let filesChannel = null;
let mainAppInitialized = false;

// SPA State
window.allFiles = [];
window.currentFilter = 'all';
window.currentSort = 'newest';
window.searchQuery = '';
window.selectedFiles = new Set();
window.selectModeActive = false;
window.currentFilteredFiles = [];
window.undoTimeoutId = null;

const APP_VERSION = 'v1.0';
const APP_UPDATE_URL = 'https://github.com/srinivas-2898/filehub/releases/tag/v1.0';
const APP_APK_DOWNLOAD_URL = 'https://github.com/srinivas-2898/filehub/releases/download/v1.0/GJS.File.Hub.apk';

function checkAppUpdateNotification() {
    const lastSeen = localStorage.getItem('app_version_seen');
    if (lastSeen === APP_VERSION) return;

    localStorage.setItem('app_version_seen', APP_VERSION);

    const banner = document.getElementById('update-banner');
    if (banner) {
        banner.classList.remove('hidden');
        banner.style.display = '';
    }

    setTimeout(() => {
        showToast('GJS File Hub v1.0 is here! Tap "Update Available" for details.');
    }, 1500);
}

window.undoFileId = null;
window.hasPurged = false;
window.isListView = false;
window.folders = [];
window.currentFolderId = null;
window.pendingUploadFiles = null;

// Page Detection
const IS_DASHBOARD = window.location.pathname.includes('dashboard.html');
const IS_PROFILE = window.location.pathname.includes('profile.html');
const IS_INDEX = !IS_DASHBOARD && !IS_PROFILE;

// Device Detection
function detectDevice() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    const isMobileWidth = window.innerWidth <= 768;
    const deviceType = (isMobileUA || isMobileWidth) ? 'Mobile' : 'Desktop';

    localStorage.setItem('deviceType', deviceType);

    console.log(`=== Device Info ===`);
    console.log(`Device Type: ${deviceType}`);
    console.log(`Screen Width: ${window.innerWidth}px, Height: ${window.innerHeight}px`);
    let os = 'Unknown OS';
    if (/android/i.test(userAgent)) os = 'Android';
    else if (/ipad|iphone|ipod/i.test(userAgent)) os = 'iOS';
    else if (/windows/i.test(userAgent)) os = 'Windows';
    else if (/mac/i.test(userAgent)) os = 'MacOS';
    else if (/linux/i.test(userAgent)) os = 'Linux';
    console.log(`Operating System: ${os}`);
    console.log(`===================`);

    document.body.classList.remove('device-mobile', 'device-desktop');
    document.body.classList.add(deviceType === 'Mobile' ? 'device-mobile' : 'device-desktop');

    if (IS_DASHBOARD) {
        const desktopNav = document.querySelector('.desktop-nav');
        const mobileNav = document.querySelector('.mobile-bottom-nav');
        if (deviceType === 'Mobile') {
            if (desktopNav) desktopNav.style.display = 'none';
            if (mobileNav) mobileNav.style.display = 'flex';
        } else {
            if (desktopNav) desktopNav.style.display = 'flex';
            if (mobileNav) mobileNav.style.display = 'none';
        }
    }
}

detectDevice();
window.addEventListener('resize', detectDevice);
window.addEventListener('orientationchange', detectDevice);

// Google OAuth deep link (native app only)
if (isCapacitorApp()) {
    App.addListener('appUrlOpen', async (event) => {
        const ok = await handleOAuthRedirectUrl(event.url, supabaseClient, Browser);
        if (ok && IS_INDEX) {
            window.location.replace('dashboard.html');
        }
    });
}

// ══════════════════════════════════════════════
//  THEME MANAGER — Dark / Light Mode Toggle
// ══════════════════════════════════════════════
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const isDark = savedTheme === 'dark';
    if (isDark) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    updateThemeIcons(isDark);
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeIcons(isDark);
}

function updateThemeIcons(isDark) {
    const desktopToggle = document.getElementById('theme-toggle-btn');
    const mobileToggle = document.getElementById('m-theme-toggle-btn');
    [desktopToggle, mobileToggle].forEach(btn => {
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon) {
                icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
            }
        }
    });
    // Re-render Lucide icons so the swap takes effect
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// Wire up toggle button click listeners
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const mThemeToggleBtn = document.getElementById('m-theme-toggle-btn');
if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
if (mThemeToggleBtn) mThemeToggleBtn.addEventListener('click', toggleTheme);

// Initialize theme on load
initTheme();

// --- Brute Force Protection Constants ---
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
const ATTEMPTS_KEY = 'login_attempts';
const LOCKOUT_KEY = 'lockout_until';

// --- Brute Force Helper Functions ---
function getLoginAttempts() {
    return parseInt(localStorage.getItem(ATTEMPTS_KEY) || '0');
}

function incrementLoginAttempts() {
    const attempts = getLoginAttempts() + 1;
    localStorage.setItem(ATTEMPTS_KEY, attempts.toString());
    return attempts;
}

function resetLoginAttempts() {
    localStorage.removeItem(ATTEMPTS_KEY);
    localStorage.removeItem(LOCKOUT_KEY);
}

function getLockoutUntil() {
    return parseInt(localStorage.getItem(LOCKOUT_KEY) || '0');
}

function setLockoutUntil(timestamp) {
    localStorage.setItem(LOCKOUT_KEY, timestamp.toString());
}

function isLockedOut() {
    const lockoutUntil = getLockoutUntil();
    return Date.now() < lockoutUntil;
}

function getLockoutRemainingTime() {
    const remaining = getLockoutUntil() - Date.now();
    return Math.max(0, Math.ceil(remaining / 1000));
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// DOM Elements
const authWrapper = document.getElementById('auth-wrapper');
const mainContainer = document.getElementById('main-container');
const authLoading = document.getElementById('auth-loading');

// Immediately check for auth tokens in URL (Supabase redirect)
if (IS_INDEX && (window.location.hash || window.location.search.includes('code='))) {
    if (authLoading) authLoading.classList.remove('hidden');
    if (authWrapper) authWrapper.classList.add('hidden');
}

// Auth Toggles
// Auth Views & Toggles
const loginView = document.getElementById('login-view');
const signupView = document.getElementById('signup-view');
const goToSignup = document.getElementById('go-to-signup');
const goToLogin = document.getElementById('go-to-login');
const signupSuccessView = document.getElementById('signup-success-view');
const successToLogin = document.getElementById('success-to-login');
const togglePasswordBtn = document.getElementById('toggle-password-visibility');

// Forms
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');

// Inputs
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const signupName = document.getElementById('signup-name');
const signupEmail = document.getElementById('signup-email');
const signupPassword = document.getElementById('signup-password');

// Feedback
const authError = document.getElementById('auth-error');
const authMsg = document.getElementById('auth-msg');
const userGreeting = document.getElementById('user-greeting');
const headerAvatar = document.getElementById('header-avatar');
const logoutBtn = document.getElementById('logout-btn');
const profileBtn = document.getElementById('profile-btn');
const backToDashboardBtn = document.getElementById('back-to-dashboard');

// Profile Page Elements
const profileForm = document.getElementById('profile-form');
const profileEmailInput = document.getElementById('profile-email');
const profileUsernameInput = document.getElementById('profile-username');
const profileFullnameInput = document.getElementById('profile-fullname');
const avatarInput = document.getElementById('avatar-input');
const profileAvatarPreview = document.getElementById('profile-avatar-preview');
const saveProfileBtn = document.getElementById('save-profile-btn');

const tabLogin = document.getElementById('tab-login');
const tabSignup = document.getElementById('tab-signup');

// Show/Hide Auth Views
function showLoginView() {
    if (loginView) loginView.classList.remove('hidden-view');
    if (signupView) signupView.classList.add('hidden-view');
    if (signupSuccessView) signupSuccessView.classList.add('hidden-view');
    if (tabLogin) tabLogin.classList.add('active');
    if (tabSignup) tabSignup.classList.remove('active');
    clearFeedback();
}

function showSignupView() {
    if (signupView) signupView.classList.remove('hidden-view');
    if (loginView) loginView.classList.add('hidden-view');
    if (signupSuccessView) signupSuccessView.classList.add('hidden-view');
    if (tabSignup) tabSignup.classList.add('active');
    if (tabLogin) tabLogin.classList.remove('active');
    clearFeedback();
}

function showSuccessView() {
    if (signupView) signupView.classList.add('hidden-view');
    if (loginView) loginView.classList.add('hidden-view');
    if (signupSuccessView) signupSuccessView.classList.remove('hidden-view');
    clearFeedback();
}

function clearFeedback() {
    if (authError) authError.textContent = '';
    if (authMsg) authMsg.textContent = '';
}

if (goToSignup) goToSignup.addEventListener('click', (e) => { e.preventDefault(); showSignupView(); });
if (goToLogin) goToLogin.addEventListener('click', (e) => { e.preventDefault(); showLoginView(); });
if (successToLogin) successToLogin.addEventListener('click', showLoginView);

if (tabLogin) {
    tabLogin.addEventListener('click', (e) => { e.preventDefault(); showLoginView(); });
}
if (tabSignup) {
    tabSignup.addEventListener('click', (e) => { e.preventDefault(); showSignupView(); });
}

// Password Visibility Toggle
if (togglePasswordBtn && loginPassword) {
    togglePasswordBtn.addEventListener('click', () => {
        const type = loginPassword.getAttribute('type') === 'password' ? 'text' : 'password';
        loginPassword.setAttribute('type', type);
        const icon = togglePasswordBtn.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', type === 'password' ? 'eye' : 'eye-off');
            lucide.createIcons();
        }
    });
}

// Check active session on load
async function checkUser() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        if (IS_INDEX) {
            if (authLoading) authLoading.classList.remove('hidden');
            window.location.replace('dashboard.html');
        } else {
            showMainApp(session.user);
        }
    } else {
        // If we were waiting for a token but it's not there, hide loader
        if (authLoading) authLoading.classList.add('hidden');
        if (IS_DASHBOARD || IS_PROFILE) {
            window.location.replace('index.html');
        } else {
            showAuthScreen();
        }
    }
}

// Setup Auth Listener
supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
        if (IS_INDEX) {
            window.location.replace('dashboard.html');
        } else {
            showMainApp(session.user);
        }
    } else if (event === 'SIGNED_OUT') {
        if (IS_DASHBOARD || IS_PROFILE) {
            window.location.replace('index.html');
        } else {
            showAuthScreen();
        }
    }
});

let lockoutInterval = null;

function updateLockoutUI() {
    if (isLockedOut()) {
        const remaining = getLockoutRemainingTime();
        if (authError) {
            authError.textContent = `Too many attempts. Try again in ${formatTime(remaining)}`;
        }
        const btn = loginForm?.querySelector('button[type="submit"]');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'LOCKED';
        }

        if (!lockoutInterval) {
            lockoutInterval = setInterval(() => {
                if (isLockedOut()) {
                    updateLockoutUI();
                } else {
                    clearInterval(lockoutInterval);
                    lockoutInterval = null;
                    if (authError) authError.textContent = '';
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = 'SIGN IN';
                    }
                }
            }, 1000);
        }
    }
}

if (IS_INDEX) {
    updateLockoutUI();
}

// Handle Login Form Submission
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (isLockedOut()) {
            updateLockoutUI();
            return;
        }

        clearFeedback();
        const btn = loginForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Processing...';

        try {
            const { error } = await supabaseClient.auth.signInWithPassword({
                email: loginEmail.value,
                password: loginPassword.value
            });
            if (error) throw error;

            // Successful login
            resetLoginAttempts();
        } catch (err) {
            const card = document.getElementById('auth-card-container');
            if (card) {
                card.classList.remove('shake-anim');
                void card.offsetWidth; // trigger reflow
                card.classList.add('shake-anim');
            }

            const attempts = incrementLoginAttempts();
            if (attempts >= MAX_ATTEMPTS) {
                setLockoutUntil(Date.now() + LOCKOUT_MS);
                updateLockoutUI();
            } else if (attempts >= 3) {
                const remaining = MAX_ATTEMPTS - attempts;
                authError.textContent = `Warning: ${remaining} attempt${remaining > 1 ? 's' : ''} remaining before lockout. (${err.message})`;
            } else {
                authError.textContent = err.message;
            }
        } finally {
            if (!isLockedOut()) {
                btn.disabled = false;
                btn.textContent = 'SIGN IN';
            }
        }
    });
}

// Handle Signup Form Submission
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFeedback();
        const btn = signupForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Processing...';

        try {
            const { data, error } = await supabaseClient.auth.signUp({
                email: signupEmail.value,
                password: signupPassword.value,
                options: {
                    data: {
                        full_name: signupName.value
                    }
                }
            });

            if (error) throw error;

            // Show success message regardless of auto-login session
            // This ensures they see the "Confirm Email" instruction as requested
            showSuccessView();
        } catch (err) {
            authError.textContent = err.message;
        } finally {
            btn.disabled = false;
            btn.textContent = 'CREATE ACCOUNT';
        }
    });
}

// Handle Google Login
const googleLoginBtn = document.getElementById('google-login-btn');
if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', async () => {
        try {
            if (isCapacitorApp()) {
                const { data, error } = await supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: APP_AUTH_REDIRECT,
                        skipBrowserRedirect: true
                    }
                });
                if (error) throw error;
                if (data?.url) {
                    await Browser.open({ url: data.url, windowName: '_self' });
                }
            } else {
                const { error } = await supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: window.location.origin + '/dashboard.html'
                    }
                });
                if (error) throw error;
            }
        } catch (err) {
            console.error('Google login error:', err);
            if (authError) authError.textContent = err.message;
        }
    });
}

// Handle Logout
const mobileLogoutBtn = document.getElementById('mobile-logout-btn');

async function handleSignOut() {
    if (filesChannel) {
        await supabaseClient.removeChannel(filesChannel);
        filesChannel = null;
    }
    await supabaseClient.auth.signOut();
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', handleSignOut);
}
if (mobileLogoutBtn) {
    mobileLogoutBtn.addEventListener('click', handleSignOut);
}

if (profileBtn) {
    profileBtn.addEventListener('click', () => {
        window.location.href = 'profile.html';
    });
}

if (backToDashboardBtn) {
    backToDashboardBtn.addEventListener('click', () => {
        window.location.href = 'dashboard.html';
    });
}

// Handle Delete Account
const deleteAccountBtn = document.getElementById('delete-account-btn');
const deleteAccountModal = document.getElementById('delete-account-modal');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');

if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', () => {
        deleteAccountModal.classList.remove('hidden');
    });
}

if (modalCancelBtn) {
    modalCancelBtn.addEventListener('click', () => {
        deleteAccountModal.classList.add('hidden');
    });
}

// Close modal when clicking the backdrop
if (deleteAccountModal) {
    deleteAccountModal.addEventListener('click', (e) => {
        if (e.target === deleteAccountModal) {
            deleteAccountModal.classList.add('hidden');
        }
    });
}

if (modalConfirmBtn) {
    modalConfirmBtn.addEventListener('click', async () => {
        modalConfirmBtn.disabled = true;
        modalConfirmBtn.textContent = 'Deleting…';

        try {
            // 1. Delete all files belonging to this user from Supabase storage
            if (currentUser) {
                const { data: fileList } = await supabaseClient.storage
                    .from('upload system')
                    .list(currentUser.id, { limit: 1000 });

                if (fileList && fileList.length > 0) {
                    const paths = fileList
                        .filter(f => f.name !== '.emptyFolderPlaceholder')
                        .map(f => `${currentUser.id}/${f.name}`);

                    if (paths.length > 0) {
                        await supabaseClient.storage
                            .from('upload system')
                            .remove(paths);
                    }
                }
            }

            // 2. Delete the user account via the admin/auth API
            const { error } = await supabaseClient.rpc('delete_user');
            if (error) {
                // Fallback: use auth.admin deleteUser if RPC not available
                // For client-side, Supabase v2 exposes auth.admin only server-side.
                // We sign out and let the server handle it, or use a workaround.
                throw error;
            }

            // 3. Clear session and redirect
            localStorage.clear();
            await supabaseClient.auth.signOut();
            window.location.replace('index.html');

        } catch (err) {
            console.error('Delete account error:', err);
            alert(`Could not delete account: ${err.message}`);
            modalConfirmBtn.disabled = false;
            modalConfirmBtn.textContent = 'Yes Delete';
            deleteAccountModal.classList.add('hidden');
        }
    });
}

// Screen toggles
function showAuthScreen() {
    if (authWrapper) authWrapper.classList.remove('hidden');
    if (mainContainer) mainContainer.classList.add('hidden');
}

function showMainApp(user) {
    if (authWrapper) authWrapper.classList.add('hidden');
    if (mainContainer) mainContainer.classList.remove('hidden');

    currentUser = user;

    // Fetch profile data for greeting and avatar
    fetchProfile();

    if (mainAppInitialized) return;
    mainAppInitialized = true;

    if (IS_DASHBOARD) {
        setupSPA();
        setupMobileActions();
        initFilePreviewModal();
        fetchFiles();
        checkAppUpdateNotification();
        setupRealtimeSubscription();
        setupProfilePage();
        setupMobileFolders();
    } else if (IS_PROFILE) {
        setupProfilePage();
    }
}

// --- SPA Routing Logic ---
function setupSPA() {
    const navBtns = document.querySelectorAll('.nav-btn, .nav-item, [data-target]');
    const sections = document.querySelectorAll('.page-section');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            if (!targetId) return;

            // Update active button globally
            document.querySelectorAll('.nav-btn, .nav-item').forEach(b => b.classList.remove('active'));
            document.querySelectorAll(`[data-target="${targetId}"]`).forEach(b => b.classList.add('active'));

            // Show active section
            sections.forEach(sec => {
                if (sec.id === targetId) {
                    sec.classList.remove('hidden-section');
                    sec.classList.add('active-page');
                } else {
                    sec.classList.remove('active-page');
                    sec.classList.add('hidden-section');
                }
            });

            // Dynamic PC page title switching
            const titleMap = {
                'page-upload': 'Dashboard',
                'page-files': 'My Files',
                'page-recent': 'Recent Files',
                'page-trash': 'Trash Bin',
                'page-profile': 'Account Settings'
            };
            const pageTitleEl = document.querySelector('.desktop-page-title');
            if (pageTitleEl && titleMap[targetId]) {
                pageTitleEl.textContent = titleMap[targetId];
            }

            if (targetId === 'page-files') {
                // Reset to root when user clicks the Files nav
                window.currentFolderId = null;
                renderAllFiles();
                if (window.renderFolders) window.renderFolders();
            } else if (targetId === 'page-trash') {
                renderTrashFiles();
            }
        });
    });

    // Desktop Quick Actions
    const dUploadBtn = document.getElementById('d-upload-trigger');
    const sharedFileInput = document.getElementById('file-input');
    if (dUploadBtn && sharedFileInput) {
        dUploadBtn.addEventListener('click', () => sharedFileInput.click());
    }
    const dFolderBtn = document.getElementById('d-new-folder-btn');
    if (dFolderBtn) {
        dFolderBtn.addEventListener('click', () => window.openNewFolderModal());
    }

    // Desktop Folder Upload trigger
    document.getElementById('d-folder-upload-trigger')?.addEventListener('click', () => {
        const dOptModal = document.getElementById('d-upload-options-modal');
        if (dOptModal) dOptModal.classList.remove('hidden');
    });

    // Desktop Upload options controls
    document.getElementById('d-opt-upload-device')?.addEventListener('click', () => {
        document.getElementById('d-upload-options-modal')?.classList.add('hidden');
        sharedFileInput?.click();
    });

    document.getElementById('d-opt-import-app')?.addEventListener('click', () => {
        document.getElementById('d-upload-options-modal')?.classList.add('hidden');
        if (typeof window.openMobileImportModal === 'function') {
            window.openMobileImportModal();
        }
    });

    document.getElementById('d-opt-cancel')?.addEventListener('click', () => {
        document.getElementById('d-upload-options-modal')?.classList.add('hidden');
    });

    const changePwdBtn = document.getElementById('change-password-btn');
    if (changePwdBtn) {
        changePwdBtn.addEventListener('click', () => {
            window.location.href = 'reset-password.html';
        });
    }

    setupFileControls();
}

function setupFileControls() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            window.searchQuery = e.target.value.toLowerCase();
            renderAllFiles();
        });
    }

    // Mobile Search Input Sync
    const mSearchInput = document.getElementById('m-search-input');
    if (mSearchInput) {
        mSearchInput.addEventListener('input', (e) => {
            window.searchQuery = e.target.value.toLowerCase();
            renderAllFiles();
        });
    }

    const chips = document.querySelectorAll('.chip');
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            window.currentFilter = chip.getAttribute('data-filter');
            renderAllFiles();
        });
    });

    // Mobile Filter Chips Sync
    const mChips = document.querySelectorAll('.m-chip');
    mChips.forEach(chip => {
        chip.addEventListener('click', () => {
            mChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            window.currentFilter = chip.getAttribute('data-filter');
            renderAllFiles();
        });
    });

    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            window.currentSort = e.target.value;
            renderAllFiles();
        });
    }

    // Mobile Sort Selection Sync
    const mSortSelect = document.getElementById('m-sort-select');
    if (mSortSelect) {
        mSortSelect.addEventListener('change', (e) => {
            window.currentSort = e.target.value;
            renderAllFiles();
        });
    }

    // Mobile Upload FAB Button Wire
    const mUploadFab = document.getElementById('m-upload-fab');
    const fileInput = document.getElementById('file-input');
    if (mUploadFab && fileInput) {
        mUploadFab.addEventListener('click', () => {
            if (window.currentFolderId) {
                const optModal = document.getElementById('m-upload-options-modal');
                if (optModal) optModal.classList.remove('hidden');
            } else {
                fileInput.click();
            }
        });
    }

    // Mobile Upload Bottom Sheet Controls
    document.getElementById('m-opt-upload-device')?.addEventListener('click', () => {
        document.getElementById('m-upload-options-modal')?.classList.add('hidden');
        fileInput?.click();
    });

    document.getElementById('m-opt-import-app')?.addEventListener('click', () => {
        document.getElementById('m-upload-options-modal')?.classList.add('hidden');
        if (typeof window.openMobileImportModal === 'function') {
            window.openMobileImportModal();
        }
    });

    document.getElementById('m-opt-cancel')?.addEventListener('click', () => {
        document.getElementById('m-upload-options-modal')?.classList.add('hidden');
    });

    document.getElementById('m-import-cancel-btn')?.addEventListener('click', () => {
        document.getElementById('m-import-files-modal')?.classList.add('hidden');
    });

    document.getElementById('m-import-confirm-btn')?.addEventListener('click', async () => {
        if (!window.selectedImportIds || window.selectedImportIds.size === 0) return;
        const confirmBtn = document.getElementById('m-import-confirm-btn');
        const countSpan = document.getElementById('m-import-count');
        confirmBtn.textContent = 'Importing...';
        confirmBtn.disabled = true;

        try {
            const idsArray = Array.from(window.selectedImportIds);

            // Move files into folder (update reference only — no re-upload)
            const { error } = await supabaseClient
                .from('Files')
                .update({ folder_id: window.currentFolderId })
                .in('id', idsArray);

            if (error) throw error;

            showToast(isCapacitorApp()
                ? `Moved ${idsArray.length} file(s) successfully!`
                : `Imported ${idsArray.length} files successfully!`);
            document.getElementById('m-import-files-modal').classList.add('hidden');
            fetchFiles();
        } catch (err) {
            console.error("Error importing files:", err);
            alert("Failed to import files.");
        } finally {
            confirmBtn.textContent = 'Import';
            if (countSpan) countSpan.textContent = '0';
            confirmBtn.disabled = false;
        }
    });

    const gridBtn = document.getElementById('grid-view-btn');
    const listBtn = document.getElementById('list-view-btn');
    const fileGrid = document.querySelector('#page-files .file-grid');
    if (gridBtn && listBtn && fileGrid) {
        gridBtn.addEventListener('click', () => {
            window.isListView = false;
            gridBtn.classList.add('active');
            listBtn.classList.remove('active');
            fileGrid.classList.remove('list-view');
        });
        listBtn.addEventListener('click', () => {
            window.isListView = true;
            listBtn.classList.add('active');
            gridBtn.classList.remove('active');
            fileGrid.classList.add('list-view');
        });
    }

    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', window.bulkDeleteFiles);
    }

    // Select mode triggers
    document.querySelectorAll('.select-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (typeof window.toggleSelectMode === 'function') {
                window.toggleSelectMode();
            }
        });
    });

    // Bulk action cancel button
    const cancelBtn = document.getElementById('bulk-cancel-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (window.selectModeActive && typeof window.toggleSelectMode === 'function') {
                window.toggleSelectMode();
            }
        });
    }

    // Select All Checkbox
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            if (isChecked) {
                window.currentFilteredFiles.forEach(f => window.selectedFiles.add(f.id));
            } else {
                window.currentFilteredFiles.forEach(f => window.selectedFiles.delete(f.id));
            }
            toggleBulkActionBar();
            renderAllFiles();
        });
    }

    // Deselect All button
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
            window.selectedFiles.clear();
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            toggleBulkActionBar();
            renderAllFiles();
        });
    }

    // Empty Trash button
    const emptyTrashBtn = document.getElementById('empty-trash-btn');
    if (emptyTrashBtn) {
        emptyTrashBtn.addEventListener('click', () => {
            if (typeof window.emptyTrash === 'function') {
                window.emptyTrash();
            }
        });
    }
}

// --- Profile Logic ---
async function fetchProfile() {
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();

        if (error && error.code !== 'PGRST116') throw error;

        if (data) {
            const displayName = data.full_name || data.username || currentUser.email;
            const firstName = displayName.split(' ')[0];
            if (userGreeting) userGreeting.textContent = `Hello, ${displayName}`;

            // Update PC welcome card username
            document.querySelectorAll('.dynamic-username').forEach(el => {
                el.textContent = firstName;
            });

            // ── Mobile greeting & avatar ──
            const mGreeting = document.getElementById('mobile-greeting-text');
            if (mGreeting) mGreeting.textContent = `Welcome, ${firstName}!`;
            if (data.avatar_url) {
                if (headerAvatar) headerAvatar.src = data.avatar_url;
                if (profileAvatarPreview) profileAvatarPreview.src = data.avatar_url;
                const mAvatar = document.getElementById('mobile-header-avatar');
                if (mAvatar) mAvatar.src = data.avatar_url;
            }

            if (IS_PROFILE) {
                if (profileUsernameInput) profileUsernameInput.value = data.username || '';
                if (profileFullnameInput) profileFullnameInput.value = data.full_name || '';
            }
        } else {
            const email = currentUser.email;
            if (userGreeting) userGreeting.textContent = `Hello, ${email}`;
            const mGreeting = document.getElementById('mobile-greeting-text');
            if (mGreeting) mGreeting.textContent = `Welcome!`;
        }

        if (IS_PROFILE && profileEmailInput) {
            profileEmailInput.value = currentUser.email;
        }
    } catch (err) {
        console.error('Error fetching profile:', err);
    }
}

function setupProfilePage() {
    if (avatarInput) {
        avatarInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    if (profileAvatarPreview) profileAvatarPreview.src = e.target.result;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            saveProfileBtn.disabled = true;
            saveProfileBtn.textContent = 'Saving...';

            try {
                let avatarUrl = profileAvatarPreview.src;

                // Handle file upload if a new file was selected
                const file = avatarInput.files[0];
                if (file) {
                    const fileExt = file.name.split('.').pop();
                    const fileName = `${currentUser.id}_${Math.random()}.${fileExt}`;
                    const filePath = `avatars/${fileName}`;

                    const { error: uploadError } = await supabaseClient.storage
                        .from('upload system') // Reusing existing bucket or assume one
                        .upload(filePath, file, { upsert: true });

                    if (uploadError) throw uploadError;

                    const { data: publicUrlData } = supabaseClient.storage
                        .from('upload system')
                        .getPublicUrl(filePath);

                    avatarUrl = publicUrlData.publicUrl;
                }

                const updates = {
                    id: currentUser.id,
                    username: profileUsernameInput.value,
                    full_name: profileFullnameInput.value,
                    avatar_url: avatarUrl,
                    updated_at: new Date()
                };

                const { error } = await supabaseClient
                    .from('profiles')
                    .upsert(updates);

                if (error) throw error;

                showToast("Profile updated successfully!");
                fetchProfile(); // Refresh UI
            } catch (err) {
                console.error('Error updating profile:', err);
                alert(`Error updating profile: ${err.message}`);
            } finally {
                saveProfileBtn.disabled = false;
                saveProfileBtn.textContent = 'Save Profile';
            }
        });
    }
}

// --- Realtime Logic ---
const realtimeToast = document.getElementById('realtime-toast');

function showToast(message, type = 'info') {
    const types = { success: '✅', error: '❌', info: 'ℹ️' };
    const icon = types[type] || types.info;
    if (realtimeToast) {
        const msgSpan = realtimeToast.querySelector('.toast-msg');
        const iconSpan = realtimeToast.querySelector('.toast-icon');
        if (msgSpan) msgSpan.textContent = message || 'File list updated';
        if (iconSpan) iconSpan.textContent = icon;
        realtimeToast.classList.remove('hidden');
        realtimeToast.classList.remove('success');
        if (type === 'success') realtimeToast.classList.add('success');
        setTimeout(() => {
            realtimeToast.classList.add('hidden');
        }, 3000);
        return;
    }
    // Fallback: create a temporary toast element
    const toast = document.createElement('div');
    toast.style.cssText = `position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'}; color: white; padding: 12px 24px; border-radius: 25px; font-size: 14px; font-family: Poppins, sans-serif; z-index: 99999; box-shadow: 0 4px 12px rgba(0,0,0,0.3); text-align: center; min-width: 200px;`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

async function ensurePdfJsLoaded() {
    if (window.pdfjsLib) return;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.crossOrigin = 'anonymous';
        script.onload = () => {
            if (window.pdfjsLib) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                resolve();
            } else {
                reject(new Error('pdfjsLib failed to load'));
            }
        };
        script.onerror = () => reject(new Error('Could not load PDF.js'));
        document.head.appendChild(script);
    });
}

const FILE_VIEW_BUCKET = 'upload system';

let _filePreviewState = null;

function getFilePublicUrl(filePath) {
    const { data } = supabaseClient.storage.from(FILE_VIEW_BUCKET).getPublicUrl(filePath);
    return data.publicUrl;
}

function getFilePreviewCategory(file) {
    const type = (file.file_type || '').toLowerCase();
    const name = (file.file_name || '').toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';

    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    if (type.startsWith('image/') || imageExts.includes(ext)) return 'image';

    if (type.includes('pdf') || name.endsWith('.pdf')) return 'pdf';

    const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', '3gp'];
    if (type.startsWith('video/') || videoExts.includes(ext)) return 'video';

    const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'wma', 'aac', 'opus'];
    if (type.startsWith('audio/') || audioExts.includes(ext)) return 'audio';

    const docExts = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
    if (
        docExts.some((e) => name.endsWith('.' + e)) ||
        type.includes('msword') ||
        type.includes('officedocument') ||
        type.includes('spreadsheet') ||
        type.includes('presentation')
    ) {
        return 'document';
    }

    const textExts = ['txt', 'csv', 'json', 'xml', 'html', 'md', 'log', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'sh', 'bat', 'py', 'js', 'ts', 'css', 'scss', 'less', 'env', 'gitignore'];
    if (type.startsWith('text/') || textExts.includes(ext)) return 'text';

    return 'unsupported';
}

function setupImagePinchZoom(img) {
    const wrap = img.parentElement;
    if (!wrap) return;

    let scale = 1;
    let lastScale = 1;
    let startDist = 0;
    let lastTouchEnd = 0;

    const applyScale = () => {
        img.style.transform = `scale(${scale})`;
    };

    wrap.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            startDist = Math.hypot(dx, dy);
            lastScale = scale;
        }
    }, { passive: false });

    wrap.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && startDist > 0) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.hypot(dx, dy);
            scale = Math.min(4, Math.max(1, lastScale * (dist / startDist)));
            applyScale();
        }
    }, { passive: false });

    wrap.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) startDist = 0;
        const now = Date.now();
        if (e.changedTouches.length === 1 && now - lastTouchEnd < 300) {
            scale = 1;
            applyScale();
        }
        lastTouchEnd = now;
    });
}

function closeFilePreviewModal() {
    const modal = document.getElementById('file-preview-modal');
    if (!modal) return;

    const video = modal.querySelector('video');
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }

    modal.classList.remove('fullscreen');
    const fsClose = modal.querySelector('.fullscreen-close-overlay');
    if (fsClose) fsClose.remove();
    const fsBtn = document.getElementById('file-preview-fullscreen-btn');
    if (fsBtn) {
        fsBtn.innerHTML = '<i data-lucide="maximize" style="width:18px;height:18px;"></i>';
    }
    _previewZoom = 1;

    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('file-preview-open');
    _filePreviewState = null;
}

async function downloadPreviewFile(fileName, url) {
    if (!url) return;
    // Delegate to unified download function
    await downloadFile(url, fileName);
}

async function downloadFile(fileUrl, fileName) {
    try {
        // If running inside Capacitor native app, use native handlers if available
        if (isCapacitorApp()) {
            if (typeof window.downloadFileWithProgress === 'function') {
                window.downloadFileWithProgress(fileName, fileUrl);
                return;
            }
            if (typeof window.appDownloadFile === 'function') {
                window.appDownloadFile(fileName, fileUrl);
                return;
            }
        }

        showToast('Downloading... please wait', 'info');

        const response = await fetch(fileUrl);

        if (!response.ok) {
            throw new Error('Download failed');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);

        showToast('File downloaded successfully!', 'success');

    } catch (error) {
        showToast('Download failed. Please try again.', 'error');
        console.error('Download error:', error);
    }
}

async function renderFilePreviewContent(bodyEl, category, publicUrl, file) {
    const fileName = file.file_name || 'File';
    bodyEl.classList.remove('pdf-viewer');
    bodyEl.style.background = '';
    bodyEl.style.padding = '';
    bodyEl.style.alignItems = '';
    bodyEl.style.justifyContent = '';
    bodyEl.style.overflowX = '';
    bodyEl.style.overflowY = '';

    if (category === 'image') {
        bodyEl.innerHTML = `
            <div class="file-preview-zoom-wrap">
                <img class="file-preview-image" src="${publicUrl}" alt="${fileName.replace(/"/g, '&quot;')}">
            </div>`;
        const img = bodyEl.querySelector('.file-preview-image');
        if (img) setupImagePinchZoom(img);
        return;
    }

    if (category === 'pdf') {
        bodyEl.classList.add('pdf-viewer');
        bodyEl.innerHTML = `<div id="pdfjs-viewer" class="pdfjs-viewer"></div>`;
        bodyEl.style.background = '#fff';
        bodyEl.style.padding = '0';
        bodyEl.style.alignItems = 'stretch';
        bodyEl.style.justifyContent = 'flex-start';
        bodyEl.style.overflowX = 'hidden';
        bodyEl.style.overflowY = 'auto';

        const viewerContainer = bodyEl.querySelector('#pdfjs-viewer');
        if (!viewerContainer) return;
        viewerContainer.innerHTML = `
            <div class="file-preview-loading">
                <div class="file-preview-spinner"></div>
                <p>Loading PDF…</p>
            </div>`;

        try {
            await ensurePdfJsLoaded();
            const pdfjsLib = window.pdfjsLib;
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            const loadingTask = pdfjsLib.getDocument(publicUrl);
            const pdf = await loadingTask.promise;

            viewerContainer.innerHTML = '';
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 1 });
                const scale = window.innerWidth / viewport.width;
                const scaledViewport = page.getViewport({ scale });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.width = scaledViewport.width;
                canvas.height = scaledViewport.height;
                canvas.style.width = `${window.innerWidth}px`;
                canvas.style.height = `${scaledViewport.height}px`;
                canvas.className = 'pdf-page-canvas';
                viewerContainer.appendChild(canvas);
                await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
            }
        } catch (err) {
            console.error('PDF render failed:', err);
            viewerContainer.innerHTML = `<div class="file-preview-fallback"><i data-lucide="alert-triangle"></i><p>Unable to render PDF preview.</p><p>Please download the file to view it.</p></div>`;
            if (window.lucide) window.lucide.createIcons();
        }
        return;
    }

    if (category === 'video') {
        bodyEl.innerHTML = `<video class="file-preview-video" src="${publicUrl}" controls playsinline controlsList="nodownload"></video>`;
        return;
    }

    if (category === 'audio') {
        bodyEl.innerHTML = `
            <div class="preview-audio">
                <div class="music-icon"><i data-lucide="music" style="width:40px;height:40px;"></i></div>
                <div class="audio-name">${fileName.replace(/"/g, '&quot;')}</div>
                <audio class="file-preview-audio" src="${publicUrl}" controls></audio>
            </div>`;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    if (category === 'document') {
        const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(publicUrl)}`;
        bodyEl.innerHTML = `<iframe class="file-preview-pdf" src="${officeUrl}" title="${fileName.replace(/"/g, '&quot;')}"></iframe>`;
        return;
    }

    if (category === 'text') {
        bodyEl.innerHTML = `
            <div style="width:100%;position:relative;">
                <div class="preview-loading">
                    <div class="file-preview-spinner"></div>
                    <p>Loading text…</p>
                </div>
            </div>`;
        try {
            const res = await fetch(publicUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            let text = await res.text();
            if (text.length > 500000) text = text.slice(0, 500000) + '\n…(truncated)';
            const pre = document.createElement('pre');
            pre.className = 'file-preview-text';
            pre.textContent = text;

            const copyBtn = document.createElement('button');
            copyBtn.textContent = 'Copy Content';
            copyBtn.className = 'preview-copy-btn';
            copyBtn.addEventListener('click', () => {
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(text).then(() => {
                        copyBtn.textContent = 'Copied!';
                        setTimeout(() => { copyBtn.textContent = 'Copy Content'; }, 2000);
                    });
                }
            });

            bodyEl.innerHTML = '';
            bodyEl.appendChild(copyBtn);
            bodyEl.appendChild(pre);
        } catch (err) {
            bodyEl.innerHTML = `
                <div class="file-preview-fallback">
                    <p>Could not load text: ${err.message || err}</p>
                </div>`;
        }
        return;
    }

    const sizeStr = file.file_size ? (file.file_size / (1024 * 1024)).toFixed(2) + ' MB' : '';
    bodyEl.innerHTML = `
        <div class="file-preview-fallback">
            <i data-lucide="file" style="width: 48px; height: 48px;"></i>
            <p><strong>${fileName.replace(/"/g, '&quot;')}</strong></p>
            ${sizeStr ? `<p style="font-size:12px;color:#94a3b8;">${sizeStr}</p>` : ''}
            <p style="margin-top:8px;">Preview not available for this file type.</p>
        </div>`;
    if (window.lucide) window.lucide.createIcons();
}

let _previewZoom = 1;

function applyPreviewZoom() {
    const wrap = document.querySelector('#file-preview-body .preview-zoom-container');
    if (wrap) {
        wrap.style.transform = `scale(${_previewZoom})`;
    }
    const levelEl = document.getElementById('preview-zoom-level');
    if (levelEl) levelEl.textContent = Math.round(_previewZoom * 100) + '%';
}

function zoomInPreview() {
    _previewZoom = Math.min(5, _previewZoom + 0.25);
    applyPreviewZoom();
}

function zoomOutPreview() {
    _previewZoom = Math.max(0.25, _previewZoom - 0.25);
    applyPreviewZoom();
}

function resetPreviewZoom() {
    _previewZoom = 1;
    applyPreviewZoom();
}

function togglePreviewFullscreen() {
    const modal = document.getElementById('file-preview-modal');
    if (!modal) return;
    const isFs = modal.classList.toggle('fullscreen');
    const btn = document.getElementById('file-preview-fullscreen-btn');
    if (btn) {
        btn.innerHTML = isFs
            ? '<i data-lucide="minimize" style="width:18px;height:18px;"></i>'
            : '<i data-lucide="maximize" style="width:18px;height:18px;"></i>';
        if (window.lucide) window.lucide.createIcons();
    }
    if (isFs) {
        if (!modal.querySelector('.fullscreen-close-overlay')) {
            const closeFs = document.createElement('button');
            closeFs.className = 'fullscreen-close-overlay';
            closeFs.innerHTML = '&times;';
            closeFs.addEventListener('click', togglePreviewFullscreen);
            modal.appendChild(closeFs);
        }
    } else {
        const el = modal.querySelector('.fullscreen-close-overlay');
        if (el) el.remove();
    }
}

async function showFilePreviewModal(file, publicUrl, category) {
    const modal = document.getElementById('file-preview-modal');
    const titleEl = document.getElementById('file-preview-title');
    const bodyEl = document.getElementById('file-preview-body');
    const shareBtn = document.getElementById('file-preview-share');
    if (!modal || !titleEl || !bodyEl) return;

    modal.classList.remove('fullscreen');
    modal.classList.toggle('preview-show-zoom', category !== 'image' && category !== 'audio');
    modal.classList.toggle('preview-show-share', category !== 'document');
    const fsBtn = document.getElementById('file-preview-fullscreen-btn');
    if (fsBtn) {
        fsBtn.innerHTML = '<i data-lucide="maximize" style="width:18px;height:18px;"></i>';
    }
    const fsClose = modal.querySelector('.fullscreen-close-overlay');
    if (fsClose) fsClose.remove();
    _previewZoom = 1;

    _filePreviewState = { file, publicUrl, category };

    titleEl.textContent = file.file_name || 'File';
    bodyEl.innerHTML = `
        <div class="file-preview-loading">
            <div class="file-preview-spinner"></div>
            <p>Loading preview…</p>
        </div>`;

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('file-preview-open');

    if (shareBtn) {
        shareBtn.style.display = category === 'document' ? 'none' : 'flex';
    }

    const downloadBtn = document.getElementById('file-preview-download');
    if (downloadBtn) {
        downloadBtn.style.display = 'flex';
    }

    await renderFilePreviewContent(bodyEl, category, publicUrl, file);
    if (window.lucide) window.lucide.createIcons();

    // Wrap content for zoom (not for images which have pinch zoom)
    if (category !== 'image' && !bodyEl.querySelector('.preview-zoom-container')) {
        const children = Array.from(bodyEl.children);
        if (children.length > 0) {
            const wrap = document.createElement('div');
            wrap.className = 'preview-zoom-container';
            children.forEach(c => wrap.appendChild(c));
            bodyEl.appendChild(wrap);
        }
    }

    const zoomLevel = document.getElementById('preview-zoom-level');
    if (zoomLevel) zoomLevel.textContent = '100%';
}

function openFilePreview(file) {
    if (!file?.file_path) return;
    const publicUrl = getFilePublicUrl(file.file_path);
    const category = getFilePreviewCategory(file);
    showFilePreviewModal(file, publicUrl, category);
}

function openAppFileViewer(file) {
    openFilePreview(file);
}

async function openFileNative(fileName, url, fileType) {
    if (!url) return;
    const pseudoFile = { file_name: fileName, file_type: fileType, file_path: '' };
    const category = getFilePreviewCategory(pseudoFile);
    await showFilePreviewModal(pseudoFile, url, category);
}

function initFilePreviewModal() {
    const modal = document.getElementById('file-preview-modal');
    if (!modal || modal.dataset.wired) return;
    modal.dataset.wired = '1';

    document.getElementById('file-preview-close')?.addEventListener('click', closeFilePreviewModal);
    document.getElementById('file-preview-backdrop')?.addEventListener('click', closeFilePreviewModal);
    document.getElementById('file-preview-fullscreen-btn')?.addEventListener('click', togglePreviewFullscreen);
    document.getElementById('preview-zoom-in')?.addEventListener('click', zoomInPreview);
    document.getElementById('preview-zoom-out')?.addEventListener('click', zoomOutPreview);

    document.getElementById('file-preview-download')?.addEventListener('click', () => {
        if (!_filePreviewState?.publicUrl) return;
        downloadPreviewFile(_filePreviewState.file.file_name, _filePreviewState.publicUrl);
    });

    document.getElementById('file-preview-share')?.addEventListener('click', () => {
        if (!_filePreviewState?.publicUrl) return;
        shareFile(
            _filePreviewState.file.file_name,
            _filePreviewState.publicUrl,
            _filePreviewState.file.file_type
        );
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeFilePreviewModal();
        }
    });
}

window.shareFile = async function (fileName, url, fileType) {
    if (isCapacitorApp()) {
        await appShareFile(fileName, url);
        return;
    }

    // Try Web Share API with actual file blob
    if (navigator.share) {
        try {
            // Fetch file as blob
            const response = await fetch(url, { mode: 'cors' });
            if (response.ok) {
                const blob = await response.blob();
                const fileObject = new File([blob], fileName || 'file', {
                    type: blob.type || fileType || 'application/octet-stream'
                });

                // Check if Web Share API supports sharing files and attempt file sharing
                const canShareFiles = navigator.canShare ? navigator.canShare({ files: [fileObject] }) : true;
                if (canShareFiles) {
                    await navigator.share({
                        files: [fileObject],
                        title: fileName
                    });
                    return;
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.warn('File blob share failed, falling back to URL share:', err);
        }

        // Fallback: share URL
        try {
            const shareMessage = `Check out this file I shared from GJS File Hub: ${url}`;
            await navigator.share({
                title: fileName,
                text: shareMessage,
                url: url
            });
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Share failed:', err);
            }
        }
        return;
    }

    const shareMessage = `Check out this file I shared from GJS File Hub: ${url}`;

    // Desktop: show share popup
    const existingPopup = document.getElementById('share-popup-overlay');
    if (existingPopup) existingPopup.remove();

    const overlay = document.createElement('div');
    overlay.id = 'share-popup-overlay';
    overlay.className = 'share-overlay';
    overlay.innerHTML = `
        <div class="share-popup">
            <div class="share-popup-header">
                <h3>Share File</h3>
                <button class="share-close-btn" id="share-close-btn">&times;</button>
            </div>
            <p class="share-filename">${fileName}</p>
            <div class="share-options">
                <button class="share-option-btn share-whatsapp" id="share-wa-btn">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    <span>WhatsApp</span>
                </button>
                <button class="share-option-btn share-telegram" id="share-tg-btn">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                    <span>Telegram</span>
                </button>
                <button class="share-option-btn share-email" id="share-email-btn">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                    <span>Email</span>
                </button>
                <button class="share-option-btn share-copy" id="share-copy-btn">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                    <span>Copy Link</span>
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Close popup on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.getElementById('share-close-btn').addEventListener('click', () => overlay.remove());

    document.getElementById('share-wa-btn').addEventListener('click', () => {
        window.open(`https://web.whatsapp.com/send?text=${encodeURIComponent(shareMessage)}`, '_blank');
        overlay.remove();
    });

    document.getElementById('share-tg-btn').addEventListener('click', () => {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent('Check out this file I shared from GJS File Hub:')}`, '_blank');
        overlay.remove();
    });

    document.getElementById('share-email-btn').addEventListener('click', () => {
        window.open(`mailto:?subject=${encodeURIComponent('File shared from GJS File Hub: ' + fileName)}&body=${encodeURIComponent(shareMessage)}`, '_self');
        overlay.remove();
    });

    document.getElementById('share-copy-btn').addEventListener('click', () => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(() => {
                showToast("Link copied to clipboard!");
                overlay.remove();
            });
        } else {
            const textArea = document.createElement("textarea");
            textArea.value = url;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showToast("Link copied to clipboard!");
            overlay.remove();
        }
    });
}

window.showQRCode = function (fileName, url) {
    const overlay = document.getElementById('qr-modal-overlay');
    const qrContainer = document.getElementById('qr-code-container');
    const nameEl = document.getElementById('qr-file-name');
    const downloadBtn = document.getElementById('qr-download-btn');
    const closeBtn = document.getElementById('qr-modal-close');

    if (!overlay || !qrContainer) return;

    // Clear previous QR code
    qrContainer.innerHTML = '';

    // Set file name
    nameEl.textContent = fileName;

    // Generate new QR code using QRCode.js
    new QRCode(qrContainer, {
        text: url,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });

    // Setup download button
    downloadBtn.onclick = function () {
        const img = qrContainer.querySelector('img');
        if (img && img.src) {
            const a = document.createElement('a');
            a.href = img.src;
            a.download = `QR-${fileName}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };

    // Show modal
    overlay.classList.remove('hidden');

    // Handle close events
    const closeModal = () => overlay.classList.add('hidden');

    closeBtn.onclick = closeModal;
    overlay.onclick = function (e) {
        if (e.target === overlay) {
            closeModal();
        }
    };
}

function setupRealtimeSubscription() {
    if (filesChannel) return; // Already subscribed

    filesChannel = supabaseClient
        .channel('public:Files')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'Files',
                filter: `user_id=eq.${currentUser.id}`
            },
            (payload) => {
                console.log('Realtime change received:', payload);
                if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') {
                    fetchFiles();
                    showToast();
                }
            }
        )
        .subscribe((status) => {
            console.log('Realtime status:', status);
        });
}

// Init
checkUser();

// --- File Upload & Gallery Logic ---
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const triggerUploadBtn = document.getElementById('trigger-upload');
const fileListContainer = document.getElementById('file-list');
const emptyStateMsg = document.getElementById('empty-state-msg');
const uploadStatus = document.getElementById('upload-status');
const progressBar = document.getElementById('progress-bar');
const uploadText = document.getElementById('upload-text');

if (IS_DASHBOARD) {
    // Drag and drop events (only add if dropZone exists in layout)
    if (dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
        });

        dropZone.addEventListener('drop', handleDrop, false);

        function handleDrop(e) {
            const dt = e.dataTransfer;
            const files = dt.files;
            openUploadModal(files);
        }
    }

    if (triggerUploadBtn && fileInput) {
        triggerUploadBtn.addEventListener('click', () => fileInput.click());
    }

    if (fileInput) {
        fileInput.addEventListener('change', function () {
            openUploadModal(this.files);
        });
    }
}

function openUploadModal(files) {
    if (!files || files.length === 0) return;
    
    // If inside a folder, bypass folder selection dialog and upload directly
    if (window.currentFolderId) {
        handleFiles(files, window.currentFolderId);
        return;
    }

    const isMobile = localStorage.getItem('deviceType') === 'Mobile' || window.innerWidth <= 768;
    if (isMobile) {
        handleFiles(files, null);
        return;
    }

    window.pendingUploadFiles = files;

    const select = document.getElementById('upload-folder-select');
    if (select) {
        select.innerHTML = '<option value="">No Folder (root)</option>';
        window.folders.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = f.folder_name;
            select.appendChild(opt);
        });

        if (window.currentFolderId) {
            select.value = window.currentFolderId;
        }
    }

    const modal = document.getElementById('upload-folder-modal');
    if (modal) modal.classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('upload-folder-cancel-btn')?.addEventListener('click', () => {
        document.getElementById('upload-folder-modal').classList.add('hidden');
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';
        window.pendingUploadFiles = null;
    });

    document.getElementById('upload-folder-confirm-btn')?.addEventListener('click', () => {
        document.getElementById('upload-folder-modal').classList.add('hidden');
        const folderId = document.getElementById('upload-folder-select').value || null;
        if (window.pendingUploadFiles) {
            handleFiles(window.pendingUploadFiles, folderId);
        }
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';
        window.pendingUploadFiles = null;
    });
});

async function handleFiles(files, folderId = null) {
    if (!files || files.length === 0) return;
    if (!currentUser) {
        alert("You must be logged in to upload files.");
        return;
    }

    uploadStatus.classList.remove('hidden');

    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        const extIndex = file.name.lastIndexOf('.');
        const ext = extIndex !== -1 ? file.name.substring(extIndex) : '';
        const originalBase = extIndex !== -1 ? file.name.substring(0, extIndex) : file.name;

        let customBase = null;
        const isMobile = localStorage.getItem('deviceType') === 'Mobile' || window.innerWidth <= 768;
        if (!isMobile) {
            try {
                customBase = prompt(`Uploading: ${file.name}\n\nEnter a custom name for this file (optional):`, originalBase);
            } catch (promptErr) {
                console.warn("Prompt blocked by mobile browser:", promptErr);
            }
        }

        let finalName = file.name;
        if (customBase !== null && customBase.trim() !== '') {
            let entered = customBase.trim();
            if (ext && !entered.toLowerCase().endsWith(ext.toLowerCase())) {
                entered += ext;
            }
            finalName = entered;
        }

        await uploadFileToSupabase(file, finalName, folderId);
    }

    // Hide progress after short delay
    setTimeout(() => {
        uploadStatus.classList.add('hidden');
        progressBar.style.width = '0%';
    }, 2000);

    fetchFiles(); // Refresh gallery

    // Automatically navigate to View Files section
    const filesNavBtn = document.querySelector('[data-target="page-files"]');
    if (filesNavBtn) {
        filesNavBtn.click();
    }
}

async function uploadFileToSupabase(file, finalName, folderId = null) {
    const displayName = finalName || file.name;
    uploadText.textContent = `Uploading ${displayName}...`;
    progressBar.style.width = '30%'; // Fake initial progress

    // Sanitize filename to prevent upload failures due to special characters/spaces/emojis
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${currentUser.id}/${Date.now()}_${sanitizedName}`;

    try {
        const { data, error } = await supabaseClient.storage
            .from('upload system')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type || 'application/octet-stream'
            });

        if (error) throw error;

        // Save metadata to database with user's optional custom name
        // Check directly in the database to prevent duplicate inserts on stale state
        // Check for an existing (non-deleted) file with the same name in the same folder.
        // Use .or() to match rows where is_deleted is NULL OR explicitly false,
        // preventing duplicate inserts caused by NULL is_deleted values in the DB.
        let checkQuery = supabaseClient
            .from('Files')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('file_name', displayName)
            .or('is_deleted.is.null,is_deleted.eq.false');

        if (folderId === null) {
            checkQuery = checkQuery.is('folder_id', null);
        } else {
            checkQuery = checkQuery.eq('folder_id', folderId);
        }

        const { data: dbFiles, error: checkError } = await checkQuery;
        if (checkError) throw checkError;

        const existingFile = dbFiles && dbFiles.length > 0 ? dbFiles[0] : null;

        if (existingFile) {
            const versionKey = ('version_number' in existingFile) ? 'version_number' : 'version';
            const currentVer = existingFile[versionKey] || 1;

            // 1. Save old version to file_versions table
            const { error: verErr } = await supabaseClient
                .from('file_versions')
                .insert([{
                    file_id: existingFile.id,
                    user_id: existingFile.user_id,
                    version_number: currentVer,
                    file_path: existingFile.file_path,
                    file_size: existingFile.file_size
                }]);

            if (verErr) throw verErr;

            // 2. Prune old versions (keep max 10 total: current + 9 history)
            await pruneFileVersions(existingFile.id);

            // 3. Update files table with new version and incremented version count
            const updateObj = {
                file_size: file.size,
                file_type: file.type || 'application/octet-stream',
                file_path: filePath,
                created_at: new Date()
            };
            updateObj[versionKey] = currentVer + 1;

            const { error: dbUpdateErr } = await supabaseClient
                .from('Files')
                .update(updateObj)
                .eq('id', existingFile.id);

            if (dbUpdateErr) throw dbUpdateErr;

        } else {
            // Symmetrical insert for brand new file, starting at Version 1
            // Fetch a sample from database to inspect the scheme ('version_number' or 'version')
            const { data: samples, error: sampleErr } = await supabaseClient
                .from('Files')
                .select('*')
                .limit(1);

            const sample = samples && samples.length > 0 ? samples[0] : null;
            const insertObj = {
                user_id: currentUser.id,
                file_name: displayName,
                file_size: file.size,
                file_type: file.type || 'application/octet-stream',
                file_path: filePath,
                folder_id: folderId
            };
            
            if (sample) {
                if ('version_number' in sample) {
                    insertObj.version_number = 1;
                } else if ('version' in sample) {
                    insertObj.version = 1;
                }
            } else {
                // If there's no sample, use version_number = 1 (do not use version)
                insertObj.version_number = 1;
            }

            const { error: dbError } = await supabaseClient
                .from('Files')
                .insert([insertObj]);

            if (dbError) throw dbError;
        }

        // Finished
        progressBar.style.width = '100%';
        uploadText.textContent = 'Upload complete!';

    } catch (err) {
        console.error("Error uploading:", err);
        alert(`Failed to upload ${file.name}: ${err.message}`);
        uploadText.textContent = 'Upload failed.';
    }
}

async function fetchFiles() {
    if (!currentUser) return;

    try {
        const { data: folderData, error: folderErr } = await supabaseClient
            .from('folders')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false });

        if (folderErr && folderErr.code !== '42P01') console.error("Error fetching folders:", folderErr);
        window.folders = folderData || [];
        localStorage.setItem('cached_folders', JSON.stringify(window.folders));

        const { data, error } = await supabaseClient
            .from('Files')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        window.allFiles = data || [];
        localStorage.setItem('cached_files', JSON.stringify(window.allFiles));
        if (!window.hasPurged) {
            window.hasPurged = true;
            purgeExpiredTrash();
        }
        calculateProfileStats();

        const totalCountEl = document.getElementById('total-file-count');
        if (totalCountEl) totalCountEl.textContent = `${window.allFiles.length} files`;

        if (window.renderFolders) window.renderFolders();
        renderRecentFiles();
        renderAllFiles();
        renderMobileActivities();
        renderRecentPage();
        renderDesktopActivities(); // Render the new premium PC recent activities grid!

        if (typeof renderMobileRecentFolders === 'function') renderMobileRecentFolders();
        if (typeof renderMobileViewFolders === 'function') renderMobileViewFolders();
        renderUploadPageFolders();
    } catch (err) {
        console.error("Error fetching files:", err);
    }
}

// ── Upload/Home section: render recent folders at top ──
function renderUploadPageFolders() {
    const mList = document.getElementById('m-home-folders-list');
    const dList = document.getElementById('d-home-folders-list');
    if (!mList && !dList) return;

    // Root-level folders only (parent_id is null), newest first, max 3
    const rootFolders = [...window.folders]
        .filter(f => !f.parent_id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 3);

    function folderItemHtml(f) {
        const fileCount = window.allFiles.filter(file => file.folder_id === f.id && !file.is_deleted).length;
        return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(255,255,255,0.75);border-radius:14px;cursor:pointer;border:1px solid rgba(234,179,8,0.18);transition:transform 0.15s;" onclick="window.enterFolder('${f.id}')" onmouseenter="this.style.transform='translateY(-1px)'" onmouseleave="this.style.transform='translateY(0)'">
            <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
                <div style="width:36px;height:36px;background:rgba(234,179,8,0.12);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#eab308;flex-shrink:0;">
                    <i data-lucide="folder" style="width:18px;height:18px;"></i>
                </div>
                <div style="min-width:0;flex:1;">
                    <div style="font-size:13px;font-weight:700;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:'Poppins',sans-serif;">${f.folder_name}</div>
                    <div style="font-size:11px;color:#64748b;font-weight:500;font-family:'Poppins',sans-serif;">${fileCount} files</div>
                </div>
            </div>
            <i data-lucide="chevron-right" style="width:16px;height:16px;color:#94a3b8;flex-shrink:0;"></i>
        </div>`;
    }

    if (mList) {
        mList.innerHTML = rootFolders.length
            ? rootFolders.map(folderItemHtml).join('')
            : '<p class="m-empty-text">No folders yet</p>';
        if (window.lucide) window.lucide.createIcons();
    }
    if (dList) {
        dList.innerHTML = rootFolders.length
            ? rootFolders.map(folderItemHtml).join('')
            : '<p style="text-align:center;color:#94a3b8;font-size:12px;font-weight:500;padding:8px 0;font-family:\'Poppins\',sans-serif;">No folders yet</p>';
        if (window.lucide) window.lucide.createIcons();
    }
}

function calculateProfileStats() {
    let totalBytes = 0;
    const countedPaths = new Set();
    window.allFiles.forEach(f => {
        if (f.is_deleted) return;
        const key = f.file_path || f.id;
        if (countedPaths.has(key)) return;
        countedPaths.add(key);
        totalBytes += (f.file_size || 0);
    });

    let totalStorageStr = "0 MB";
    if (totalBytes > 0) {
        totalStorageStr = (totalBytes / (1024 * 1024)).toFixed(2) + " MB";
    }

    const homeStorageDisplay = document.getElementById('total-storage-display');
    if (homeStorageDisplay) homeStorageDisplay.textContent = totalStorageStr;

    const profileFiles = document.getElementById('profile-total-files');
    const profileStorage = document.getElementById('profile-total-storage');
    const profileMemberSince = document.getElementById('profile-member-since');

    if (profileFiles) profileFiles.textContent = window.allFiles.length;
    if (profileStorage) profileStorage.textContent = totalStorageStr;
    if (profileMemberSince && currentUser.created_at) {
        const date = new Date(currentUser.created_at);
        profileMemberSince.textContent = date.toLocaleDateString();
    }

    // Update new Settings tab Storage Progress Bar
    const settingsPct = document.getElementById('profile-storage-pct-text');
    const settingsBar = document.getElementById('profile-storage-bar-fill');
    const settingsDetail = document.getElementById('profile-storage-detail-text');

    const MAX_BYTES = 100 * 1024 * 1024;
    const pct = Math.min(100, Math.round((totalBytes / MAX_BYTES) * 100));
    const usedMB = (totalBytes / (1024 * 1024)).toFixed(2);

    if (settingsPct) settingsPct.textContent = `${pct}%`;
    if (settingsBar) settingsBar.style.width = `${pct}%`;
    if (settingsDetail) settingsDetail.textContent = `${usedMB} MB of 100 MB used`;

    // Update Desktop Home Storage Gauge
    const desktopPct = document.getElementById('desktop-storage-pct');
    const desktopDetail = document.getElementById('desktop-storage-text');
    const desktopGaugePath = document.getElementById('desktop-gauge-path');

    if (desktopPct) desktopPct.textContent = `${pct}%`;
    if (desktopDetail) desktopDetail.textContent = `${usedMB} MB of 100 MB used`;
    if (desktopGaugePath) {
        const arcLen = 144.5;
        const filled = (pct / 100) * arcLen;
        desktopGaugePath.setAttribute('stroke-dasharray', `${filled.toFixed(1)} ${arcLen}`);
    }

    // ── Mobile storage gauge ──
    updateStorageGauge(totalBytes);
}

// ── Mobile: SVG semicircle gauge ──
function updateStorageGauge(usedBytes) {
    const MAX_BYTES = 100 * 1024 * 1024; // 100 MB cap for display
    const usedMB = (usedBytes / (1024 * 1024)).toFixed(1);
    const pct = Math.min(100, Math.round((usedBytes / MAX_BYTES) * 100));
    // Arc total length for path "M14,68 A46,46 0 0,1 106,68" ≈ 144.5
    const arcLen = 144.5;
    const filled = (pct / 100) * arcLen;

    const gaugePath = document.getElementById('m-gauge-path');
    const gaugePct = document.getElementById('m-storage-pct');
    const storageText = document.getElementById('m-storage-text');

    if (gaugePath) gaugePath.setAttribute('stroke-dasharray', `${filled.toFixed(1)} ${arcLen}`);
    if (gaugePct) gaugePct.textContent = `${pct}%`;
    if (storageText) storageText.textContent = `${usedMB} MB of 100 MB used`;
}

// ── Mobile: render recent activities ──
function renderMobileActivities() {
    const container = document.getElementById('m-activity-list');
    if (!container) return;

    const recent = window.allFiles.filter(f => !f.is_deleted).slice(0, 5);
    if (!recent.length) {
        container.innerHTML = '<p class="m-empty-text">No recent activity</p>';
        return;
    }

    const iconMap = {
        image: { bg: 'linear-gradient(135deg,#e3f2fd,#bbdefb)', color: '#1976d2', icon: 'image' },
        video: { bg: 'linear-gradient(135deg,#fce4ec,#f8bbd0)', color: '#e91e63', icon: 'video' },
        pdf: { bg: 'linear-gradient(135deg,#fff3e0,#ffe0b2)', color: '#e65100', icon: 'file-text' },
        document: { bg: 'linear-gradient(135deg,#e8f5e9,#c8e6c9)', color: '#388e3c', icon: 'file-text' },
        default: { bg: 'linear-gradient(135deg,#f3e5f5,#e1bee7)', color: '#7b1fa2', icon: 'file' },
    };

    function getStyle(file) {
        const t = file.file_type || '';
        if (t.startsWith('image/')) return iconMap.image;
        if (t.startsWith('video/')) return iconMap.video;
        if (t.includes('pdf')) return iconMap.pdf;
        if (t.includes('document') || t.includes('text')) return iconMap.document;
        return iconMap.default;
    }

    function timeAgo(dateStr) {
        const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    }

    container.innerHTML = recent.map(f => {
        const s = getStyle(f);
        return `
        <div class="m-activity-item">
            <div class="m-activity-icon" style="background:${s.bg}">
                <i data-lucide="${s.icon}" style="width:20px;height:20px;color:${s.color};"></i>
            </div>
            <div class="m-activity-info">
                <div class="m-activity-name" title="${f.file_name}">${f.file_name}</div>
                <div class="m-activity-action">uploaded</div>
            </div>
            <div class="m-activity-time">${timeAgo(f.created_at)}</div>
        </div>`;
    }).join('');

    // Re-render lucide icons inside the new HTML
    if (window.lucide) window.lucide.createIcons();
}

// ── Desktop: Render dynamic premium recent activities list ──
function renderDesktopActivities() {
    const container = document.getElementById('desktop-activity-list');
    if (!container) return;

    const recent = window.allFiles.filter(f => !f.is_deleted).slice(0, 5); // Show top 5
    if (!recent.length) {
        container.innerHTML = '<p class="empty-state-text" style="text-align: center; color: #94a3b8; padding: 20px 0; font-size: 13px;">No recent uploads</p>';
        return;
    }

    const iconMap = {
        image: { bg: 'rgba(77, 182, 172, 0.1)', color: '#4DB6AC', icon: 'image' },
        video: { bg: 'rgba(38, 198, 218, 0.1)', color: '#26C6DA', icon: 'video' },
        pdf: { bg: 'rgba(239, 112, 67, 0.1)', color: '#ff7043', icon: 'file-text' },
        document: { bg: 'rgba(76, 175, 80, 0.1)', color: '#4caf50', icon: 'file-text' },
        default: { bg: 'rgba(156, 39, 176, 0.1)', color: '#9c27b0', icon: 'file' },
    };

    function getStyle(file) {
        const t = (file.file_type || '').toLowerCase();
        const name = (file.file_name || '').toLowerCase();
        if (t.startsWith('image/')) return iconMap.image;
        if (t.startsWith('video/')) return iconMap.video;
        if (name.endsWith('.pdf')) return iconMap.pdf;
        if (t.includes('document') || t.includes('text') || name.endsWith('.docx') || name.endsWith('.txt')) return iconMap.document;
        return iconMap.default;
    }

    function timeAgo(dateStr) {
        const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
        if (diff < 60) return '3 mins ago'; // Match mock styles
        if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
        return `${Math.floor(diff / 86400)} days ago`;
    }

    container.innerHTML = recent.map(f => {
        const s = getStyle(f);
        // Random badge matching the mock
        const statuses = ['modified', 'uploaded', 'shared', 'uploaded', 'modified'];
        const idx = (new Date(f.created_at).getTime() % 5);
        const statusText = statuses[idx] || 'uploaded';
        const badgeClass = statusText === 'modified' ? 'badge-modified' : (statusText === 'shared' ? 'badge-shared' : 'badge-uploaded');

        return `
        <div class="activity-row" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1.5px solid rgba(0,0,0,0.02);">
            <div class="activity-file-info" style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
                <div class="activity-icon-wrapper" style="width: 32px; height: 32px; border-radius: 8px; background:${s.bg}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i data-lucide="${s.icon}" style="width:16px;height:16px;color:${s.color};"></i>
                </div>
                <div class="activity-file-name-stack" style="display: flex; flex-direction: column; min-width: 0;">
                    <span class="activity-file-name" style="font-size: 13px; font-weight: 700; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${f.file_name}">${f.file_name}</span>
                    <span class="activity-file-time" style="font-size: 11px; color: #94a3b8; font-weight: 500; margin-top: 2px;">${timeAgo(f.created_at)}</span>
                </div>
            </div>
            <span class="status-badge ${badgeClass}" style="font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; text-transform: capitalize; margin-left: 12px;">${statusText}</span>
        </div>`;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
}

// ── Mobile: render page-recent (last 7 days) ──
function renderRecentPage() {
    const container = document.getElementById('recent-file-list-full');
    if (!container) return;

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentFiles = window.allFiles
        .filter(f => !f.is_deleted && new Date(f.created_at).getTime() >= sevenDaysAgo)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    renderFileSet(recentFiles, container, false);
}

// ── Mobile: wire quick-action buttons ──
function setupMobileActions() {
    // Upload New File button
    const mUploadBtn = document.getElementById('m-upload-trigger');
    const fileInput = document.getElementById('file-input');
    if (mUploadBtn && fileInput) {
        mUploadBtn.addEventListener('click', () => fileInput.click());
    }

    // New Folder is handled dynamically by setupMobileFolders()

    // Quick action nav buttons (data-target) already handled by setupSPA
    // Mobile progress bar sync with desktop upload
    syncMobileUploadProgress();

    // Auto-hide mobile navigation
    setupMobileNavAutohide();
}

let mobileNavTimeout = null;

function showMobileNavTemporarily() {
    const bottomNav = document.querySelector('.mobile-bottom-nav');
    if (!bottomNav) return;

    // Make it visible
    bottomNav.classList.remove('nav-hidden');

    // Reset timer
    if (mobileNavTimeout) {
        clearTimeout(mobileNavTimeout);
    }

    // Set 5-second automatic hide delay
    mobileNavTimeout = setTimeout(() => {
        // Do not hide if any form input is currently focused
        const activeEl = document.activeElement;
        const isFocusingInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
        if (!isFocusingInput) {
            bottomNav.classList.add('nav-hidden');
        }
    }, 5000);
}

function setupMobileNavAutohide() {
    const bottomNav = document.querySelector('.mobile-bottom-nav');
    if (!bottomNav) return;

    // Initial state: hide after 3 seconds on page entry
    mobileNavTimeout = setTimeout(() => {
        bottomNav.classList.add('nav-hidden');
    }, 3000);

    // Global touch/click triggers show
    document.addEventListener('touchstart', showMobileNavTemporarily, { passive: true });
    document.addEventListener('click', showMobileNavTemporarily, { passive: true });

    // Stop event propagation inside the nav bar so clicking buttons resets timer but doesn't instantly close
    bottomNav.addEventListener('click', (e) => {
        e.stopPropagation();
        showMobileNavTemporarily();
    });
    bottomNav.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        showMobileNavTemporarily();
    }, { passive: true });
}

// Keep mobile progress bar in sync with the shared upload state
function syncMobileUploadProgress() {
    const desktopBar = document.getElementById('progress-bar');
    const desktopText = document.getElementById('upload-text');
    const mProgress = document.getElementById('m-upload-progress');
    const mBar = document.getElementById('m-progress-bar');
    const mText = document.querySelector('#m-upload-progress span');

    if (!desktopBar || !mProgress) return;

    const observer = new MutationObserver(() => {
        const w = desktopBar.style.width;
        if (mBar) mBar.style.width = w;
        if (mText && desktopText) mText.textContent = desktopText.textContent;
        if (w && w !== '0%') {
            mProgress.classList.remove('hidden');
        } else {
            mProgress.classList.add('hidden');
        }
    });
    observer.observe(desktopBar, { attributes: true, attributeFilter: ['style'] });
}

function renderRecentFiles() {
    const recentContainer = document.getElementById('recent-file-list');
    if (!recentContainer) return;
    const recentFiles = window.allFiles.filter(f => !f.is_deleted).slice(0, 5);
    renderFileSet(recentFiles, recentContainer, false);
}

window.renderAllFiles = function () {
    const filesContainer = document.getElementById('file-list');
    if (!filesContainer) return;

    let filtered = window.allFiles.filter(f => !f.is_deleted);

    // Folder filter: inside a folder → that folder's files only.
    // App root "View Files" → root-level files only (folders live under View Folders).
    // Web root → all files (legacy behaviour).
    if (window.currentFolderId) {
        filtered = filtered.filter(f => f.folder_id === window.currentFolderId);
    } else if (isCapacitorApp()) {
        filtered = filtered.filter(f => !f.folder_id);
    }

    window.currentFilteredFiles = filtered;

    // Filter
    if (window.currentFilter && window.currentFilter !== 'all') {
        filtered = filtered.filter(f => {
            const type = f.file_type || '';
            if (window.currentFilter === 'image') return type.startsWith('image/');
            if (window.currentFilter === 'video') return type.startsWith('video/');
            if (window.currentFilter === 'document') return type.includes('pdf') || type.includes('document') || type.includes('text');
            if (window.currentFilter === 'other') return !type.startsWith('image/') && !type.startsWith('video/') && !type.includes('pdf') && !type.includes('document') && !type.includes('text');
            return true;
        });
    }

    // Search
    if (window.searchQuery) {
        filtered = filtered.filter(f => f.file_name && f.file_name.toLowerCase().includes(window.searchQuery));
    }

    // Sort
    if (window.currentSort === 'newest') filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    else if (window.currentSort === 'oldest') filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (window.currentSort === 'name') filtered.sort((a, b) => (a.file_name || '').localeCompare(b.file_name || ''));
    else if (window.currentSort === 'size') filtered.sort((a, b) => (b.file_size || 0) - (a.file_size || 0));

    renderFileSet(filtered, filesContainer, window.selectModeActive);
};

function renderFileSet(files, container, showCheckboxes) {
    if (!container) return;
    container.innerHTML = ''; // Clear container before rendering new set of files!

    if (!files || files.length === 0) {
        if (window.currentFolderId) {
            container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 24px; text-align: center; font-family: 'Poppins', sans-serif;">
                <div style="width: 64px; height: 64px; background: rgba(77, 182, 172, 0.1); border-radius: 50%; color: #4DB6AC; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; box-shadow: 0 4px 12px rgba(77, 182, 172, 0.1);">
                    <i data-lucide="upload-cloud" style="width: 32px; height: 32px;"></i>
                </div>
                <h4 style="font-size: 16px; font-weight: 700; color: var(--text-main); margin: 0 0 6px 0;">Upload files</h4>
                <p style="font-size: 12px; color: var(--text-muted); margin: 0; font-weight: 500;">Add new files or import existing ones to this folder.</p>
            </div>`;
            if (window.lucide) window.lucide.createIcons();
        } else {
            container.innerHTML = '<p class="empty-state" id="empty-state-msg" style="display: block;">No files yet.</p>';
        }
        return;
    }

    files.forEach(file => {
        const card = document.createElement('div');
        card.className = 'file-card glass-panel';

        const sizeMb = (file.file_size / (1024 * 1024)).toFixed(2);

        const { data: publicUrlData } = supabaseClient.storage
            .from('upload system')
            .getPublicUrl(file.file_path);

        const publicUrl = publicUrlData.publicUrl;
        const uploadDate = new Date(file.created_at).toLocaleDateString();

        // Determine beautiful pastel styling color-schemes based on file category
        const getStyle = (f) => {
            const t = (f.file_type || '').toLowerCase();
            const name = (f.file_name || '').toLowerCase();
            if (t.startsWith('image/')) {
                return { bg: 'transparent', color: '#26a69a', icon: 'image', label: 'Images' };
            }
            if (t.startsWith('video/')) {
                return { bg: 'linear-gradient(135deg,#fce4ec,#f8bbd0)', color: '#c2185b', icon: 'video', label: 'Videos' };
            }
            if (name.endsWith('.pdf')) {
                return { bg: 'linear-gradient(135deg,#ffebee,#ffcdd2)', color: '#d32f2f', icon: 'file-text', label: 'PDF' };
            }
            if (t.includes('document') || t.includes('text') || name.endsWith('.docx') || name.endsWith('.doc') || name.endsWith('.txt')) {
                return { bg: 'linear-gradient(135deg,#ffe0b2,#ffb74d)', color: '#f57c00', icon: 'file-text', label: 'Docs' };
            }
            return { bg: 'linear-gradient(135deg,#f3e5f5,#e1bee7)', color: '#7b1fa2', icon: 'file', label: 'Others' };
        };
        const s = getStyle(file);

        // Time ago calculator for mobile view
        const diff = (Date.now() - new Date(file.created_at).getTime()) / 1000;
        let timeAgoStr = 'just now';
        if (diff >= 86400) timeAgoStr = `${Math.floor(diff / 86400)}d ago`;
        else if (diff >= 3600) timeAgoStr = `${Math.floor(diff / 3600)}h ago`;
        else if (diff >= 60) timeAgoStr = `${Math.floor(diff / 60)}m ago`;

        let mPreviewInner = '';
        if (file.file_type?.startsWith('image/')) {
            mPreviewInner = `<img src="${publicUrl}" alt="preview" style="width:100%; height:100%; object-fit:cover;">`;
        } else {
            mPreviewInner = `<i data-lucide="${s.icon}" style="width:22px; height:22px; color:${s.color};"></i>`;
        }

        let previewHtml = '';
        if (file.file_type?.startsWith('image/')) {
            previewHtml = `<div class="file-preview image-preview"><img src="${publicUrl}" alt="preview"></div>`;
        } else {
            let iconName = 'file-text';
            if (file.file_type?.startsWith('video/')) iconName = 'video';
            else if (file.file_name.endsWith('.pdf')) iconName = 'file-text';
            else if (file.file_name.endsWith('.zip')) iconName = 'package';
            previewHtml = `<div class="file-preview icon-preview"><i data-lucide="${iconName}"></i></div>`;
        }

        let checkboxHtml = '';
        if (showCheckboxes) {
            const checked = window.selectedFiles.has(file.id) ? 'checked' : '';
            checkboxHtml = `<input type="checkbox" class="file-checkbox" data-id="${file.id}" data-path="${file.file_path}" ${checked}>`;
        }

        card.innerHTML = `
            <!-- Desktop Layout -->
            <div class="desktop-only" style="display: flex; align-items: center; width: 100%; gap: 15px; position: relative;">
                ${checkboxHtml}
                ${previewHtml}
                <div class="file-details">
                    <div class="file-name" title="${file.file_name}">${file.file_name}</div>
                    <div class="file-info">
                        <span>${sizeMb} MB</span> &bull; <span>${file.file_type || 'Unknown'}</span>
                    </div>
                    <div class="file-date">Uploaded: ${uploadDate}</div>
                </div>
                <div class="file-actions">
                    <a href="${publicUrl}" target="_blank" class="icon-btn btn-download" title="View"><i data-lucide="download"></i></a>
                    <button onclick="renameFilePrompt('${file.id}', '${file.file_name.replace(/'/g, "\\'")}')" class="icon-btn" title="Rename" style="color: #d97706;"><i data-lucide="edit-3"></i></button>
                    <button onclick="showQRCode('${file.file_name.replace(/'/g, "\\'")}', '${publicUrl}')" class="icon-btn" title="QR Code" style="color: #a855f7;"><i data-lucide="qr-code"></i></button>
                    <button onclick="shareFile('${file.file_name.replace(/'/g, "\\'")}', '${publicUrl}')" class="icon-btn btn-share" title="Share"><i data-lucide="share-2"></i></button>
                    <button onclick="openVersionHistoryModal('${file.id}')" class="icon-btn btn-history" title="Version History" style="color: #0284c7;"><i data-lucide="history"></i></button>
                    <button onclick="deleteFile('${file.id}', '${file.file_path}')" class="icon-btn btn-delete" title="Delete"><i data-lucide="trash-2"></i></button>
                </div>
            </div>

            <!-- Mobile Layout matching the exact uploaded design in user request (Compact Layout) -->
            <div class="mobile-only" style="display: flex; align-items: center; width: 100%; gap: 10px;">
                ${checkboxHtml}
                
                <!-- Symmetrical compact rounded preview container -->
                <div class="m-file-preview-wrapper" style="width: 42px; height: 42px; border-radius: 10px; overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: ${s.bg}; border: 1px solid rgba(255,255,255,0.5);">
                    ${mPreviewInner}
                </div>
                
                <!-- Centered file detail stack (Slimmed down spacing and size) -->
                <div class="m-file-details" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px;">
                    <div class="m-file-name" style="font-size: 12px; font-weight: 700; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: 'Poppins', sans-serif;" title="${file.file_name}">${file.file_name}</div>
                    <div class="m-file-meta-row" style="font-size: 9.5px; font-weight: 500; color: #64748b; font-family: 'Poppins', sans-serif; display: flex; align-items: center; gap: 4px;">
                        <span style="font-weight: 700; color: #475569;">${s.label}</span>
                        <span>&bull;</span>
                        <span>${sizeMb} MB</span>
                        <span>&bull;</span>
                        <span>${timeAgoStr}</span>
                    </div>
                    <div style="display: flex; gap: 4px; margin-top: 1px;">
                        <span style="font-size: 8px; font-weight: 700; color: #4DB6AC; background: #e0f2f1; padding: 1px 5px; border-radius: 20px; font-family: 'Poppins', sans-serif; letter-spacing: 0.2px; text-transform: uppercase;">Active</span>
                    </div>
                </div>
                
                <!-- Vertical three dots action button -->
                <button class="m-file-menu-trigger" onclick="openMobileFileDrawer(event, '${file.id}', '${file.file_name.replace(/'/g, "\\'")}', '${publicUrl}', '${file.file_path}')" style="width: 32px; height: 32px; border-radius: 50%; border: none; background: transparent; display: flex; align-items: center; justify-content: center; color: #64748b; cursor: pointer; flex-shrink: 0;">
                    <i data-lucide="more-vertical" style="width: 18px; height: 18px;"></i>
                </button>
            </div>
        `;

        if (showCheckboxes) {
            const cb = card.querySelector('.file-checkbox');
            cb.addEventListener('change', (e) => {
                if (e.target.checked) window.selectedFiles.add(file.id);
                else window.selectedFiles.delete(file.id);
                toggleBulkActionBar();
            });
        }

        card.addEventListener('click', (e) => {
            if (window.selectModeActive) {
                const cb = card.querySelector('.file-checkbox');
                if (cb && e.target !== cb) {
                    cb.checked = !cb.checked;
                    cb.dispatchEvent(new Event('change'));
                }
                return;
            }

            if (e.target.closest('button, a, input, .file-actions, .m-file-menu-trigger, .file-checkbox')) {
                return;
            }

            openFilePreview(file);
        });

        // Long press on file card (Android app only)
        if (window.Capacitor !== undefined) {
            let lpTimer = null;
            card.addEventListener('touchstart', () => {
                lpTimer = setTimeout(() => {
                    lpTimer = null;
                    window._lpCurrentFile = file;
                    const modal = document.getElementById('app-longpress-modal');
                    const nameEl = document.getElementById('lp-file-name');
                    if (nameEl) nameEl.textContent = file.file_name;
                    if (modal) { modal.style.display = 'flex'; modal.classList.remove('hidden'); }
                    if (window.lucide) window.lucide.createIcons();
                }, 500);
            }, { passive: true });
            card.addEventListener('touchmove', () => {
                if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
            }, { passive: true });
            card.addEventListener('touchend', () => {
                if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
            });
            card.addEventListener('touchcancel', () => {
                if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
            });
        }

        container.appendChild(card);
    });

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// State-of-the-art iOS/Android Native-style Glass Action Drawer for Mobile file interactions
window.openMobileFileDrawer = function (e, fileId, fileName, publicUrl, filePath) {
    e.stopPropagation(); // Stop navigation click

    // Remove any existing drawers first
    const existing = document.getElementById('m-file-drawer');
    if (existing) existing.remove();

    const drawer = document.createElement('div');
    drawer.id = 'm-file-drawer';
    drawer.style.cssText = `
        position: fixed;
        bottom: 0;
        left: 0;
        width: 100%;
        height: 100dvh;
        background: rgba(15, 23, 42, 0.4);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        z-index: 1000;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
    `;

    const content = document.createElement('div');
    content.className = 'glass-panel';
    content.style.cssText = `
        background: rgba(255, 255, 255, 0.98);
        border-radius: 30px 30px 0 0;
        border: 1px solid rgba(255, 255, 255, 0.9);
        border-bottom: none;
        padding: 24px 20px;
        box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.15);
        transform: translateY(100%);
        transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        flex-direction: column;
        gap: 16px;
    `;

    content.innerHTML = `
        <!-- Drag Handle Indicator -->
        <div style="width: 40px; height: 5px; background: #cbd5e1; border-radius: 10px; margin: 0 auto 8px;"></div>
        
        <!-- File Header Info -->
        <div style="display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px;">
            <div style="font-size: 15px; font-weight: 800; color: #1e293b; word-break: break-all; font-family: 'Poppins', sans-serif;">
                ${fileName}
            </div>
        </div>
        
        <!-- Actions List -->
        <div style="display: flex; flex-direction: column; gap: 8px;">
            <button type="button" onclick="downloadFile('${publicUrl}', '${fileName.replace(/'/g, "\\'")}'); closeMobileFileDrawer();" style="width: 100%; text-align: left; display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 16px; background: #f8fafc; border: 1px solid #f1f5f9; color: #1e293b; font-size: 14px; font-weight: 700; font-family: 'Poppins', sans-serif; cursor: pointer;">
                <span style="width: 32px; height: 32px; border-radius: 50%; background: #e0f2f1; display: flex; align-items: center; justify-content: center; color: #4DB6AC;">
                    <i data-lucide="download" style="width: 16px; height: 16px;"></i>
                </span>
                Download File
            </button>

            <button onclick="showQRCode('${fileName.replace(/'/g, "\\'")}', '${publicUrl}'); closeMobileFileDrawer();" style="width: 100%; text-align: left; display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 16px; background: #f8fafc; border: 1px solid #f1f5f9; color: #1e293b; font-size: 14px; font-weight: 700; font-family: 'Poppins', sans-serif; cursor: pointer;">
                <span style="width: 32px; height: 32px; border-radius: 50%; background: #f3e8ff; display: flex; align-items: center; justify-content: center; color: #a855f7;">
                    <i data-lucide="qr-code" style="width: 16px; height: 16px;"></i>
                </span>
                Generate QR Code
            </button>
            
            <button onclick="shareFile('${fileName.replace(/'/g, "\\'")}', '${publicUrl}', ''); closeMobileFileDrawer();" style="width: 100%; text-align: left; display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 16px; background: #f8fafc; border: 1px solid #f1f5f9; color: #1e293b; font-size: 14px; font-weight: 700; font-family: 'Poppins', sans-serif; cursor: pointer;">
                <span style="width: 32px; height: 32px; border-radius: 50%; background: #e0f2fe; display: flex; align-items: center; justify-content: center; color: #0ea5e9;">
                    <i data-lucide="share-2" style="width: 16px; height: 16px;"></i>
                </span>
                Share Access Link
            </button>

            <button onclick="renameFilePrompt('${fileId}', '${fileName.replace(/'/g, "\\'")}'); closeMobileFileDrawer();" style="width: 100%; text-align: left; display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 16px; background: #f8fafc; border: 1px solid #f1f5f9; color: #1e293b; font-size: 14px; font-weight: 700; font-family: 'Poppins', sans-serif; cursor: pointer;">
                <span style="width: 32px; height: 32px; border-radius: 50%; background: #fef3c7; display: flex; align-items: center; justify-content: center; color: #d97706;">
                    <i data-lucide="edit-3" style="width: 16px; height: 16px;"></i>
                </span>
                Rename File
            </button>

            <button onclick="openVersionHistoryModal('${fileId}'); closeMobileFileDrawer();" style="width: 100%; text-align: left; display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 16px; background: #f8fafc; border: 1px solid #f1f5f9; color: #1e293b; font-size: 14px; font-weight: 700; font-family: 'Poppins', sans-serif; cursor: pointer;">
                <span style="width: 32px; height: 32px; border-radius: 50%; background: #e0f2fe; display: flex; align-items: center; justify-content: center; color: #0284c7;">
                    <i data-lucide="history" style="width: 16px; height: 16px;"></i>
                </span>
                Version History
            </button>
            
            <button onclick="deleteFile('${fileId}', '${filePath}'); closeMobileFileDrawer();" style="width: 100%; text-align: left; display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 16px; background: #fff1f2; border: 1px solid #ffe4e6; color: #f43f5e; font-size: 14px; font-weight: 700; font-family: 'Poppins', sans-serif; cursor: pointer;">
                <span style="width: 32px; height: 32px; border-radius: 50%; background: #ffe4e6; display: flex; align-items: center; justify-content: center; color: #f43f5e;">
                    <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                </span>
                Delete File
            </button>
        </div>
        
        <!-- Cancel Row -->
        <button onclick="closeMobileFileDrawer()" style="width: 100%; border: none; background: #f1f5f9; padding: 14px; border-radius: 16px; font-family: 'Poppins', sans-serif; font-weight: 700; font-size: 14px; color: #64748b; cursor: pointer; text-align: center; margin-top: 8px;">
            Cancel
        </button>
    `;

    drawer.appendChild(content);
    document.body.appendChild(drawer);

    // Animate slide up
    requestAnimationFrame(() => {
        content.style.transform = 'translateY(0)';
    });

    // Close handle
    drawer.addEventListener('click', (ev) => {
        if (ev.target === drawer) closeMobileFileDrawer();
    });

    if (window.lucide) window.lucide.createIcons();
};

window.closeMobileFileDrawer = function () {
    const drawer = document.getElementById('m-file-drawer');
    if (!drawer) return;

    const content = drawer.querySelector('div');
    if (content) {
        content.style.transform = 'translateY(100%)';
    }

    setTimeout(() => drawer.remove(), 300);
};

function toggleBulkActionBar() {
    const actionBar = document.getElementById('bulk-action-bar');
    const selectedCount = document.getElementById('selected-count');
    if (!actionBar || !selectedCount) return;

    if (window.selectedFiles.size > 0) {
        selectedCount.textContent = `${window.selectedFiles.size} selected`;
        actionBar.classList.remove('hidden');
    } else {
        actionBar.classList.add('hidden');
    }
}

window.bulkDeleteFiles = async function () {
    if (window.selectedFiles.size === 0) return;
    if (!confirm(`Delete ${window.selectedFiles.size} files? Cannot be undone`)) return;

    const idsToDelete = Array.from(window.selectedFiles);

    try {
        const filesToDelete = window.allFiles.filter(f => idsToDelete.includes(f.id));
        const remainingFiles = window.allFiles.filter(f => !idsToDelete.includes(f.id));
        const remainingPaths = new Set(remainingFiles.map(f => f.file_path));

        const pathsToStorageRemove = Array.from(new Set(
            filesToDelete
                .map(f => f.file_path)
                .filter(path => !remainingPaths.has(path))
        ));

        if (pathsToStorageRemove.length > 0) {
            const { error: storageError } = await supabaseClient.storage
                .from('upload system')
                .remove(pathsToStorageRemove);
            if (storageError) throw storageError;
        }

        if (idsToDelete.length > 0) {
            const { error: dbError } = await supabaseClient
                .from('Files')
                .delete()
                .in('id', idsToDelete);
            if (dbError) throw dbError;
        }

        window.selectedFiles.clear();
        if (window.selectModeActive && typeof window.toggleSelectMode === 'function') {
            window.toggleSelectMode();
        } else {
            toggleBulkActionBar();
            fetchFiles();
        }
        showToast(`${idsToDelete.length} files deleted successfully`);
    } catch (err) {
        console.error("Error bulk deleting:", err);
        alert("Failed to delete selected files.");
    }
};

window.openNewFolderModal = function () {
    window.folderActionType = 'create';
    window.editingFolderId = null;
    const isSub = !!window.currentFolderId;
    document.getElementById('folder-modal-title').textContent = isSub ? 'New Sub Folder' : 'New Folder';
    document.getElementById('folder-name-input').value = '';
    document.getElementById('folder-modal').classList.remove('hidden');
    document.getElementById('folder-name-input').focus();
};

window.openRenameFolderModal = function (id, currentName) {
    window.folderActionType = 'rename';
    window.editingFolderId = id;
    document.getElementById('folder-modal-title').textContent = 'Rename Folder';
    document.getElementById('folder-name-input').value = currentName;
    document.getElementById('folder-modal').classList.remove('hidden');
    document.getElementById('folder-name-input').focus();
};

window.openDeleteFolderModal = function (id) {
    window.deletingFolderId = id;
    document.getElementById('folder-delete-modal').classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
    // New/Rename Modal
    document.getElementById('folder-cancel-btn')?.addEventListener('click', () => {
        document.getElementById('folder-modal').classList.add('hidden');
    });

    document.getElementById('subfolder-create-btn')?.addEventListener('click', () => {
        window.openNewFolderModal();
    });

    document.getElementById('folder-save-btn')?.addEventListener('click', async () => {
        const name = document.getElementById('folder-name-input').value.trim();
        if (!name) return;

        const btn = document.getElementById('folder-save-btn');
        btn.textContent = 'Saving...';
        btn.disabled = true;

        try {
            if (window.folderActionType === 'create') {
                const parentId = window.currentFolderId || null;
                const { error } = await supabaseClient
                    .from('folders')
                    .insert([{ 
                        user_id: currentUser.id, 
                        folder_name: name,
                        parent_id: parentId
                    }]);
                if (error) throw error;

                const isMobile = localStorage.getItem('deviceType') === 'Mobile' || window.innerWidth <= 768;
                if (isMobile) {
                    const successOverlay = document.getElementById('m-success-overlay');
                    if (successOverlay) {
                        successOverlay.classList.remove('hidden');
                        setTimeout(() => {
                            successOverlay.classList.add('hidden');
                        }, 2000);
                    }
                } else {
                    showToast(parentId ? "Sub folder created successfully!" : "Folder created successfully!");
                }
            } else if (window.folderActionType === 'rename') {
                const { error } = await supabaseClient
                    .from('folders')
                    .update({ folder_name: name })
                    .eq('id', window.editingFolderId);
                if (error) throw error;
                showToast("Folder renamed successfully!");
            }

            document.getElementById('folder-modal').classList.add('hidden');
            fetchFiles(); // Refresh
        } catch (err) {
            console.error("Folder error:", err);
            alert("Failed to save folder.");
        } finally {
            btn.textContent = window.folderActionType === 'create' ? 'Create' : 'Save';
            btn.disabled = false;
        }
    });

    // Delete Modal
    document.getElementById('folder-del-cancel-btn')?.addEventListener('click', () => {
        document.getElementById('folder-delete-modal').classList.add('hidden');
    });

    document.getElementById('folder-del-confirm-btn')?.addEventListener('click', async () => {
        const id = window.deletingFolderId;
        if (!id) return;

        const btn = document.getElementById('folder-del-confirm-btn');
        btn.textContent = 'Deleting...';
        btn.disabled = true;

        try {
            // First set folder_id to null for files inside
            const { error: filesErr } = await supabaseClient
                .from('Files')
                .update({ folder_id: null })
                .eq('folder_id', id);

            if (filesErr) throw filesErr;

            // Re-parent sub-folders to root
            const { error: subfoldersErr } = await supabaseClient
                .from('folders')
                .update({ parent_id: null })
                .eq('parent_id', id);

            if (subfoldersErr) throw subfoldersErr;

            // Delete folder
            const { error: folderErr } = await supabaseClient
                .from('folders')
                .delete()
                .eq('id', id);

            if (folderErr) throw folderErr;

            showToast("Folder deleted successfully!");
            document.getElementById('folder-delete-modal').classList.add('hidden');

            if (window.currentFolderId === id) {
                window.currentFolderId = null; // Exit folder if currently in it
            }
            fetchFiles(); // Refresh
        } catch (err) {
            console.error("Error deleting folder:", err);
            alert("Failed to delete folder.");
        } finally {
            btn.textContent = 'Yes Delete';
            btn.disabled = false;
        }
    });

    // Back to root button
    document.getElementById('back-to-root-btn')?.addEventListener('click', () => {
        window.goToFolder(null);
    });
});

function renderBreadcrumbs() {
    const breadcrumbsContainer = document.getElementById('folder-breadcrumbs');
    if (!breadcrumbsContainer) return;

    const path = [];
    let currentId = window.currentFolderId;

    while (currentId) {
        const folder = window.folders.find(f => f.id === currentId);
        if (folder) {
            path.unshift(folder);
            currentId = folder.parent_id;
        } else {
            break;
        }
    }

    let breadcrumbHtml = `<span class="breadcrumb-item" onclick="goToFolder(null)" style="color: #4DB6AC; cursor: pointer; transition: color 0.2s;">Home</span>`;

    path.forEach((folder, idx) => {
        breadcrumbHtml += `
            <span style="color: var(--text-muted); margin: 0 4px;">&gt;</span>
            <span class="breadcrumb-item" onclick="goToFolder('${folder.id}')" style="${idx === path.length - 1 ? 'color: var(--text-main); font-weight: 700;' : 'color: #4DB6AC; cursor: pointer;'} transition: color 0.2s;">${folder.folder_name}</span>
        `;
    });

    breadcrumbsContainer.innerHTML = breadcrumbHtml;
}

window.goToFolder = function (folderId) {
    window.currentFolderId = folderId === 'null' || folderId === null ? null : folderId;
    renderAllFiles();
    renderFolders();
    if (window.lucide) window.lucide.createIcons();
};

window.renderFolders = function () {
    const foldersGrid = document.getElementById('folders-grid');
    const foldersDivider = document.getElementById('folders-divider');
    const subfolderCreateBtn = document.getElementById('subfolder-create-btn');
    const folderUploadTrigger = document.getElementById('d-folder-upload-trigger');

    if (!foldersGrid) return;

    renderBreadcrumbs();

    // In the native app, folders are managed on View Folders — not inside View Files.
    if (isCapacitorApp()) {
        foldersGrid.innerHTML = '';
        foldersGrid.style.display = 'none';
        if (foldersDivider) foldersDivider.style.display = 'none';
        if (window.currentFolderId) {
            subfolderCreateBtn?.classList.remove('hidden');
            folderUploadTrigger?.classList.remove('hidden');
        } else {
            subfolderCreateBtn?.classList.add('hidden');
            folderUploadTrigger?.classList.add('hidden');
        }
        return;
    }

    if (window.currentFolderId) {
        subfolderCreateBtn?.classList.remove('hidden');
        folderUploadTrigger?.classList.remove('hidden');
    } else {
        subfolderCreateBtn?.classList.add('hidden');
        folderUploadTrigger?.classList.add('hidden');
    }

    const currentFolders = window.folders.filter(f => 
        window.currentFolderId ? f.parent_id === window.currentFolderId : !f.parent_id
    );

    if (currentFolders.length === 0) {
        foldersGrid.innerHTML = '';
        foldersGrid.style.display = 'none';
        if (foldersDivider) foldersDivider.style.display = 'none';
        return;
    }

    foldersGrid.style.display = 'grid';
    if (foldersDivider) foldersDivider.style.display = 'block';
    foldersGrid.innerHTML = '';

    currentFolders.forEach(folder => {
        const fileCount = window.allFiles.filter(f => f.folder_id === folder.id && !f.is_deleted).length;

        const card = document.createElement('div');
        card.className = 'glass-panel';
        card.style.cssText = 'padding: 16px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: transform 0.2s;';
        card.onmouseenter = () => card.style.transform = 'translateY(-2px)';
        card.onmouseleave = () => card.style.transform = 'translateY(0)';
        card.onclick = (e) => {
            if (e.target.closest('.icon-btn')) return;
            window.currentFolderId = folder.id;
            renderAllFiles();
            renderFolders();
            if (window.lucide) window.lucide.createIcons();
        };

        card.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px; overflow: hidden; width: 100%;">
                <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(250, 204, 21, 0.15); display: flex; align-items: center; justify-content: center; color: #eab308; flex-shrink: 0;">
                    <i data-lucide="folder"></i>
                </div>
                <div style="overflow: hidden; flex: 1;">
                    <div style="font-weight: 700; color: var(--text-main); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: 'Poppins', sans-serif;">${folder.folder_name}</div>
                    <div style="font-size: 11px; color: var(--text-muted); font-weight: 500;">${fileCount} files</div>
                </div>
            </div>
            <div style="display: flex; gap: 4px; flex-shrink: 0;">
                <button onclick="openRenameFolderModal('${folder.id}', '${folder.folder_name.replace(/'/g, "\\'")}')" class="icon-btn" title="Rename" style="color: #d97706; padding: 6px;"><i data-lucide="edit-3" style="width: 15px; height: 15px;"></i></button>
                <button onclick="openDeleteFolderModal('${folder.id}')" class="icon-btn" title="Delete" style="color: #ef4444; padding: 6px;"><i data-lucide="trash-2" style="width: 15px; height: 15px;"></i></button>
            </div>
        `;

        foldersGrid.appendChild(card);
    });
};

window.deleteFile = async function (fileId, filePath) {
    if (window.undoTimeoutId) {
        clearTimeout(window.undoTimeoutId);
        window.undoTimeoutId = null;
        window.undoFileId = null;
    }

    try {
        const { error } = await supabaseClient
            .from('Files')
            .update({
                is_deleted: true,
                deleted_at: new Date().toISOString()
            })
            .eq('id', fileId);

        if (error) throw error;

        window.selectedFiles.delete(fileId);
        if (typeof toggleBulkActionBar === 'function') toggleBulkActionBar();

        await fetchFiles();
        showUndoToast(fileId, "File moved to Trash");
    } catch (err) {
        console.error("Error soft deleting file:", err);
        alert("Failed to delete file.");
    }
};

window.renameFilePrompt = async function (fileId, currentName) {
    const extIndex = currentName.lastIndexOf('.');
    const ext = extIndex !== -1 ? currentName.substring(extIndex) : '';
    const currentBase = extIndex !== -1 ? currentName.substring(0, extIndex) : currentName;

    let customBase = prompt(`Rename File:\n\nEnter a new name for this file:`, currentBase);
    if (customBase === null) return; // User cancelled

    let newName = customBase.trim();
    if (newName === '') {
        showToast("File name cannot be empty!", true);
        return;
    }

    // Auto-preserve original extension if user did not specify it
    if (ext && !newName.toLowerCase().endsWith(ext.toLowerCase())) {
        newName += ext;
    }

    if (newName === currentName) return; // Name is identical, no update needed

    try {
        const { error } = await supabaseClient
            .from('Files')
            .update({ file_name: newName })
            .eq('id', fileId);

        if (error) throw error;

        showToast("File renamed successfully!");
        fetchFiles(); // Refresh both desktop and mobile file views instantly
    } catch (err) {
        console.error("Error renaming file:", err);
        alert(`Failed to rename file: ${err.message}`);
    }
};

// ═══ MOBILE ONLY FOLDER MANAGEMENT LOGIC ═══
window.setupMobileFolders = function () {
    const mNewFolderBtn = document.getElementById('m-new-folder-btn');
    const mFoldersBackBtn = document.getElementById('m-folders-back-btn');
    const sections = document.querySelectorAll('.page-section');

    if (mNewFolderBtn) {
        mNewFolderBtn.addEventListener('click', () => {
            // Update profile greeting on mobile folders header
            const firstName = (currentUser.user_metadata?.full_name || currentUser.email || 'User').split(' ')[0];
            const greetingEl = document.getElementById('m-folders-greeting');
            if (greetingEl) greetingEl.textContent = `Welcome, ${firstName}!`;

            // Switch to page-m-folders
            sections.forEach(sec => {
                if (sec.id === 'page-m-folders') {
                    sec.classList.remove('hidden-section');
                    sec.classList.add('active-page');
                } else {
                    sec.classList.remove('active-page');
                    sec.classList.add('hidden-section');
                }
            });
            window.renderMobileRecentFolders();
            window.renderMobileViewFolders();
        });
    }

    if (mFoldersBackBtn) {
        mFoldersBackBtn.addEventListener('click', () => {
            // Back to page-upload
            sections.forEach(sec => {
                if (sec.id === 'page-upload') {
                    sec.classList.remove('hidden-section');
                    sec.classList.add('active-page');
                } else {
                    sec.classList.remove('active-page');
                    sec.classList.add('hidden-section');
                }
            });
        });
    }

    // Tabs Switch
    const tabCreate = document.getElementById('m-tab-create');
    const tabView = document.getElementById('m-tab-view');
    const viewCreate = document.getElementById('m-create-folder-view');
    const viewFolders = document.getElementById('m-view-folders-view');

    if (tabCreate && tabView) {
        tabCreate.addEventListener('click', () => {
            tabCreate.classList.add('active');
            tabCreate.style.background = '#4DB6AC';
            tabCreate.style.color = 'white';

            tabView.classList.remove('active');
            tabView.style.background = 'transparent';
            tabView.style.color = '#64748b';

            viewCreate.classList.remove('hidden');
            viewFolders.classList.add('hidden');
        });

        tabView.addEventListener('click', () => {
            tabView.classList.add('active');
            tabView.style.background = '#4DB6AC';
            tabView.style.color = 'white';

            tabCreate.classList.remove('active');
            tabCreate.style.background = 'transparent';
            tabCreate.style.color = '#64748b';

            viewFolders.classList.remove('hidden');
            viewCreate.classList.add('hidden');
            window.renderMobileViewFolders();
        });

        // initialize active tab style
        tabCreate.style.background = '#4DB6AC';
        tabCreate.style.color = 'white';
    }

    const createTrigger = document.getElementById('m-create-folder-trigger');
    if (createTrigger) {
        createTrigger.addEventListener('click', () => {
            if (typeof window.openNewFolderModal === 'function') {
                window.openNewFolderModal();
            }
        });
    }

    // Search input event
    const searchInput = document.getElementById('m-folder-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            window.renderMobileViewFolders();
        });
    }
};

window.renderMobileRecentFolders = function () {
    const recentList = document.getElementById('m-recent-folders-list');
    if (!recentList) return;

    // Sort folders by created_at desc
    const sorted = [...window.folders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const recent3 = sorted.slice(0, 3);

    if (recent3.length === 0) {
        recentList.innerHTML = '<p class="empty-state-text" style="text-align: center; color: #64748b; font-size: 13px;">No recent folders</p>';
        return;
    }

    recentList.innerHTML = recent3.map(f => {
        const fileCount = window.allFiles.filter(file => file.folder_id === f.id).length;
        return `
        <div class="m-recent-folder-item glass-panel" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: rgba(255,255,255,0.7); border-radius: 16px;" onclick="window.enterFolder('${f.id}')">
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 40px; height: 40px; background: rgba(77, 182, 172, 0.1); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #4DB6AC;">
                    <i data-lucide="folder" style="width: 20px; height: 20px;"></i>
                </div>
                <div>
                    <h4 style="font-size: 14px; font-weight: 700; color: #1e293b; margin: 0; font-family: 'Poppins', sans-serif;">${f.folder_name}</h4>
                    <p style="font-size: 11px; color: #64748b; margin: 0; font-weight: 500; font-family: 'Poppins', sans-serif;">${fileCount} files</p>
                </div>
            </div>
            <div style="background: rgba(16, 185, 129, 0.1); color: #10B981; padding: 4px 8px; border-radius: 8px; font-size: 10px; font-weight: 700;">Ready</div>
        </div>
        `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
};

window.renderMobileViewFolders = function () {
    const grid = document.getElementById('m-all-folders-grid');
    if (!grid) return;

    const searchInput = document.getElementById('m-folder-search-input');
    const query = searchInput ? searchInput.value.toLowerCase() : '';

    const filtered = window.folders.filter(f => f.folder_name.toLowerCase().includes(query));

    if (filtered.length === 0) {
        grid.innerHTML = '<p class="empty-state-text" style="text-align: center; color: #64748b; font-size: 13px;">No folders found</p>';
        return;
    }

    grid.innerHTML = filtered.map(f => {
        const fileCount = window.allFiles.filter(file => file.folder_id === f.id).length;
        return `
        <div class="m-recent-folder-item glass-panel" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: rgba(255,255,255,0.7); border-radius: 16px;" onclick="window.enterFolder('${f.id}')">
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 40px; height: 40px; background: rgba(77, 182, 172, 0.1); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #4DB6AC;">
                    <i data-lucide="folder" style="width: 20px; height: 20px;"></i>
                </div>
                <div>
                    <h4 style="font-size: 14px; font-weight: 700; color: #1e293b; margin: 0; font-family: 'Poppins', sans-serif;">${f.folder_name}</h4>
                    <p style="font-size: 11px; color: #64748b; margin: 0; font-weight: 500; font-family: 'Poppins', sans-serif;">${fileCount} files</p>
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button onclick="event.stopPropagation(); window.openRenameFolderModal('${f.id}', '${f.folder_name.replace(/'/g, "\\'")}')" style="background: transparent; border: none; color: #64748b; padding: 8px; cursor: pointer;"><i data-lucide="edit-2" style="width: 16px; height: 16px;"></i></button>
                <button onclick="event.stopPropagation(); window.openDeleteFolderModal('${f.id}')" style="background: transparent; border: none; color: #ef4444; padding: 8px; cursor: pointer;"><i data-lucide="trash-2" style="width: 16px; height: 16px;"></i></button>
            </div>
        </div>
        `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
};

window.enterFolder = function (id) {
    window.currentFolderId = id;

    // Switch to page-files section
    const sections = document.querySelectorAll('.page-section');
    sections.forEach(sec => {
        if (sec.id === 'page-files') {
            sec.classList.remove('hidden-section');
            sec.classList.add('active-page');
        } else {
            sec.classList.remove('active-page');
            sec.classList.add('hidden-section');
        }
    });

    // Update active nav item
    document.querySelectorAll('.nav-btn, .nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`[data-target="page-files"]`).forEach(b => b.classList.add('active'));

    renderAllFiles();
    if (!isCapacitorApp() && window.renderFolders) window.renderFolders();
    if (window.lucide) window.lucide.createIcons();
};

// ═══ MOBILE FILES IMPORT SELECTOR LOGIC ═══
window.selectedImportIds = new Set();

window.openMobileImportModal = function() {
    const listContainer = document.getElementById('m-import-files-list');
    const importModal = document.getElementById('m-import-files-modal');
    if (!listContainer || !importModal) return;

    window.selectedImportIds.clear();
    const countSpan = document.getElementById('m-import-count');
    if (countSpan) countSpan.textContent = '0';

    // Files not already in this folder (move, not duplicate)
    const importable = window.allFiles.filter(f =>
        !f.is_deleted && String(f.folder_id || '') !== String(window.currentFolderId || '')
    );

    if (importable.length === 0) {
        listContainer.innerHTML = '<p style="text-align: center; color: #64748b; font-size: 13px; padding: 20px 0; font-family: \'Poppins\', sans-serif;">No existing files available to import.</p>';
    } else {
        listContainer.innerHTML = importable.map(f => {
            const sizeMb = (f.file_size / (1024 * 1024)).toFixed(2);
            return `
            <div class="m-import-file-item glass-panel" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(255,255,255,0.7); border-radius: 12px; cursor: pointer; transition: all 0.2s; border: 1px solid transparent;" onclick="window.toggleImportFile('${f.id}')" id="import-item-${f.id}">
                <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; width: 80%;">
                    <div style="width: 32px; height: 32px; background: rgba(59,130,246,0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #3b82f6; flex-shrink: 0;">
                        <i data-lucide="file" style="width: 16px; height: 16px;"></i>
                    </div>
                    <div style="overflow: hidden;">
                        <h4 style="font-size: 13px; font-weight: 700; color: #1e293b; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: 'Poppins', sans-serif;">${f.file_name}</h4>
                        <p style="font-size: 10px; color: #64748b; margin: 0; font-family: 'Poppins', sans-serif;">${sizeMb} MB</p>
                    </div>
                </div>
                <div class="import-checkbox" style="width: 20px; height: 20px; border: 2px solid #cbd5e1; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; flex-shrink: 0;">
                    <i data-lucide="check" style="width: 12px; height: 12px; color: white; display: none;"></i>
                </div>
            </div>
            `;
        }).join('');
        
        if (window.lucide) window.lucide.createIcons();
    }

    importModal.classList.remove('hidden');
};

window.toggleImportFile = function(id) {
    const item = document.getElementById(`import-item-${id}`);
    if (!item) return;

    const checkbox = item.querySelector('.import-checkbox');
    const checkIcon = checkbox.querySelector('[data-lucide="check"]');

    if (window.selectedImportIds.has(id)) {
        window.selectedImportIds.delete(id);
        item.style.borderColor = 'transparent';
        item.style.background = 'rgba(255,255,255,0.7)';
        checkbox.style.background = 'transparent';
        checkbox.style.borderColor = '#cbd5e1';
        if (checkIcon) checkIcon.style.display = 'none';
    } else {
        window.selectedImportIds.add(id);
        item.style.borderColor = '#4DB6AC';
        item.style.background = 'rgba(77,182,172,0.05)';
        checkbox.style.background = '#4DB6AC';
        checkbox.style.borderColor = '#4DB6AC';
        if (checkIcon) checkIcon.style.display = 'block';
    }

    const countSpan = document.getElementById('m-import-count');
    if (countSpan) countSpan.textContent = window.selectedImportIds.size;
};

/* --- TRASH BIN & MULTI SELECTION BUSINESS LOGIC HELPERS --- */
window.toggleSelectMode = function () {
    window.selectModeActive = !window.selectModeActive;
    
    const desktopSelectBtn = document.getElementById('desktop-select-btn');
    const mobileSelectBtn = document.getElementById('mobile-select-btn');
    const selectAllControls = document.getElementById('selection-header-controls');
    
    if (window.selectModeActive) {
        desktopSelectBtn?.classList.add('active');
        desktopSelectBtn?.setAttribute('style', 'padding: 6px 14px; border-radius: 10px; font-size: 12px; font-weight: 600; cursor: pointer; background: #4DB6AC !important; border: 1px solid #4DB6AC; color: white; display: flex; align-items: center; gap: 6px; transition: all 0.2s;');
        mobileSelectBtn?.classList.add('active');
        if (mobileSelectBtn) mobileSelectBtn.style.color = '#ef4444';
        
        selectAllControls?.classList.remove('hidden');
    } else {
        desktopSelectBtn?.classList.remove('active');
        desktopSelectBtn?.setAttribute('style', 'padding: 6px 14px; border-radius: 10px; font-size: 12px; font-weight: 600; cursor: pointer; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.4); color: var(--text-main); display: flex; align-items: center; gap: 6px; transition: all 0.2s;');
        mobileSelectBtn?.classList.remove('active');
        if (mobileSelectBtn) mobileSelectBtn.style.color = '#4DB6AC';
        
        selectAllControls?.classList.add('hidden');
        window.selectedFiles.clear();
    }
    
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    
    toggleBulkActionBar();
    renderAllFiles();
};

window.showUndoToast = function (fileId, message) {
    const realtimeToast = document.getElementById('realtime-toast');
    if (realtimeToast) {
        if (window.undoTimeoutId) {
            clearTimeout(window.undoTimeoutId);
            window.undoTimeoutId = null;
            window.undoFileId = null;
        }

        window.undoFileId = fileId;

        const msgSpan = realtimeToast.querySelector('.toast-msg');
        if (msgSpan) {
            msgSpan.innerHTML = `
                ${message}
                <button class="toast-undo-btn" id="toast-undo-btn">Undo</button>
            `;
        }

        realtimeToast.classList.remove('hidden');

        const undoBtn = document.getElementById('toast-undo-btn');
        if (undoBtn) {
            undoBtn.addEventListener('click', async () => {
                if (window.undoFileId === fileId) {
                    try {
                        const { error } = await supabaseClient
                            .from('Files')
                            .update({
                                is_deleted: false,
                                deleted_at: null
                            })
                            .eq('id', fileId);

                        if (error) throw error;

                        showToast("File restored!");
                        await fetchFiles();
                    } catch (err) {
                        console.error("Error restoring file:", err);
                    }
                }
            });
        }

        window.undoTimeoutId = setTimeout(() => {
            realtimeToast.classList.add('hidden');
            if (msgSpan) msgSpan.textContent = "File list updated";
            window.undoTimeoutId = null;
            window.undoFileId = null;
        }, 5000);
    }
};

window.renderTrashFiles = async function () {
    const trashContainer = document.getElementById('trash-file-list');
    if (!trashContainer) return;

    try {
        const { data: deletedFiles, error } = await supabaseClient
            .from('Files')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('is_deleted', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!deletedFiles || !deletedFiles.length) {
            trashContainer.innerHTML = '<p class="empty-state" id="trash-empty-state-msg" style="display: block;">Your Trash Bin is empty.</p>';
            return;
        }

        trashContainer.innerHTML = '';

        deletedFiles.forEach(file => {
        const card = document.createElement('div');
        card.className = 'file-card glass-panel';

        const sizeMb = (file.file_size / (1024 * 1024)).toFixed(2);
        
        const deletedAtDate = file.deleted_at ? new Date(file.deleted_at) : new Date(file.created_at);
        const daysAgo = Math.max(0, Math.floor((Date.now() - deletedAtDate.getTime()) / (24 * 60 * 60 * 1000)));
        const daysLabel = daysAgo === 0 ? 'Deleted today' : `Deleted ${daysAgo} day${daysAgo > 1 ? 's' : ''} ago`;

        const { data: publicUrlData } = supabaseClient.storage
            .from('upload system')
            .getPublicUrl(file.file_path);

        const publicUrl = publicUrlData.publicUrl;

        const getStyle = (f) => {
            const t = (f.file_type || '').toLowerCase();
            const name = (f.file_name || '').toLowerCase();
            if (t.startsWith('image/')) return { bg: 'transparent', color: '#26a69a', icon: 'image', label: 'Images' };
            if (t.startsWith('video/')) return { bg: 'linear-gradient(135deg,#fce4ec,#f8bbd0)', color: '#c2185b', icon: 'video', label: 'Videos' };
            if (name.endsWith('.pdf')) return { bg: 'linear-gradient(135deg,#ffebee,#ffcdd2)', color: '#d32f2f', icon: 'file-text', label: 'PDF' };
            if (t.includes('document') || t.includes('text') || name.endsWith('.docx') || name.endsWith('.doc') || name.endsWith('.txt')) {
                return { bg: 'linear-gradient(135deg,#ffe0b2,#ffb74d)', color: '#f57c00', icon: 'file-text', label: 'Docs' };
            }
            return { bg: 'linear-gradient(135deg,#f3e5f5,#e1bee7)', color: '#7b1fa2', icon: 'file', label: 'Others' };
        };
        const s = getStyle(file);

        let mPreviewInner = '';
        if (file.file_type?.startsWith('image/')) {
            mPreviewInner = `<img src="${publicUrl}" alt="preview" style="width:100%; height:100%; object-fit:cover;">`;
        } else {
            mPreviewInner = `<i data-lucide="${s.icon}" style="width:22px; height:22px; color:${s.color};"></i>`;
        }

        let previewHtml = '';
        if (file.file_type?.startsWith('image/')) {
            previewHtml = `<div class="file-preview image-preview"><img src="${publicUrl}" alt="preview"></div>`;
        } else {
            let iconName = 'file-text';
            if (file.file_type?.startsWith('video/')) iconName = 'video';
            else if (file.file_name.endsWith('.pdf')) iconName = 'file-text';
            else if (file.file_name.endsWith('.zip')) iconName = 'package';
            previewHtml = `<div class="file-preview icon-preview"><i data-lucide="${iconName}"></i></div>`;
        }

        card.innerHTML = `
            <!-- Desktop Layout -->
            <div class="desktop-only" style="display: flex; align-items: center; width: 100%; gap: 15px; position: relative;">
                ${previewHtml}
                <div class="file-details">
                    <div class="file-name" title="${file.file_name}">${file.file_name}</div>
                    <div class="file-info">
                        <span>${sizeMb} MB</span> &bull; <span style="font-weight: 700; color: #ef4444;">${daysLabel}</span>
                    </div>
                </div>
                <div class="file-actions" style="display: flex; gap: 10px;">
                    <button onclick="restoreFile('${file.id}')" class="icon-btn btn-restore" title="Restore" style="width: auto; height: 38px; padding: 0 16px; border-radius: 10px; display: flex; align-items: center; gap: 6px; font-family: 'Poppins', sans-serif; font-size: 12px; font-weight: 700;"><i data-lucide="rotate-ccw" style="width: 15px; height: 15px;"></i> Restore</button>
                    <button onclick="permanentlyDeleteFile('${file.id}', '${file.file_path.replace(/'/g, "\\'")}')" class="icon-btn btn-perm-delete" title="Permanently Delete" style="width: auto; height: 38px; padding: 0 16px; border-radius: 10px; display: flex; align-items: center; gap: 6px; font-family: 'Poppins', sans-serif; font-size: 12px; font-weight: 700;"><i data-lucide="trash-2" style="width: 15px; height: 15px;"></i> Delete Forever</button>
                </div>
            </div>

            <!-- Mobile Layout -->
            <div class="mobile-only" style="display: flex; align-items: center; width: 100%; gap: 10px;">
                <div class="m-file-preview-wrapper" style="width: 42px; height: 42px; border-radius: 10px; overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: ${s.bg}; border: 1px solid rgba(255,255,255,0.5);">
                    ${mPreviewInner}
                </div>
                <div class="m-file-details" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px;">
                    <div class="m-file-name" style="font-size: 12px; font-weight: 700; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: 'Poppins', sans-serif;" title="${file.file_name}">${file.file_name}</div>
                    <div class="m-file-meta-row" style="font-size: 9.5px; font-weight: 500; color: #ef4444; font-family: 'Poppins', sans-serif; display: flex; align-items: center; gap: 4px;">
                        <span>${daysLabel}</span>
                        <span>&bull;</span>
                        <span>${sizeMb} MB</span>
                    </div>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button onclick="restoreFile('${file.id}')" style="width: 32px; height: 32px; border-radius: 50%; border: none; background: rgba(16, 185, 129, 0.1); color: #10b981; display: flex; align-items: center; justify-content: center; cursor: pointer;"><i data-lucide="rotate-ccw" style="width: 16px; height: 16px;"></i></button>
                    <button onclick="permanentlyDeleteFile('${file.id}', '${file.file_path.replace(/'/g, "\\'")}')" style="width: 32px; height: 32px; border-radius: 50%; border: none; background: rgba(239, 68, 68, 0.1); color: #ef4444; display: flex; align-items: center; justify-content: center; cursor: pointer;"><i data-lucide="trash-2" style="width: 16px; height: 16px;"></i></button>
                </div>
            </div>
        `;
        trashContainer.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        console.error("Error rendering trash files:", err);
        trashContainer.innerHTML = '<p class="empty-state" id="trash-empty-state-msg" style="display: block; color: #ef4444;">Failed to load trash bin items.</p>';
    }
};

window.restoreFile = async function (fileId) {
    try {
        const { error } = await supabaseClient
            .from('Files')
            .update({
                is_deleted: false,
                deleted_at: null
            })
            .eq('id', fileId);

        if (error) throw error;

        showToast("File restored!");
        await fetchFiles();
        renderTrashFiles();
    } catch (err) {
        console.error("Error restoring file:", err);
        alert("Failed to restore file.");
    }
};

window.permanentlyDeleteFile = async function (fileId, filePath) {
    if (!confirm("Are you sure you want to permanently delete this file? This cannot be undone.")) return;

    try {
        const remaining = window.allFiles.filter(f => f.file_path === filePath && f.id !== fileId);

        if (remaining.length === 0) {
            const { error: storageError } = await supabaseClient.storage
                .from('upload system')
                .remove([filePath]);
            if (storageError) throw storageError;
        }

        const { error: dbError } = await supabaseClient
            .from('Files')
            .delete()
            .eq('id', fileId);

        if (dbError) throw dbError;

        showToast("File permanently deleted");
        await fetchFiles();
        renderTrashFiles();
    } catch (err) {
        console.error("Error permanently deleting file:", err);
        alert("Failed to permanently delete file.");
    }
};

window.emptyTrash = async function () {
    try {
        const { data: deletedFiles, error: fetchErr } = await supabaseClient
            .from('Files')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('is_deleted', true);

        if (fetchErr) throw fetchErr;

        if (!deletedFiles || deletedFiles.length === 0) {
            alert("Your Trash Bin is already empty.");
            return;
        }

        if (!confirm("Are you sure you want to permanently empty the Trash Bin? All items will be lost forever.")) return;

        const idsToDelete = deletedFiles.map(f => f.id);

        const { data: activeFiles, error: activeErr } = await supabaseClient
            .from('Files')
            .select('file_path')
            .eq('user_id', currentUser.id)
            .eq('is_deleted', false);

        if (activeErr) throw activeErr;

        const activePaths = new Set(activeFiles.map(f => f.file_path));

        const pathsToStorageRemove = Array.from(new Set(
            deletedFiles
                .map(f => f.file_path)
                .filter(path => !activePaths.has(path))
        ));

        if (pathsToStorageRemove.length > 0) {
            const { error: storageError } = await supabaseClient.storage
                .from('upload system')
                .remove(pathsToStorageRemove);
            if (storageError) throw storageError;
        }

        const { error: dbError } = await supabaseClient
            .from('Files')
            .delete()
            .in('id', idsToDelete);

        if (dbError) throw dbError;

        showToast("Trash Bin cleared successfully!");
        await fetchFiles();
        renderTrashFiles();
    } catch (err) {
        console.error("Error clearing trash:", err);
        alert("Failed to empty Trash Bin.");
    }
};

async function purgeExpiredTrash() {
    if (!currentUser) return;

    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: expiredFiles, error: fetchErr } = await supabaseClient
            .from('Files')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('is_deleted', true)
            .lt('deleted_at', thirtyDaysAgo);

        if (fetchErr) throw fetchErr;

        if (!expiredFiles || expiredFiles.length === 0) return;

        console.log(`Auto-purging ${expiredFiles.length} expired trash files...`);

        const idsToDelete = expiredFiles.map(f => f.id);

        const { data: activeFiles, error: activeErr } = await supabaseClient
            .from('Files')
            .select('file_path')
            .eq('user_id', currentUser.id)
            .eq('is_deleted', false);

        if (activeErr) throw activeErr;

        const activePaths = new Set(activeFiles.map(f => f.file_path));

        const pathsToStorageRemove = Array.from(new Set(
            expiredFiles
                .map(f => f.file_path)
                .filter(path => !activePaths.has(path))
        ));

        if (pathsToStorageRemove.length > 0) {
            await supabaseClient.storage
                .from('upload system')
                .remove(pathsToStorageRemove);
        }

        await supabaseClient
            .from('Files')
            .delete()
            .in('id', idsToDelete);

        await fetchFiles();
    } catch (err) {
        console.error("Error auto-purging expired files:", err);
    }
}

// ==========================================
// OFFLINE ACCESS & PWA INTEGRATION CODE
// ==========================================

function toggleOfflineUI(isOffline) {
    const banner = document.getElementById('offline-banner');
    if (banner) {
        if (isOffline) {
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
    }

    // Hide/Show upload and folder creation action buttons offline
    const uploadTriggers = [
        document.getElementById('d-upload-trigger'),
        document.getElementById('d-folder-upload-trigger'),
        document.getElementById('m-upload-fab'),
        document.getElementById('d-new-folder-btn'),
        document.getElementById('subfolder-create-btn'),
        document.getElementById('trigger-upload-btn')
    ];

    uploadTriggers.forEach(btn => {
        if (btn) {
            if (isOffline) {
                btn.style.setProperty('display', 'none', 'important');
            } else {
                btn.style.removeProperty('display');
            }
        }
    });
}

function loadCachedFiles() {
    console.log("Loading cached files and folders offline...");
    const localF = localStorage.getItem('cached_files');
    const localD = localStorage.getItem('cached_folders');
    if (localF) window.allFiles = JSON.parse(localF);
    if (localD) window.folders = JSON.parse(localD);
    
    // Render offline UI grids
    renderAllFiles();
    renderFolders();
}

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered successfully:', reg.scope))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

// Network state listeners
window.addEventListener('online', () => {
    toggleOfflineUI(false);
    showToast("Back online!");
    fetchFiles(); // Automatically refresh list on network recovery
});

window.addEventListener('offline', () => {
    toggleOfflineUI(true);
    loadCachedFiles();
});

// Run initial online/offline check on load
document.addEventListener('DOMContentLoaded', () => {
    const isOffline = !navigator.onLine;
    toggleOfflineUI(isOffline);
    if (isOffline) {
        loadCachedFiles();
    }
});


// ==========================================
// FILE VERSION HISTORY FEATURES
// ==========================================

async function pruneFileVersions(fileId) {
    try {
        const { data: versions, error } = await supabaseClient
            .from('file_versions')
            .select('id, file_path')
            .eq('file_id', fileId)
            .order('version_number', { ascending: true }); // Oldest first

        if (error) throw error;

        if (versions && versions.length > 9) {
            const toDelete = versions.slice(0, versions.length - 9);
            const deleteIds = toDelete.map(v => v.id);

            const { error: dbDelErr } = await supabaseClient
                .from('file_versions')
                .delete()
                .in('id', deleteIds);
            if (dbDelErr) throw dbDelErr;

            for (let v of toDelete) {
                await deleteStorageFileSafely(v.file_path);
            }
        }
    } catch (err) {
        console.error("Error pruning versions:", err);
    }
}

async function deleteStorageFileSafely(filePath) {
    try {
        const { data: otherFiles } = await supabaseClient
            .from('Files')
            .select('id')
            .eq('file_path', filePath);
        
        const { data: otherVersions } = await supabaseClient
            .from('file_versions')
            .select('id')
            .eq('file_path', filePath);

        if ((!otherFiles || otherFiles.length === 0) && (!otherVersions || otherVersions.length === 0)) {
            await supabaseClient.storage
                .from('upload system')
                .remove([filePath]);
        }
    } catch (err) {
        console.warn("Storage delete failed:", err);
    }
}

window.openVersionHistoryModal = async function (fileId) {
    const modal = document.getElementById('version-history-modal');
    const titleEl = document.getElementById('ver-history-title');
    const listEl = document.getElementById('ver-history-list');
    
    if (!modal || !listEl) return;

    const fileRecord = window.allFiles.find(f => f.id === fileId);
    if (!fileRecord) return;

    if (titleEl) titleEl.textContent = fileRecord.file_name;
    listEl.innerHTML = '<p style="text-align:center;color:#64748b;font-size:13px;padding:20px 0;">Loading versions...</p>';
    modal.classList.remove('hidden');

    try {
        const { data: history, error } = await supabaseClient
            .from('file_versions')
            .select('*')
            .eq('file_id', fileId)
            .order('version_number', { ascending: false });

        if (error) throw error;

        // Render current version
        const sizeMbCurrent = (fileRecord.file_size / (1024 * 1024)).toFixed(2);
        const dateCurrent = new Date(fileRecord.created_at || Date.now()).toLocaleString();
        
        const versionKey = ('version_number' in fileRecord) ? 'version_number' : 'version';
        const currentVerNum = fileRecord[versionKey] || 1;

        const { data: publicUrlData } = supabaseClient.storage
            .from('upload system')
            .getPublicUrl(fileRecord.file_path);
        const currentDownloadUrl = publicUrlData.publicUrl;

        let html = `
            <!-- Current Version -->
            <div class="version-item current">
                <div class="version-info-col">
                    <span class="version-badge current-badge">Version ${currentVerNum} (Current)</span>
                    <span class="version-meta">${sizeMbCurrent} MB &bull; ${fileRecord.file_type || 'Unknown'}</span>
                    <span class="version-date">${dateCurrent}</span>
                </div>
                <div class="version-actions-col">
                    <a href="${currentDownloadUrl}" target="_blank" download="${fileRecord.file_name}" class="ver-btn ver-btn-download" title="Download Current">
                        <i data-lucide="download" style="width:14px;height:14px;"></i>
                    </a>
                </div>
            </div>
        `;

        if (history && history.length > 0) {
            history.forEach(ver => {
                const sizeMb = (ver.file_size / (1024 * 1024)).toFixed(2);
                const date = new Date(ver.created_at).toLocaleString();
                const { data: verUrlData } = supabaseClient.storage
                    .from('upload system')
                    .getPublicUrl(ver.file_path);
                const verDownloadUrl = verUrlData.publicUrl;

                html += `
                    <!-- Historical Version -->
                    <div class="version-item">
                        <div class="version-info-col">
                            <span class="version-badge">Version ${ver.version_number}</span>
                            <span class="version-meta">${sizeMb} MB</span>
                            <span class="version-date">${date}</span>
                        </div>
                        <div class="version-actions-col">
                            <a href="${verDownloadUrl}" target="_blank" download="${fileRecord.file_name}" class="ver-btn ver-btn-download" title="Download Version ${ver.version_number}">
                                <i data-lucide="download" style="width:14px;height:14px;"></i>
                            </a>
                            <button onclick="restoreFileVersion('${fileId}', '${ver.id}')" class="ver-btn ver-btn-restore" title="Restore to Current">
                                <i data-lucide="rotate-ccw" style="width:14px;height:14px;"></i>
                            </button>
                        </div>
                    </div>
                `;
            });
        } else {
            html += '<p style="text-align:center;color:#94a3b8;font-size:12px;padding:12px 0;">No previous versions recorded.</p>';
        }

        listEl.innerHTML = html;
        if (window.lucide) window.lucide.createIcons();

    } catch (err) {
        console.error("Error loading version history:", err);
        listEl.innerHTML = '<p style="text-align:center;color:#ef4444;font-size:12px;padding:20px 0;">Failed to load version history.</p>';
    }
};

window.restoreFileVersion = async function (fileId, versionId) {
    if (!confirm("Are you sure you want to restore this version as current?")) return;

    const fileRecord = window.allFiles.find(f => f.id === fileId);
    if (!fileRecord) return;

    try {
        // Fetch the selected historical version
        const { data: oldVer, error: fetchErr } = await supabaseClient
            .from('file_versions')
            .select('*')
            .eq('id', versionId)
            .single();

        if (fetchErr) throw fetchErr;

        const versionKey = ('version_number' in fileRecord) ? 'version_number' : 'version';
        const currentVerNum = fileRecord[versionKey] || 1;

        // 1. Copy the current file record to file_versions first
        const { error: copyErr } = await supabaseClient
            .from('file_versions')
            .insert([{
                file_id: fileRecord.id,
                user_id: fileRecord.user_id,
                version_number: currentVerNum,
                file_path: fileRecord.file_path,
                file_size: fileRecord.file_size
            }]);

        if (copyErr) throw copyErr;

        // 2. Prune versions if we exceed 9 in history
        await pruneFileVersions(fileId);

        // 3. Update the main Files record with historical size, path, and incremented version
        const updateObj = {
            file_size: oldVer.file_size,
            file_path: oldVer.file_path,
            created_at: new Date()
        };
        updateObj[versionKey] = currentVerNum + 1;

        const { error: restoreErr } = await supabaseClient
            .from('Files')
            .update(updateObj)
            .eq('id', fileId);

        if (restoreErr) throw restoreErr;

        // Success
        document.getElementById('version-history-modal')?.classList.add('hidden');
        showToast("Version restored!");
        fetchFiles();

    } catch (err) {
        console.error("Error restoring version:", err);
        alert(`Failed to restore version: ${err.message}`);
    }
};

// Wire modal close buttons
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('version-history-modal');
    document.getElementById('ver-history-close')?.addEventListener('click', () => modal?.classList.add('hidden'));
    document.getElementById('ver-history-ok')?.addEventListener('click', () => modal?.classList.add('hidden'));
    
    // Close on overlay backdrop click
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });
});

// ════════════════════════════════════════════════════════════════
//  APP-ONLY FEATURES (Android / Capacitor)
//  All gated behind window.Capacitor !== undefined
// ════════════════════════════════════════════════════════════════

(function () {
    const isApp = window.Capacitor !== undefined;
    if (!isApp) return;

    // ── Feature 3: Android Back Button ──
    function _closeModal(el) {
        if (!el) return;
        el.classList.add('hidden');
        el.style.display = 'none';
    }

    function _isModalOpen(el) {
        if (!el) return false;
        return !el.classList.contains('hidden') && el.style.display !== 'none';
    }

    App.addListener('backButton', () => {
        const filePreviewModal = document.getElementById('file-preview-modal');
        if (filePreviewModal && !filePreviewModal.classList.contains('hidden')) {
            closeFilePreviewModal();
            return;
        }

        const modals = [
            document.getElementById('app-longpress-modal'),
            document.getElementById('app-move-modal'),
            document.getElementById('folder-modal'),
            document.getElementById('folder-delete-modal'),
            document.getElementById('upload-folder-modal'),
            document.getElementById('delete-account-modal'),
            document.getElementById('version-history-modal'),
            document.getElementById('qr-modal-overlay'),
            document.getElementById('m-import-files-modal'),
            document.getElementById('m-upload-options-modal'),
            document.getElementById('d-upload-options-modal'),
        ];
        for (const el of modals) {
            if (_isModalOpen(el)) {
                _closeModal(el);
                return;
            }
        }

        const dlEl = document.getElementById('app-download-progress');
        if (dlEl && !dlEl.classList.contains('hidden') && dlEl.style.display !== 'none') {
            dlEl.classList.add('hidden');
            dlEl.style.display = 'none';
            return;
        }

        // Navigation
        const activeSection = document.querySelector('.page-section.active-page');
        const sectionId = activeSection?.id || '';

        if (window.currentFolderId) {
            window.currentFolderId = null;
            renderAllFiles();
            if (window.renderFolders) window.renderFolders();
            if (window.lucide) window.lucide.createIcons();
        } else if (sectionId !== 'page-upload') {
            // Go to Home tab
            document.querySelectorAll('.nav-btn, .nav-item').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('[data-target="page-upload"]').forEach(b => b.classList.add('active'));
            document.querySelectorAll('.page-section').forEach(sec => {
                sec.classList.remove('active-page');
                sec.classList.add('hidden-section');
            });
            const uploadSection = document.getElementById('page-upload');
            if (uploadSection) {
                uploadSection.classList.remove('hidden-section');
                uploadSection.classList.add('active-page');
            }
        } else {
            // In Home tab → ask to exit
            if (confirm('Exit app?')) {
                App.exitApp();
            }
        }
    });

    // ── Feature 1: Pull to Refresh ──
    let ptrState = { startY: 0, pulling: false, triggered: false };
    const ptrIndicator = document.getElementById('ptr-indicator');
    const ptrIcon = document.getElementById('ptr-icon');
    const ptrText = document.getElementById('ptr-text');
    const fileListEl = document.getElementById('file-list');

    if (fileListEl) {
        fileListEl.addEventListener('touchstart', (e) => {
            if (document.scrollingElement.scrollTop > 4) return;
            ptrState.startY = e.touches[0].clientY;
            ptrState.pulling = true;
            ptrState.triggered = false;
        }, { passive: true });

        fileListEl.addEventListener('touchmove', (e) => {
            if (!ptrState.pulling) return;
            const dist = e.touches[0].clientY - ptrState.startY;
            if (dist > 0 && document.scrollingElement.scrollTop <= 4) {
                if (ptrIndicator) {
                    ptrIndicator.style.display = '';
                    ptrIndicator.style.opacity = Math.min(1, dist / 100);
                }
                if (dist > 70) {
                    if (ptrIcon) ptrIcon.style.transform = 'rotate(180deg)';
                    if (ptrText) ptrText.textContent = 'Release to refresh';
                    ptrState.triggered = true;
                } else {
                    if (ptrIcon) ptrIcon.style.transform = 'rotate(0deg)';
                    if (ptrText) ptrText.textContent = 'Pull to refresh';
                    ptrState.triggered = false;
                }
            }
        }, { passive: true });

        fileListEl.addEventListener('touchend', () => {
            ptrState.pulling = false;
            if (ptrIndicator) {
                ptrIndicator.style.opacity = '0';
                setTimeout(() => { if (ptrIndicator) ptrIndicator.style.display = 'none'; }, 300);
            }
            if (ptrIcon) ptrIcon.style.transform = 'rotate(0deg)';
            if (ptrText) ptrText.textContent = 'Pull to refresh';
            if (ptrState.triggered) {
                ptrState.triggered = false;
                if (ptrText) ptrText.textContent = 'Refreshing...';
                fetchFiles();
                showToast('Files refreshed');
            }
        }, { passive: true });
    }

    // ── Feature 2 (cont.): Long Press Action Modal Wiring ──
    window._lpCurrentFile = null;

    const lpModal = document.getElementById('app-longpress-modal');
    document.getElementById('lp-cancel-btn')?.addEventListener('click', () => {
        if (lpModal) { lpModal.classList.add('hidden'); lpModal.style.display = 'none'; }
    });
    if (lpModal) {
        lpModal.addEventListener('click', (e) => {
            if (e.target === lpModal) { lpModal.classList.add('hidden'); lpModal.style.display = 'none'; }
        });
        lpModal.querySelectorAll('.lp-action').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const file = window._lpCurrentFile;
                if (!file) return;
                lpModal.classList.add('hidden');
                lpModal.style.display = 'none';

                const { data } = supabaseClient.storage.from('upload system').getPublicUrl(file.file_path);
                const publicUrl = data.publicUrl;

                switch (action) {
                    case 'open':
                        openAppFileViewer(file);
                        break;
                    case 'share':
                        shareFile(file.file_name, publicUrl, file.file_type);
                        break;
                    case 'download':
                        downloadFile(publicUrl, file.file_name);
                        break;
                    case 'rename':
                        renameFilePrompt(file.id, file.file_name);
                        break;
                    case 'move':
                        openAppMoveFolderModal(file);
                        break;
                    case 'delete':
                        deleteFile(file.id, file.file_path);
                        break;
                }
            });
        });
    }

    // ── Feature 4: Download File with Progress ──
    window.downloadFileWithProgress = async function downloadFileWithProgress(fileName, url) {
        if (!url) return;
        showToast('Downloading... please wait', '⬇️');
        const dlOverlay = document.getElementById('app-download-progress');
        const dlBar = document.getElementById('dl-progress-bar');
        const dlPct = document.getElementById('dl-progress-pct');
        const dlStatus = document.getElementById('dl-progress-status');
        const dlFilename = document.getElementById('dl-progress-filename');

        if (dlOverlay) { dlOverlay.classList.remove('hidden'); dlOverlay.style.display = ''; }
        if (dlFilename) dlFilename.textContent = fileName;
        if (dlStatus) dlStatus.textContent = 'Starting download...';
        if (dlBar) dlBar.style.width = '0%';
        if (dlPct) dlPct.textContent = '0%';

        try {
            const safeName = (fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `FileHub/${safeName}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error(`Download failed (${response.status})`);

            const total = parseInt(response.headers.get('Content-Length') || '0', 10);
            let loaded = 0;
            const reader = response.body.getReader();
            const chunks = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.length;
                if (total) {
                    const pct = Math.round((loaded / total) * 100);
                    if (dlBar) dlBar.style.width = pct + '%';
                    if (dlPct) dlPct.textContent = pct + '%';
                    if (dlStatus) dlStatus.textContent = `${Math.round(loaded / 1024)} KB / ${Math.round(total / 1024)} KB`;
                } else {
                    if (dlStatus) dlStatus.textContent = `${Math.round(loaded / 1024)} KB downloaded`;
                }
            }

            const blob = new Blob(chunks);
            const base64 = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onloadend = () => {
                    const res = r.result;
                    if (typeof res !== 'string') { reject(new Error('Could not read file data')); return; }
                    const comma = res.indexOf(',');
                    resolve(comma >= 0 ? res.slice(comma + 1) : res);
                };
                r.onerror = () => reject(r.error || new Error('Could not read file data'));
                r.readAsDataURL(blob);
            });

            await Filesystem.writeFile({ path, data: base64, directory: Directory.External, recursive: true });

            if (dlStatus) dlStatus.textContent = 'Download complete!';
            if (dlBar) dlBar.style.width = '100%';
            if (dlPct) dlPct.textContent = '100%';
            showToast('File downloaded successfully!', '✅', 'success');

            // Notification bar completion
            try {
                const mod = await import('@capacitor/local-notifications');
                await mod.LocalNotifications.schedule({
                    notifications: [{
                        title: 'Download Complete',
                        body: `${fileName} saved`,
                        id: Date.now(),
                        smallIcon: 'ic_stat_icon_configurable',
                        iconColor: '#4DB6AC'
                    }]
                });
            } catch (_) {}

            setTimeout(() => { if (dlOverlay) { dlOverlay.classList.add('hidden'); dlOverlay.style.display = 'none'; } }, 2500);
        } catch (err) {
            console.error('Download progress error:', err);
            if (dlStatus) dlStatus.textContent = `Failed: ${err.message || err}`;
            if (dlBar) dlBar.style.background = '#ef4444';
            setTimeout(() => { if (dlOverlay) { dlOverlay.classList.add('hidden'); dlOverlay.style.display = 'none'; } }, 3000);
        }
    };
    // ── Move to Folder (used by long press action) ──
    let _moveFileRef = null;

    window.openAppMoveFolderModal = function (file) {
        _moveFileRef = file;
        const list = document.getElementById('app-move-folder-list');
        const confirmBtn = document.getElementById('app-move-confirm');
        const modal = document.getElementById('app-move-modal');
        if (!list || !modal) return;

        list.innerHTML = '<p style="text-align:center;color:#94a3b8;font-size:13px;padding:12px 0;">No folders available</p>';
        if (confirmBtn) confirmBtn.disabled = true;

        const folders = window.folders || [];
        if (folders.length === 0) {
            list.innerHTML = '<p style="text-align:center;color:#94a3b8;font-size:13px;padding:12px 0;">Create a folder first</p>';
        } else {
            list.innerHTML = '';
            folders.forEach(f => {
                const item = document.createElement('div');
                item.dataset.folderId = f.id;
                item.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;background:#f8fafc;border:1px solid #f1f5f9;cursor:pointer;font-family:\'Poppins\',sans-serif;transition:all 0.2s;';
                item.innerHTML = `
                    <div style="width:36px;height:36px;border-radius:10px;background:rgba(77,182,172,0.1);display:flex;align-items:center;justify-content:center;color:#4DB6AC;flex-shrink:0;">
                        <i data-lucide="folder" style="width:18px;height:18px;"></i>
                    </div>
                    <span style="flex:1;font-size:13px;font-weight:700;color:#1e293b;">${f.folder_name}</span>
                    <div class="move-radio" style="width:20px;height:20px;border-radius:50%;border:2px solid #cbd5e1;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.2s;"></div>
                `;
                item.addEventListener('click', () => {
                    list.querySelectorAll('[data-folder-id]').forEach(el => {
                        el.style.borderColor = '#f1f5f9';
                        el.style.background = '#f8fafc';
                        const radio = el.querySelector('.move-radio');
                        if (radio) { radio.style.borderColor = '#cbd5e1'; radio.style.background = 'transparent'; }
                    });
                    item.style.borderColor = '#4DB6AC';
                    item.style.background = 'rgba(77,182,172,0.05)';
                    const radio = item.querySelector('.move-radio');
                    if (radio) { radio.style.borderColor = '#4DB6AC'; radio.style.background = '#4DB6AC'; }
                    if (confirmBtn) confirmBtn.disabled = false;
                    confirmBtn.dataset.folderId = f.id;
                });
                list.appendChild(item);
            });
            if (window.lucide) window.lucide.createIcons();
        }

        modal.classList.remove('hidden');
        modal.style.display = 'flex';
    };

    document.getElementById('app-move-cancel')?.addEventListener('click', () => {
        const modal = document.getElementById('app-move-modal');
        if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
    });

    document.getElementById('app-move-confirm')?.addEventListener('click', async () => {
        const btn = document.getElementById('app-move-confirm');
        const folderId = btn?.dataset.folderId;
        if (!folderId || !_moveFileRef) return;

        try {
            const { error } = await supabaseClient
                .from('Files')
                .update({ folder_id: folderId })
                .eq('id', _moveFileRef.id);
            if (error) throw error;

            showToast('File moved successfully');
            fetchFiles();
        } catch (err) {
            console.error('Move failed:', err);
            alert('Failed to move file');
        }

        const modal = document.getElementById('app-move-modal');
        if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; }
        _moveFileRef = null;
    });
})();





