import type {
  CommentReply,
  CommentThread,
  NewCommentInput,
  StorageAdapter,
  UserProfile,
} from './types';

/** Minimal subset of the Web Storage API – lets tests or other hosts inject their own store. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PageKeyStrategy =
  /** origin + pathname (default) – query/hash ignored. */
  | 'pathname'
  /** origin + pathname + search – useful when prototypes route via ?page=... */
  | 'pathname+search'
  /** full href including hash – for hash-routed SPA prototypes. */
  | 'url';

export interface LocalStorageAdapterOptions {
  store?: KeyValueStore;
  namespace?: string;
}

interface LocationLike {
  protocol: string;
  origin: string;
  pathname: string;
  search: string;
  hash: string;
}

/**
 * Derive the per-page isolation key.
 * `file://` pages all share one localStorage origin in Chromium, so the absolute
 * file path is what keeps two local prototypes apart.
 */
export function resolvePageKey(loc: LocationLike, strategy: PageKeyStrategy = 'pathname'): string {
  const base = loc.protocol === 'file:' ? `file://${decodeURI(loc.pathname)}` : `${loc.origin}${loc.pathname}`;
  switch (strategy) {
    case 'pathname':
      return base;
    case 'pathname+search':
      return base + loc.search;
    case 'url':
      return base + loc.search + loc.hash;
  }
}

export function createId(prefix = ''): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  const raw =
    c && typeof c.randomUUID === 'function'
      ? c.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix + raw;
}

/** In-memory fallback for sandboxed iframes / pages where localStorage throws. */
export function createMemoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function defaultStore(): KeyValueStore {
  try {
    const ls = globalThis.localStorage;
    const probe = '__marklet_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    console.warn('[Marklet] localStorage unavailable, falling back to in-memory storage.');
    return createMemoryStore();
  }
}

/**
 * StorageAdapter backed by the page's localStorage.
 *
 * Layout:
 *   `${ns}:threads:${pageKey}`  -> CommentThread[]
 *   `${ns}:index`               -> { [threadId]: pageKey }
 *
 * Note: content scripts share localStorage with the host page's origin. For
 * cross-origin sync swap this for a chrome.storage / remote adapter in src/extension.
 */
