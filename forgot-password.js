 import { supabaseClient } from './config.js';

const forgotPasswordForm = document.getElementById('forgot-password-form');
const resetEmailInput = document.getElementById('reset-email');
const authError = document.getElementById('auth-error');
const authMsg = document.getElementById('auth-msg');
const sendLinkBtn = document.getElementById('send-link-btn');

if (forgotPasswordForm) {
    forgotPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Reset messages
        authError.textContent = '';
        authMsg.textContent = '';
        
        const email = resetEmailInput.value;
        
        // Loading state
        sendLinkBtn.disabled = true;
        sendLinkBtn.textContent = 'Sending...';
        
        try {
            const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: 'https://file-upload-system-27636.web.app/reset-password.html',
            });
            
            if (error) throw error;
            
            authMsg.textContent = 'Reset link sent! Please check your email.';
            forgotPasswordForm.reset();
            
        } catch (err) {
            authError.textContent = err.message;
        } finally {
            sendLinkBtn.disabled = false;
            sendLinkBtn.textContent = 'SEND RESET LINK';
        }
    });
}
