import { supabaseClient } from './config.js';

const resetPasswordForm = document.getElementById('reset-password-form');
const newPasswordInput = document.getElementById('new-password');
const confirmPasswordInput = document.getElementById('confirm-password');
const authError = document.getElementById('auth-error');
const authMsg = document.getElementById('auth-msg');
const updatePasswordBtn = document.getElementById('update-password-btn');

if (resetPasswordForm) {
    resetPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Reset messages
        authError.textContent = '';
        authMsg.textContent = '';
        
        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;
        
        // Validation
        if (newPassword !== confirmPassword) {
            authError.textContent = 'Passwords do not match.';
            return;
        }
        
        if (newPassword.length < 6) {
            authError.textContent = 'Password must be at least 6 characters.';
            return;
        }
        
        // Loading state
        updatePasswordBtn.disabled = true;
        updatePasswordBtn.textContent = 'Updating...';
        
        try {
            const { error } = await supabaseClient.auth.updateUser({
                password: newPassword
            });
            
            if (error) throw error;
            
            authMsg.textContent = 'Password updated successfully! Redirecting to login...';
            
            // Redirect after a short delay
            setTimeout(() => {
                window.location.replace('index.html');
            }, 2000);
            
        } catch (err) {
            authError.textContent = err.message;
            updatePasswordBtn.disabled = false;
            updatePasswordBtn.textContent = 'UPDATE PASSWORD';
        }
    });
}
