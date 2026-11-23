/**
 * Marklet · Microsoft Entra ID (OAuth 2.0 PKCE) authentication
 *
 * Runs inside the MV3 background service worker via `chrome.identity.launchWebAuthFlow`.
 * Zero external dependencies, zero client secret, zero third-party backend.
 */
import { STORAGE_NS, USER_KEY } from './chromeStorageAdapter';
import type { UserProfile } from '../adapters/types';

export const MS_CLIENT_ID = 'a5e14f03-65c7-4a9f-9f0f-2e0822524ac1';
const MS_AUTHORITY = 'https://login.microsoftonline.com/common';
const MS_SCOPES = 'openid profile email offline_access User.Read';

export const MS_AUTH_KEY = `${STORAGE_NS}:msAuth`;

export interface MsAuthSession {
  provider?: 'microsoft' | 'google';
  accountId: string;
  name: string;
  email: string;
  avatarDataUrl?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
}

const AVATAR_PALETTE = ['#c96442', '#4d7c74', '#6a9bcc', '#788c5d', '#b46927', '#8c6d8c', '#9a5b44'];

export function avatarColorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64Url(byteLen = 32): string {
  const buf = new Uint8Array(byteLen);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

function parseOAuthError(params: URLSearchParams): string {
  const code = params.get('error') ?? '';
  const desc = params.get('error_description') ?? '';
  if (code === 'access_denied' || desc.includes('AADSTS65001') || desc.includes('AADSTS90094')) {
    return 'Sign-in requires tenant admin approval or was cancelled.';
  }
  return desc.split('\r\n')[0].slice(0, 160) || code || 'Microsoft sign-in failed.';
}

async function fetchProfilePhoto(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/photos/48x48/$value', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const mime = blob.type || 'image/jpeg';
    return `data:${mime};base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}

export async function getMsSession(): Promise<MsAuthSession | null> {
  const res = await chrome.storage.local.get(MS_AUTH_KEY);
  return (res[MS_AUTH_KEY] as MsAuthSession | undefined) ?? null;
}

export async function signInWithMicrosoft(): Promise<
  { ok: true; session: MsAuthSession } | { ok: false; error: string }
> {
  try {
    const redirectUri = chrome.identity.getRedirectURL();
    const codeVerifier = randomBase64Url(48);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const state = randomBase64Url(16);

    const authUrl = new URL(`${MS_AUTHORITY}/oauth2/v2.0/authorize`);
    authUrl.searchParams.set('client_id', MS_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_mode', 'query');
    authUrl.searchParams.set('scope', MS_SCOPES);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
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
    const params = returnedUrl.searchParams;
    if (params.get('error')) {
      return { ok: false, error: parseOAuthError(params) };
    }
    if (params.get('state') !== state) {
      return { ok: false, error: 'Invalid OAuth state. Please try again.' };
    }
    const code = params.get('code');
    if (!code) {
      return { ok: false, error: 'No authorization code returned.' };
    }

    const tokenBody = new URLSearchParams({
      client_id: MS_CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      scope: MS_SCOPES,
    });

    const tokenRes = await fetch(`${MS_AUTHORITY}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || !tokenJson.access_token) {
      const msg = tokenJson.error_description?.split('\r\n')[0].slice(0, 160) || tokenJson.error || 'Token exchange failed.';
      return { ok: false, error: msg };
    }

    const accessToken = tokenJson.access_token;
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) {
      return { ok: false, error: 'Signed in, but failed to load Microsoft profile.' };
    }
    const me = (await meRes.json()) as {
      id?: string;
      displayName?: string;
      mail?: string;
      userPrincipalName?: string;
    };

    const email = me.mail || me.userPrincipalName || '';
    const name = me.displayName?.trim() || email.split('@')[0] || 'Microsoft User';
    const accountId = `ms_${me.id || email || Date.now()}`;
    const avatarDataUrl = await fetchProfilePhoto(accessToken);

    const session: MsAuthSession = {
      provider: 'microsoft',
      accountId,
      name,
      email,
      avatarDataUrl,
      accessToken,
      refreshToken: tokenJson.refresh_token,
      expiresAt: Date.now() + (tokenJson.expires_in ?? 3600) * 1000,
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

export async function signOutMicrosoft(): Promise<void> {
  await chrome.storage.local.remove(MS_AUTH_KEY);
  const existing = await chrome.storage.local.get(USER_KEY);
  const user = existing[USER_KEY] as UserProfile | undefined;
  if (user && (user.id.startsWith('ms_') || user.id.startsWith('google_'))) {
    const fallback: UserProfile = {
      id: user.id,
      name: 'Self Note',
      mode: 'self-note',
      color: user.color ?? '#c96442',
    };
    await chrome.storage.local.set({ [USER_KEY]: fallback });
  }
}
