import { supabaseClient } from './config.js';

// DOM Elements
const authWrapper = document.getElementById('auth-wrapper');
const mainContainer = document.getElementById('main-container');

// Auth Toggles
const toggleLoginBtn = document.getElementById('toggle-login');
const toggleSignupBtn = document.getElementById('toggle-signup');
const loginView = document.getElementById('login-view');
const signupView = document.getElementById('signup-view');

const goToSignup = document.getElementById('go-to-signup');
const goToLogin = document.getElementById('go-to-login');

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
const logoutBtn = document.getElementById('logout-btn');

// Show/Hide Auth Views
function showLoginView() {
    loginView.classList.remove('hidden-view');
    signupView.classList.add('hidden-view');
    toggleLoginBtn.classList.add('active');
    toggleSignupBtn.classList.remove('active');
    clearFeedback();
}

function showSignupView() {
    signupView.classList.remove('hidden-view');
    loginView.classList.add('hidden-view');
    toggleSignupBtn.classList.add('active');
    toggleLoginBtn.classList.remove('active');
    clearFeedback();
}

function clearFeedback() {
    authError.textContent = '';
    authMsg.textContent = '';
}

toggleLoginBtn.addEventListener('click', showLoginView);
toggleSignupBtn.addEventListener('click', showSignupView);
goToSignup.addEventListener('click', showSignupView);
goToLogin.addEventListener('click', showLoginView);

// Check active session on load
async function checkUser() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        showMainApp(session.user);
    } else {
        showAuthScreen();
    }
}

// Setup Auth Listener
supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
        showMainApp(session.user);
    } else if (event === 'SIGNED_OUT') {
        showAuthScreen();
    }
});

// Handle Login Form Submission
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
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
        // Successful login handled by listener
    } catch (err) {
        authError.textContent = err.message;
    } finally {
        btn.disabled = false;
        btn.textContent = 'SIGN IN';
    }
});

// Handle Signup Form Submission
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
        
        if (data?.session) {
            // Auto-login succeeded (Email Confirmations are disabled in Supabase)
            showMainApp(data.user);
        } else if (data?.user?.identities?.length === 0) {
            authError.textContent = 'User already exists. Please sign in instead.';
        } else {
            // No session means Email Confirmations are likely still enabled
            authMsg.textContent = 'Account created! If you did not disable Email Confirmations, please check your inbox. Otherwise, switch to Login and sign in.';
            // Switch to login view after 3 seconds so they can sign in
            setTimeout(showLoginView, 3000);
        }
    } catch (err) {
        authError.textContent = err.message;
    } finally {
        btn.disabled = false;
        btn.textContent = 'CREATE ACCOUNT';
    }
});

// Handle Logout
logoutBtn.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
});

// Screen toggles
function showAuthScreen() {
    authWrapper.classList.remove('hidden');
    mainContainer.classList.add('hidden');
}

function showMainApp(user) {
    authWrapper.classList.add('hidden');
    mainContainer.classList.remove('hidden');
    
    // Attempt to get name or use email
    const name = user.user_metadata?.full_name || user.email;
    userGreeting.textContent = `Hello, ${name}`;
    
    // Set current user and fetch their files
    currentUser = user;
    fetchFiles();
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

let currentUser = null;

// Drag and drop events
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
    handleFiles(files);
}

triggerUploadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', function() {
    handleFiles(this.files);
});

async function handleFiles(files) {
    if (!files || files.length === 0) return;
    if (!currentUser) {
        alert("You must be logged in to upload files.");
        return;
    }

    uploadStatus.classList.remove('hidden');
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await uploadFileToSupabase(file);
    }
    
    // Hide progress after short delay
    setTimeout(() => {
        uploadStatus.classList.add('hidden');
        progressBar.style.width = '0%';
    }, 2000);
    
    fetchFiles(); // Refresh gallery
}

async function uploadFileToSupabase(file) {
    uploadText.textContent = `Uploading ${file.name}...`;
    progressBar.style.width = '30%'; // Fake initial progress
    
    // Create a unique file path: user_id/timestamp_filename
    const filePath = `${currentUser.id}/${Date.now()}_${file.name}`;
    
    try {
        const { data, error } = await supabaseClient.storage
            .from('upload system')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
            });
            
        if (error) throw error;
        
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
        // List files in the user's folder
        const { data, error } = await supabaseClient.storage
            .from('upload system')
            .list(currentUser.id, {
                limit: 100,
                offset: 0,
                sortBy: { column: 'created_at', order: 'desc' }
            });

        if (error) throw error;

        renderFiles(data);
    } catch (err) {
        console.error("Error fetching files:", err);
        emptyStateMsg.textContent = "Error loading files. Ensure you created the 'upload system' bucket and policies in Supabase.";
        emptyStateMsg.style.display = 'block';
    }
}

function renderFiles(files) {
    // Clear current list except empty state
    fileListContainer.innerHTML = '<p class="empty-state" id="empty-state-msg">No files found. Upload something to see it here!</p>';
    const emptyState = document.getElementById('empty-state-msg');
    
    // Filter out the empty folder placeholder that Supabase sometimes creates (.emptyFolderPlaceholder)
    const validFiles = files ? files.filter(f => f.name !== '.emptyFolderPlaceholder') : [];

    if (validFiles.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    validFiles.forEach(file => {
        const card = document.createElement('div');
        card.className = 'file-card';
        
        // Determine icon based on mime type or extension
        let icon = '📄';
        if (file.metadata?.mimetype?.startsWith('image/')) icon = '🖼️';
        else if (file.metadata?.mimetype?.startsWith('video/')) icon = '🎬';
        else if (file.name.endsWith('.pdf')) icon = '📕';
        else if (file.name.endsWith('.zip')) icon = '📦';
        
        // Format size
        const sizeMb = (file.metadata?.size / (1024 * 1024)).toFixed(2);
        
        // Get public URL
        const { data: publicUrlData } = supabaseClient.storage
            .from('upload system')
            .getPublicUrl(`${currentUser.id}/${file.name}`);
            
        const publicUrl = publicUrlData.publicUrl;

        // Extract original file name (remove timestamp prefix if possible)
        let displayName = file.name;
        if (displayName.includes('_')) {
            displayName = displayName.substring(displayName.indexOf('_') + 1);
        }

        card.innerHTML = `
            <div class="file-icon">${icon}</div>
            <div class="file-name" title="${displayName}">${displayName}</div>
            <div class="file-size">${sizeMb} MB</div>
            <div class="file-actions">
                <a href="${publicUrl}" target="_blank" class="btn-download">View</a>
                <button onclick="deleteFile('${file.name}')" class="btn-delete">Delete</button>
            </div>
        `;
        
        fileListContainer.appendChild(card);
    });
}

window.deleteFile = async function(fileName) {
    if (!confirm(`Are you sure you want to delete this file?`)) return;
    
    try {
        const { error } = await supabaseClient.storage
            .from('upload system')
            .remove([`${currentUser.id}/${fileName}`]);
            
        if (error) throw error;
        fetchFiles(); // Refresh
    } catch (err) {
        console.error("Error deleting file:", err);
        alert("Failed to delete file.");
    }
}
