/** True when running inside the Capacitor native shell (Android app). */
export function isCapacitorApp() {
    if (typeof window === 'undefined') return false;
    try {
        if (window.Capacitor?.isNativePlatform?.()) return true;
    } catch (_) { /* ignore */ }
    return !!window.Capacitor || /\bwv\b/i.test(navigator.userAgent);
}

export const APP_AUTH_REDIRECT = 'com.gjsfilehub.app://auth/callback';

/** Parse OAuth redirect URL and establish Supabase session (app deep link). */
export async function handleOAuthRedirectUrl(url, supabaseClient, Browser) {
    if (!url || !url.includes('auth/callback')) return false;

    try {
        await Browser.close();
    } catch (_) { /* browser may already be closed */ }

    if (url.includes('#')) {
        const params = new URLSearchParams(url.split('#')[1]);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        if (access_token && refresh_token) {
            const { error } = await supabaseClient.auth.setSession({ access_token, refresh_token });
            return !error;
        }
    }

    const query = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
    const code = new URLSearchParams(query).get('code');
    if (code) {
        const { error } = await supabaseClient.auth.exchangeCodeForSession(code);
        return !error;
    }

    return false;
}
