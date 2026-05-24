import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isCapacitorApp } from './platform.js';

const DOWNLOAD_FOLDER = 'FileHub';

function sanitizeFileNameForFs(name) {
    const base = (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    return base || 'file';
}

function toast(msg) {
    if (typeof window.showToast === 'function') {
        window.showToast(msg);
    }
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result;
            if (typeof result !== 'string') {
                reject(new Error('Could not read file data'));
                return;
            }
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error || new Error('Could not read file data'));
        reader.readAsDataURL(blob);
    });
}

/** Fetch a remote URL and save it with Filesystem.writeFile (Capacitor 4–compatible). */
async function saveUrlToFilesystem(url, path, directory) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Download failed (${response.status})`);
    }
    const base64 = await blobToBase64(await response.blob());
    await Filesystem.writeFile({
        path,
        data: base64,
        directory,
        recursive: true
    });
    return path;
}

export async function appDownloadFile(fileName, url) {
    if (!isCapacitorApp() || !url) return;
    const safeName = sanitizeFileNameForFs(fileName);
    const path = `${DOWNLOAD_FOLDER}/${safeName}`;
    toast('Downloading…');
    try {
        await saveUrlToFilesystem(url, path, Directory.External);
        toast(`Saved to FileHub/${safeName}`);
    } catch (err) {
        console.error('App download failed:', err);
        alert(`Download failed: ${err.message || err}`);
    }
}

export async function appShareFile(fileName, url) {
    if (!isCapacitorApp() || !url) return;
    try {
        await Share.share({
            title: fileName || 'File',
            url: url,
            dialogTitle: 'Share file'
        });
    } catch (err) {
        if (err?.message !== 'Share canceled') {
            console.error('App share failed:', err);
            alert(`Share failed: ${err.message || err}`);
        }
    }
}
