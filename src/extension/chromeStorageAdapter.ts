/**
 * Marklet · extension storage & auth adapters (chrome.storage.local)
 *
 * Lives strictly in src/extension/ so src/core and src/adapters remain free of chrome.* APIs.
 * Persists comments, user identity, page index, and site auto-enable rules across origins.
 */
import type {
  AuthAdapter,
  CommentReply,
  CommentThread,
  NewCommentInput,
  SitePageSummary,
  StorageAdapter,
  UserProfile,
} from '../adapters/types';
import { createId, mergeThreadLists, resolvePageKey, type PageKeyStrategy } from '../adapters/localStorageAdapter';
import { SELF_NOTE_NAME } from '../adapters/authAdapter';

export const STORAGE_NS = 'marklet:v1';
export const INDEX_KEY = `${STORAGE_NS}:index`;
export const PAGES_KEY = `${STORAGE_NS}:pages`;
export const USER_KEY = `${STORAGE_NS}:user`;

export const threadsKeyFor = (pageKey: string) => `${STORAGE_NS}:threads:${pageKey}`;

export type PageSummary = SitePageSummary;

const PALETTE = ['#d97757', '#141413', '#6a9bcc', '#788c5d', '#b46927', '#8c6d8c', '#4d7c74', '#9a5b44'];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function resolvePageKeyFromUrl(urlStr: string, strategy: PageKeyStrategy = 'pathname'): string | null {
  try {
    const u = new URL(urlStr);
    if (!/^(https?:|file:)$/.test(u.protocol)) return null;
    return resolvePageKey(u, strategy);
  } catch {
    return null;
  }
}

/** Site key used for "Auto-enable on this site" (origin for web, "file://" for all local prototypes). */
export function resolveSiteKey(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    if (u.protocol === 'file:') return 'file://';
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Low-level chrome.storage.local helpers                             */
/* ------------------------------------------------------------------ */

async function getRaw<T>(key: string, fallback: T): Promise<T> {
  const res = await chrome.storage.local.get(key);
  return res[key] !== undefined ? (res[key] as T) : fallback;
}

async function setRaw(items: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set(items);
}

async function updatePageSummary(pageKey: string, threads: CommentThread[], fallbackUrl?: string, fallbackTitle?: string) {
  const pages = await getRaw<Record<string, PageSummary>>(PAGES_KEY, {});
  if (threads.length === 0) {
    delete pages[pageKey];
  } else {
    const existing = pages[pageKey];
    const openCount = threads.filter((t) => t.status === 'open').length;
    const latest = threads.reduce((acc, t) => (t.updatedAt > acc ? t.updatedAt : acc), threads[0].updatedAt);
    pages[pageKey] = {
      pageKey,
      url: fallbackUrl || threads[threads.length - 1].url || existing?.url || pageKey,
      title:
        fallbackTitle ||
        (typeof document !== 'undefined' && document.title ? document.title : existing?.title) ||
        pageKey,
      openCount,
      totalCount: threads.length,
      updatedAt: latest,
    };
  }
  await setRaw({ [PAGES_KEY]: pages });
}

/* ------------------------------------------------------------------ */
/* StorageAdapter                                                     */
/* ------------------------------------------------------------------ */

export function createChromeStorageAdapter(): StorageAdapter {
  const listeners = new Map<string, Set<(threads: CommentThread[]) => void>>();

  const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    const prefix = `${STORAGE_NS}:threads:`;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(prefix)) continue;
      const pageKey = key.slice(prefix.length);
      const set = listeners.get(pageKey);
      if (!set || set.size === 0) continue;
      const next = ((change.newValue as CommentThread[] | undefined) ?? [])
        .slice()
        .sort((a, b) => a.pinNumber - b.pinNumber);
      set.forEach((fn) => fn(clone(next)));
    }
  };

  chrome.storage.onChanged.addListener(handleStorageChange);

  const locate = async (threadId: string) => {
    const index = await getRaw<Record<string, string>>(INDEX_KEY, {});
    const pageKey = index[threadId];
    if (!pageKey) throw new Error(`[Marklet] thread ${threadId} not found`);
    const threads = await getRaw<CommentThread[]>(threadsKeyFor(pageKey), []);
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) throw new Error(`[Marklet] thread ${threadId} missing from page ${pageKey}`);
    return { pageKey, threads, thread, index };
  };

  return {
    async getComments(pageKey) {
      const threads = await getRaw<CommentThread[]>(threadsKeyFor(pageKey), []);
      return clone(threads).sort((a, b) => a.pinNumber - b.pinNumber);
    },

    async addComment(input: NewCommentInput) {
      const threads = await getRaw<CommentThread[]>(threadsKeyFor(input.pageKey), []);
      const now = new Date().toISOString();
      const thread: CommentThread = {
        id: createId('t_'),
        pageKey: input.pageKey,
        url: input.url,
        pinNumber: threads.reduce((max, t) => Math.max(max, t.pinNumber), 0) + 1,
        anchor: input.anchor,
        status: 'open',
        body: input.body,
        snapshotDataUrl: input.snapshotDataUrl,
        author: input.author,
        replies: [],
        createdAt: now,
        updatedAt: now,
      };
      threads.push(thread);
      const index = await getRaw<Record<string, string>>(INDEX_KEY, {});
      index[thread.id] = input.pageKey;
      await setRaw({
        [threadsKeyFor(input.pageKey)]: threads,
        [INDEX_KEY]: index,
      });
      await updatePageSummary(input.pageKey, threads, input.url);
      return clone(thread);
    },

    async addReply(threadId: string, body: string, author: UserProfile) {
      const { pageKey, threads, thread } = await locate(threadId);
      const reply: CommentReply = {
        id: createId('r_'),
        threadId,
        body,
        author,
        createdAt: new Date().toISOString(),
      };
      thread.replies.push(reply);
      thread.updatedAt = reply.createdAt;
      await setRaw({ [threadsKeyFor(pageKey)]: threads });
      await updatePageSummary(pageKey, threads);
      return clone(reply);
    },

    async resolveThread(threadId: string, by: UserProfile, resolved = true) {
      const { pageKey, threads, thread } = await locate(threadId);
      const now = new Date().toISOString();
      thread.status = resolved ? 'resolved' : 'open';
      thread.updatedAt = now;
      if (resolved) {
        thread.resolvedAt = now;
        thread.resolvedBy = by;
      } else {
        delete thread.resolvedAt;
        delete thread.resolvedBy;
      }
      await setRaw({ [threadsKeyFor(pageKey)]: threads });
      await updatePageSummary(pageKey, threads);
      return clone(thread);
    },

    async deleteThread(threadId: string) {
      const { pageKey, threads, index } = await locate(threadId);
      delete index[threadId];
      const next = threads.filter((t) => t.id !== threadId);
      await setRaw({
        [threadsKeyFor(pageKey)]: next,
        [INDEX_KEY]: index,
      });
      await updatePageSummary(pageKey, next);
    },

    async mergeComments(pageKey: string, pageUrl: string, incoming: CommentThread[]) {
      const existing = await getRaw<CommentThread[]>(threadsKeyFor(pageKey), []);
      const { threads, added, updated } = mergeThreadLists(existing, incoming, pageKey, pageUrl);
      if (added > 0 || updated > 0) {
        const index = await getRaw<Record<string, string>>(INDEX_KEY, {});
        for (const t of threads) index[t.id] = pageKey;
        await setRaw({
          [threadsKeyFor(pageKey)]: threads,
          [INDEX_KEY]: index,
        });
        await updatePageSummary(pageKey, threads, pageUrl);
      }
      return { added, updated };
    },

    async listSitePages(origin: string) {
      if (!/^https?:\/\//i.test(origin)) return [];
      const pages = await getRaw<Record<string, PageSummary>>(PAGES_KEY, {});
      return Object.values(pages)
        .filter((p) => p.totalCount > 0 && resolveSiteKey(p.url) === origin)
        .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
        .map((p) => ({ ...p }));
    },

    subscribe(pageKey, listener) {
      let set = listeners.get(pageKey);
      if (!set) listeners.set(pageKey, (set = new Set()));
      set.add(listener);
      return () => set!.delete(listener);
    },
  };
}

