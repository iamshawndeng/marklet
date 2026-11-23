/**
 * Marklet · Google OAuth 2.0 sign-in (works in both Chrome & Microsoft Edge)
 *
 * Uses `chrome.identity.launchWebAuthFlow` with read-only `openid profile email`
 * scopes to fetch the user's name, email, and avatar without a client secret or backend.
 */
import { USER_KEY } from './chromeStorageAdapter';
import { avatarColorFor, MS_AUTH_KEY, type MsAuthSession } from './msAuth';
import type { UserProfile } from '../adapters/types';

export const GOOGLE_CLIENT_ID = '175140320413-v44ag6i3l01bvlu7623avheae587r2gp.apps.googleusercontent.com';
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_SCOPES = 'openid profile email';

function randomState(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += buf[i].toString(16).padStart(2, '0');
  return out;
}

async function fetchImageAsDataUrl(url?: string): Promise<string | undefined> {
  if (!url || !/^https:\/\//i.test(url)) return undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}

export async function signInWithGoogle(): Promise<
  { ok: true; session: MsAuthSession } | { ok: false; error: string }
> {
  try {
    const redirectUri = chrome.identity.getRedirectURL();
    const state = randomState();

    const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', GOOGLE_SCOPES);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('prompt', 'select_account');

    const redirectResponse = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    });

    if (!redirectResponse) {
      return { ok: false, error: 'Sign-in cancelled.' };
    }

    const returnedUrl = new URL(redirectResponse);
    const hashParams = new URLSearchParams(returnedUrl.hash.replace(/^#/, ''));
    const queryParams = returnedUrl.searchParams;
    const error = hashParams.get('error') || queryParams.get('error');
    if (error) {
      return { ok: false, error: error === 'access_denied' ? 'Sign-in cancelled.' : error };
    }

    const returnedState = hashParams.get('state') || queryParams.get('state');
    if (returnedState !== state) {
      return { ok: false, error: 'Invalid OAuth state. Please try again.' };
    }

    const accessToken = hashParams.get('access_token');
    if (!accessToken) {
      return { ok: false, error: 'No access token returned by Google.' };
    }

    const meRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) {
      return { ok: false, error: 'Signed in, but failed to load Google profile.' };
    }
    const me = (await meRes.json()) as {
      sub?: string;
      name?: string;
      email?: string;
      picture?: string;
    };

    const email = me.email || '';
    const name = me.name?.trim() || email.split('@')[0] || 'Google User';
    const accountId = `google_${me.sub || email || Date.now()}`;
    const avatarDataUrl = await fetchImageAsDataUrl(me.picture);
    const expiresIn = Number(hashParams.get('expires_in') || 3600);

    const session: MsAuthSession = {
      provider: 'google',
      accountId,
      name,
      email,
      avatarDataUrl,
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    const syncedProfile: UserProfile = {
      id: accountId,
      name,
      mode: 'named',
      color: avatarColorFor(email || name),
      avatarUrl: avatarDataUrl,
    };

    await chrome.storage.local.set({
      [MS_AUTH_KEY]: session,
      [USER_KEY]: syncedProfile,
    });

    return { ok: true, session };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (/canceled|cancelled|user did not approve/i.test(raw)) {
      return { ok: false, error: 'Sign-in cancelled.' };
    }
    return { ok: false, error: raw.slice(0, 160) };
  }
}
