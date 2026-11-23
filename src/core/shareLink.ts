/**
 * Marklet · Zero-server URL hash feedback sharing
 *
 * Encodes page comments (without heavy base64 screenshots or avatars) using
 * browser-native deflate-raw CompressionStream + base64url into `#marklet=...`.
 * Hash fragments are never sent to web servers, keeping shared feedback private
 * between teammates in Teams / Slack and local browsers.
 */
import type { CommentReply, CommentThread, ElementAnchor, UserProfile } from '../adapters/types';

export const SHARE_HASH_PREFIX = 'marklet=';
export const MAX_SHARE_URL_LEN = 6500;

interface CompactUser {
  id: string;
  name: string;
  mode: UserProfile['mode'];
  color?: string;
}

interface CompactReply {
  id: string;
  body: string;
  author: CompactUser;
  createdAt: string;
}

interface CompactThread {
  id: string;
  pinNumber: number;
  status: CommentThread['status'];
  body: string;
  author: CompactUser;
  anchor: ElementAnchor;
  replies: CompactReply[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedBy?: CompactUser;
}

interface SharePayloadV1 {
  v: 1;
  by: string;
  threads: CompactThread[];
}

export interface EncodedShareLink {
  url: string;
  tooLong: boolean;
  count: number;
}

export interface DecodedSharePayload {
  sharedBy: string;
  threads: CommentThread[];
}

function compactUser(u: UserProfile): CompactUser {
  return {
    id: u.id,
    name: u.name,
    mode: u.mode,
    ...(u.color ? { color: u.color } : {}),
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function compressString(str: string): Promise<{ prefix: 'z' | 'p'; data: string }> {
  const raw = new TextEncoder().encode(str);
  if (typeof CompressionStream === 'function') {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(raw);
    writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return { prefix: 'z', data: bytesToBase64Url(new Uint8Array(buf)) };
  }
  return { prefix: 'p', data: bytesToBase64Url(raw) };
}

async function decompressString(encoded: string): Promise<string> {
  const mode = encoded[0];
  const body = encoded.slice(1);
  const bytes = base64UrlToBytes(body);
  if (mode === 'z') {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('DecompressionStream unavailable');
    }
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(bytes as unknown as BufferSource);
    writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new TextDecoder().decode(buf);
  }
  if (mode === 'p') {
    return new TextDecoder().decode(bytes);
  }
  throw new Error('Unsupported share payload encoding');
}

export function hasShareHash(urlStr: string): boolean {
  try {
    const hash = new URL(urlStr).hash.replace(/^#/, '');
    return hash.startsWith(SHARE_HASH_PREFIX) && hash.length > SHARE_HASH_PREFIX.length + 4;
  } catch {
    return false;
  }
}

function compactAnchor(a: ElementAnchor): ElementAnchor {
  const bb = a.boundingBox;
  return {
    strategy: a.strategy,
    selector: a.selector,
    pathSelector: a.pathSelector,
    ...(a.testId ? { testId: a.testId } : {}),
    ...(a.testIdAttr ? { testIdAttr: a.testIdAttr } : {}),
    ...(a.elementId ? { elementId: a.elementId } : {}),
    tagName: a.tagName,
    textSnippet: a.textSnippet,
    ...(a.overlayContext ? { overlayContext: a.overlayContext } : {}),
    boundingBox: {
      pageX: Math.round(bb.pageX),
      pageY: Math.round(bb.pageY),
      width: Math.round(bb.width),
      height: Math.round(bb.height),
      xRatio: Math.round(bb.xRatio * 1000) / 1000,
      yRatio: Math.round(bb.yRatio * 1000) / 1000,
      widthRatio: Math.round(bb.widthRatio * 1000) / 1000,
      heightRatio: Math.round(bb.heightRatio * 1000) / 1000,
      docWidth: Math.round(bb.docWidth),
      docHeight: Math.round(bb.docHeight),
      viewportWidth: Math.round(bb.viewportWidth),
      viewportHeight: Math.round(bb.viewportHeight),
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Copy a shareable feedback link as both rich HTML (renders as a clean clickable
 * hyperlink in Teams, Slack, Outlook, Notion) and plain text (for browser URL bars).
 */
export async function copyShareLinkToClipboard(url: string, label: string): Promise<void> {
  if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
    try {
      const html = `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([url], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      /* fall through to plain text */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export async function encodeShareLink(
  pageUrl: string,
  threads: CommentThread[],
  sharedBy: string,
): Promise<EncodedShareLink> {
  const payload: SharePayloadV1 = {
    v: 1,
    by: sharedBy.slice(0, 60) || 'A teammate',
    threads: threads.map((t) => ({
      id: t.id,
      pinNumber: t.pinNumber,
      status: t.status,
      body: t.body,
      author: compactUser(t.author),
      anchor: compactAnchor(t.anchor),
      replies: t.replies.map((r) => ({
        id: r.id,
        body: r.body,
        author: compactUser(r.author),
        createdAt: r.createdAt,
      })),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      ...(t.resolvedAt ? { resolvedAt: t.resolvedAt } : {}),
      ...(t.resolvedBy ? { resolvedBy: compactUser(t.resolvedBy) } : {}),
    })),
  };

  const { prefix, data } = await compressString(JSON.stringify(payload));
  const u = new URL(pageUrl);
  u.hash = `${SHARE_HASH_PREFIX}${prefix}${data}`;
  const url = u.toString();
  return {
    url,
    tooLong: url.length > MAX_SHARE_URL_LEN,
    count: threads.length,
  };
}

export async function decodeShareFromUrl(
  urlStr: string,
  pageKey: string,
): Promise<DecodedSharePayload | null> {
  try {
    const u = new URL(urlStr);
    const hash = u.hash.replace(/^#/, '');
    if (!hash.startsWith(SHARE_HASH_PREFIX)) return null;
    const encoded = hash.slice(SHARE_HASH_PREFIX.length);
    if (encoded.length < 4 || encoded.length > 100_000) return null;

    const jsonStr = await decompressString(encoded);
    const parsed = JSON.parse(jsonStr) as Partial<SharePayloadV1>;
    if (parsed?.v !== 1 || !Array.isArray(parsed.threads)) return null;

    const cleanUrl = `${u.origin}${u.pathname}${u.search}`;
    const threads: CommentThread[] = [];

    for (const raw of parsed.threads) {
      if (!raw || typeof raw.id !== 'string' || typeof raw.body !== 'string' || !raw.anchor) continue;
      if (!raw.author || typeof raw.author.name !== 'string') continue;

      const replies: CommentReply[] = Array.isArray(raw.replies)
        ? raw.replies
            .filter((r) => r && typeof r.id === 'string' && typeof r.body === 'string' && r.author?.name)
            .map((r) => ({
              id: r.id,
              threadId: raw.id,
              body: r.body,
              author: {
                id: r.author.id || 'shared',
                name: r.author.name,
                mode: r.author.mode === 'self-note' ? 'self-note' : 'named',
                color: r.author.color,
              },
              createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
            }))
        : [];

      threads.push({
        id: raw.id,
        pageKey,
        url: cleanUrl,
        pinNumber: typeof raw.pinNumber === 'number' ? raw.pinNumber : threads.length + 1,
        status: raw.status === 'resolved' ? 'resolved' : 'open',
        body: raw.body,
        author: {
          id: raw.author.id || 'shared',
          name: raw.author.name,
          mode: raw.author.mode === 'self-note' ? 'self-note' : 'named',
          color: raw.author.color,
        },
        anchor: raw.anchor,
        replies,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
        resolvedAt: typeof raw.resolvedAt === 'string' ? raw.resolvedAt : undefined,
        resolvedBy: raw.resolvedBy
          ? {
              id: raw.resolvedBy.id || 'shared',
              name: raw.resolvedBy.name,
              mode: raw.resolvedBy.mode === 'self-note' ? 'self-note' : 'named',
              color: raw.resolvedBy.color,
            }
          : undefined,
      });
    }

    if (threads.length === 0) return null;
    return {
      sharedBy: typeof parsed.by === 'string' && parsed.by.trim() ? parsed.by.trim() : 'A teammate',
      threads,
    };
  } catch {
    return null;
  }
}

export function stripShareHashFromCurrentUrl(): void {
  try {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash.startsWith(SHARE_HASH_PREFIX)) return;
    const clean = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(window.history.state, '', clean);
  } catch {
    /* ignore in restricted contexts */
  }
}