/* ------------------------------------------------------------------ */
/* AuthAdapter                                                        */
/* ------------------------------------------------------------------ */

export function createChromeAuthAdapter(): AuthAdapter {
  const listeners = new Set<(u: UserProfile) => void>();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[USER_KEY]?.newValue) return;
    const u = changes[USER_KEY].newValue as UserProfile;
    listeners.forEach((fn) => fn({ ...u }));
  });

  const load = async (): Promise<UserProfile> => {
    const existing = await getRaw<UserProfile | null>(USER_KEY, null);
    if (existing) return existing;
    const id = createId('u_');
    const fresh: UserProfile = { id, name: SELF_NOTE_NAME, mode: 'self-note', color: colorFor(id) };
    await setRaw({ [USER_KEY]: fresh });
    return fresh;
  };

  return {
    async getCurrentUser() {
      return { ...(await load()) };
    },
    async useSelfNote() {
      const cur = await load();
      const next: UserProfile = { ...cur, name: SELF_NOTE_NAME, mode: 'self-note' };
      await setRaw({ [USER_KEY]: next });
      return { ...next };
    },
    async setNickname(name: string) {
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed) return this.useSelfNote();
      const cur = await load();
      const next: UserProfile = { ...cur, name: trimmed, mode: 'named', color: colorFor(trimmed) };
      await setRaw({ [USER_KEY]: next });
      return { ...next };
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Popup & data management helpers                                    */
/* ------------------------------------------------------------------ */

export function isSafeHttpOrFileUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:';
  } catch {
    return false;
  }
}

export async function getPageComments(pageKey: string): Promise<CommentThread[]> {
  const threads = await getRaw<CommentThread[]>(threadsKeyFor(pageKey), []);
  return clone(threads).sort((a, b) => a.pinNumber - b.pinNumber);
}

export async function listRecentPages(): Promise<PageSummary[]> {
  const pages = await getRaw<Record<string, PageSummary>>(PAGES_KEY, {});
  return Object.values(pages).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
}