export function createLocalStorageAdapter(options: LocalStorageAdapterOptions = {}): StorageAdapter {
  const store = options.store ?? defaultStore();
  const ns = options.namespace ?? 'marklet:v1';
  const threadsKey = (pageKey: string) => `${ns}:threads:${pageKey}`;
  const indexKey = `${ns}:index`;
  const listeners = new Map<string, Set<(t: CommentThread[]) => void>>();

  const readJson = <T>(key: string, fallback: T): T => {
    try {
      const raw = store.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  };

  const readThreads = (pageKey: string) => readJson<CommentThread[]>(threadsKey(pageKey), []);
  const readIndex = () => readJson<Record<string, string>>(indexKey, {});

  const writeThreads = (pageKey: string, threads: CommentThread[]) => {
    store.setItem(threadsKey(pageKey), JSON.stringify(threads));
    emit(pageKey, threads);
  };

  const emit = (pageKey: string, threads: CommentThread[]) => {
    listeners.get(pageKey)?.forEach((fn) => fn(clone(threads)));
  };

  const locate = (threadId: string): { pageKey: string; threads: CommentThread[]; thread: CommentThread } => {
    const pageKey = readIndex()[threadId];
    if (!pageKey) throw new Error(`[Marklet] thread ${threadId} not found`);
    const threads = readThreads(pageKey);
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) throw new Error(`[Marklet] thread ${threadId} missing from page ${pageKey}`);
    return { pageKey, threads, thread };
  };

  // Cross-tab sync (same origin) via the native `storage` event.
  if (typeof window !== 'undefined' && store === globalThis.localStorage) {
    window.addEventListener('storage', (e) => {
      if (!e.key || !e.key.startsWith(`${ns}:threads:`)) return;
      const pageKey = e.key.slice(`${ns}:threads:`.length);
      emit(pageKey, readThreads(pageKey));
    });
  }

  return {
    async getComments(pageKey) {
      return clone(readThreads(pageKey)).sort((a, b) => a.pinNumber - b.pinNumber);
    },

    async addComment(input: NewCommentInput) {
      const threads = readThreads(input.pageKey);
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
      const index = readIndex();
      index[thread.id] = input.pageKey;
      store.setItem(indexKey, JSON.stringify(index));
      writeThreads(input.pageKey, threads);
      return clone(thread);
    },

    async addReply(threadId: string, body: string, author: UserProfile) {
      const { pageKey, threads, thread } = locate(threadId);
      const reply: CommentReply = {
        id: createId('r_'),
        threadId,
        body,
        author,
        createdAt: new Date().toISOString(),
      };
      thread.replies.push(reply);
      thread.updatedAt = reply.createdAt;
      writeThreads(pageKey, threads);
      return clone(reply);
    },

    async resolveThread(threadId: string, by: UserProfile, resolved = true) {
      const { pageKey, threads, thread } = locate(threadId);
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
      writeThreads(pageKey, threads);
      return clone(thread);
    },

    async deleteThread(threadId: string) {
      const { pageKey, threads } = locate(threadId);
      const index = readIndex();
      delete index[threadId];
      store.setItem(indexKey, JSON.stringify(index));
      writeThreads(
        pageKey,
        threads.filter((t) => t.id !== threadId),
      );
    },

    async mergeComments(pageKey: string, pageUrl: string, incoming: CommentThread[]) {
      const existing = readThreads(pageKey);
      const { threads, added, updated } = mergeThreadLists(existing, incoming, pageKey, pageUrl);
      if (added > 0 || updated > 0) {
        const index = readIndex();
        for (const t of threads) index[t.id] = pageKey;
        store.setItem(indexKey, JSON.stringify(index));
        writeThreads(pageKey, threads);
      }
      return { added, updated };
    },

    subscribe(pageKey, listener) {
      let set = listeners.get(pageKey);
      if (!set) listeners.set(pageKey, (set = new Set()));
      set.add(listener);
      return () => set!.delete(listener);
    },
  };
}

/**
 * Pure merge helper: merges incoming threads into existing page threads by `id`.
 * - New threads get sequential pin numbers after the current max.
 * - Existing threads receive any unseen replies (deduped by reply id) and newer status updates.
 */
export function mergeThreadLists(
  existing: CommentThread[],
  incoming: CommentThread[],
  pageKey: string,
  pageUrl: string,
): { threads: CommentThread[]; added: number; updated: number } {
  const result = clone(existing);
  const byId = new Map<string, CommentThread>(result.map((t) => [t.id, t]));
  let maxPin = result.reduce((m, t) => Math.max(m, t.pinNumber), 0);
  let added = 0;
  let updated = 0;

  for (const inc of incoming) {
    const cur = byId.get(inc.id);
    if (!cur) {
      const nextThread: CommentThread = {
        ...clone(inc),
        pageKey,
        url: pageUrl,
        pinNumber: ++maxPin,
      };
      result.push(nextThread);
      byId.set(nextThread.id, nextThread);
      added++;
      continue;
    }

    let changed = false;
    const replyIds = new Set(cur.replies.map((r) => r.id));
    for (const r of inc.replies) {
      if (!replyIds.has(r.id)) {
        cur.replies.push({ ...clone(r), threadId: cur.id });
        replyIds.add(r.id);
        changed = true;
      }
    }
    if (changed) {
      cur.replies.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
    }
    if (inc.updatedAt > cur.updatedAt) {
      if (inc.status !== cur.status) {
        cur.status = inc.status;
        cur.resolvedAt = inc.resolvedAt;
        cur.resolvedBy = inc.resolvedBy ? clone(inc.resolvedBy) : undefined;
        changed = true;
      }
      if (changed) cur.updatedAt = inc.updatedAt;
    }
    if (changed) updated++;
  }

  result.sort((a, b) => a.pinNumber - b.pinNumber);
  return { threads: result, added, updated };
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
