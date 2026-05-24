import { supabaseClient } from './config.js';
import { isCapacitorApp } from './platform.js';
import { appDownloadFile, appShareFile } from './app-native-files.js';

const realtimeToast = document.getElementById('realtime-toast');
function showToast(message) {
    if (realtimeToast) {
        const msgSpan = realtimeToast.querySelector('.toast-msg');
        if (msgSpan) msgSpan.textContent = message || 'File list updated';
        realtimeToast.classList.remove('hidden');
        setTimeout(() => {
            realtimeToast.classList.add('hidden');
        }, 3000);
    }
}


if (!isCapacitorApp()) {
    window.location.replace('dashboard.html');
}

let fileMeta = null;
let fileUrl = null;

function getPayload() {
    try {
        const raw = sessionStorage.getItem('viewerPayload');
        if (raw) return JSON.parse(raw);
    } catch (_) { /* ignore */ }
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) return null;
    return {
        id,
        file_name: params.get('name') || 'file',
        file_type: params.get('type') || '',
        file_path: params.get('path') || ''
    };
}

async function resolveFileUrl(filePath) {
    const { data: signed, error } = await supabaseClient.storage
        .from('upload system')
        .createSignedUrl(filePath, 3600);

    if (!error && signed?.signedUrl) return signed.signedUrl;

    const { data } = supabaseClient.storage.from('upload system').getPublicUrl(filePath);
    return data.publicUrl;
}

async function renderPreview(url, fileType, fileName) {
    const container = document.getElementById('viewer-content');
    const type = (fileType || '').toLowerCase();
    const name = (fileName || '').toLowerCase();

    if (type.startsWith('image/')) {
        container.innerHTML = `<img src="${url}" alt="${fileName}" />`;
        return;
    }
    if (type.startsWith('video/')) {
        container.innerHTML = `<video src="${url}" controls playsinline></video>`;
        return;
    }
    if (type.startsWith('audio/')) {
        container.innerHTML = `<audio src="${url}" controls style="width:100%;"></audio>`;
        return;
    }
    if (type.includes('pdf') || name.endsWith('.pdf')) {
        const embedUrl = `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`;
        container.innerHTML = `<iframe src="${embedUrl}" allowfullscreen></iframe>`;
        return;
    }
    if (type.startsWith('text/') || /\.(txt|md|json|xml|html|css|js|log|csv)$/i.test(name)) {
        container.innerHTML = '<p class="viewer-loading">Loading text…</p>';
        fetch(url)
            .then((r) => r.text())
            .then((text) => {
                const pre = document.createElement('pre');
                pre.textContent = text.length > 500000 ? text.slice(0, 500000) + '\n…(truncated)' : text;
                container.innerHTML = '';
                container.appendChild(pre);
            })
            .catch(() => showFallback(container, fileName));
        return;
    }

    showFallback(container, fileName);
}

function showFallback(container, fileName) {
    container.innerHTML = `
        <div class="viewer-fallback">
            <i data-lucide="file" style="width: 48px; height: 48px; color: #4DB6AC; margin-bottom: 12px;"></i>
            <p><strong>${fileName}</strong></p>
            <p>Preview is not available for this file type. Use Download to save it on your device.</p>
        </div>`;
    if (window.lucide) lucide.createIcons();
}

async function init() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.replace('index.html');
        return;
    }

    fileMeta = getPayload();
    if (!fileMeta?.file_path) {
        window.location.replace('dashboard.html');
        return;
    }

    document.getElementById('viewer-title').textContent = fileMeta.file_name || 'File';

    try {
        fileUrl = await resolveFileUrl(fileMeta.file_path);
        await renderPreview(fileUrl, fileMeta.file_type, fileMeta.file_name);
    } catch (err) {
        console.error(err);
        document.getElementById('viewer-content').innerHTML =
            `<div class="viewer-fallback"><p>Could not load file: ${err.message || err}</p></div>`;
    }

    document.getElementById('viewer-back-btn')?.addEventListener('click', () => {
        if (window.history.length > 1) window.history.back();
        else window.location.href = 'dashboard.html';
    });

    document.getElementById('viewer-download-btn')?.addEventListener('click', () => {
        appDownloadFile(fileMeta.file_name, fileUrl);
    });

    document.getElementById('viewer-share-btn')?.addEventListener('click', () => {
        appShareFile(fileMeta.file_name, fileUrl);
    });
}

init();