export async function deletePageComments(pageKey: string): Promise<void> {
  const threads = await getRaw<CommentThread[]>(threadsKeyFor(pageKey), []);
  const index = await getRaw<Record<string, string>>(INDEX_KEY, {});
  for (const t of threads) delete index[t.id];
  const pages = await getRaw<Record<string, PageSummary>>(PAGES_KEY, {});
  delete pages[pageKey];
  await chrome.storage.local.remove(threadsKeyFor(pageKey));
  await setRaw({ [INDEX_KEY]: index, [PAGES_KEY]: pages });
}

export async function clearAllData(): Promise<void> {
  await chrome.storage.local.clear();
}

export async function getStorageUsage(): Promise<{ bytesInUse: number; quotaBytes: number }> {
  const bytesInUse = await chrome.storage.local.getBytesInUse(null);
  const quotaBytes = chrome.storage.local.QUOTA_BYTES ?? 10 * 1024 * 1024;
  return { bytesInUse, quotaBytes };
}

export async function exportPageComments(pageKey: string): Promise<string> {
  const threads = await getRaw<CommentThread[]>(threadsKeyFor(pageKey), []);
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      pageKey,
      threads,
    },
    null,
    2,
  );
}

const SAFE_SNAPSHOT_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i;
const MAX_SNAPSHOT_LEN = 2 * 1024 * 1024; // 2 MB cap per image
const MAX_IMPORT_THREADS = 500;

function sanitizeUser(raw: unknown): UserProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : SELF_NOTE_NAME;
  const mode = r.mode === 'named' ? 'named' : 'self-note';
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 64) : createId('u_');
  const color = typeof r.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(r.color) ? r.color : colorFor(name);
  return { id, name, mode, color };
}

function sanitizeSnapshot(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw.length > MAX_SNAPSHOT_LEN) return undefined;
  return SAFE_SNAPSHOT_RE.test(raw) ? raw : undefined;
}

export async function importPageComments(pageKey: string, url: string, title: string, jsonText: string): Promise<number> {
  const parsed = JSON.parse(jsonText) as { threads?: unknown[] } | unknown[];
  const incoming = Array.isArray(parsed) ? parsed : parsed?.threads;
  if (!Array.isArray(incoming)) throw new Error('Invalid Marklet JSON format');

  const existing = await getRaw<CommentThread[]>(threadsKeyFor(pageKey), []);
  const existingIds = new Set(existing.map((t) => t.id));
  const index = await getRaw<Record<string, string>>(INDEX_KEY, {});
  let maxPin = existing.reduce((m, t) => Math.max(m, t.pinNumber), 0);
  let added = 0;

  for (const item of incoming.slice(0, MAX_IMPORT_THREADS)) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (!raw.anchor || typeof raw.anchor !== 'object' || typeof raw.body !== 'string') continue;
    const anchor = raw.anchor as CommentThread['anchor'];
    if (typeof anchor.selector !== 'string' || typeof anchor.tagName !== 'string' || !anchor.boundingBox) continue;

    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 64) : createId('t_');
    if (existingIds.has(id)) continue;

    const now = new Date().toISOString();
    const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt.slice(0, 40) : now;
    const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt.slice(0, 40) : createdAt;
    const rawReplies = Array.isArray(raw.replies) ? raw.replies : [];
    const replies: CommentReply[] = [];
    for (const rr of rawReplies.slice(0, 200)) {
      if (!rr || typeof rr !== 'object') continue;
      const rObj = rr as Record<string, unknown>;
      if (typeof rObj.body !== 'string') continue;
      replies.push({
        id: typeof rObj.id === 'string' && rObj.id.trim() ? rObj.id.trim().slice(0, 64) : createId('r_'),
        threadId: id,
        body: rObj.body.slice(0, 5000),
        author: sanitizeUser(rObj.author),
        createdAt: typeof rObj.createdAt === 'string' ? rObj.createdAt.slice(0, 40) : now,
      });
    }

    maxPin += 1;
    const thread: CommentThread = {
      id,
      pageKey,
      url: typeof raw.url === 'string' && isSafeHttpOrFileUrl(raw.url) ? raw.url : url,
      pinNumber: maxPin,
      anchor: clone(anchor),
      status: raw.status === 'resolved' ? 'resolved' : 'open',
      body: raw.body.slice(0, 5000),
      snapshotDataUrl: sanitizeSnapshot(raw.snapshotDataUrl),
      author: sanitizeUser(raw.author),
      replies,
      createdAt,
      updatedAt,
      ...(raw.status === 'resolved' && typeof raw.resolvedAt === 'string'
        ? { resolvedAt: raw.resolvedAt.slice(0, 40), resolvedBy: sanitizeUser(raw.resolvedBy) }
        : {}),
    };
    existing.push(thread);
    existingIds.add(id);
    index[thread.id] = pageKey;
    added += 1;
  }

  await setRaw({
    [threadsKeyFor(pageKey)]: existing,
    [INDEX_KEY]: index,
  });
  await updatePageSummary(pageKey, existing, url, title);
  return added;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
