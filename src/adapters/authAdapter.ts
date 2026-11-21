import type { AuthAdapter, UserProfile } from './types';
import { createId, type KeyValueStore } from './localStorageAdapter';

export const SELF_NOTE_NAME = 'Self Note';

const PALETTE = ['#d97757', '#141413', '#6a9bcc', '#788c5d', '#b46927', '#8c6d8c', '#4d7c74', '#9a5b44'];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export interface LocalAuthAdapterOptions {
  store?: KeyValueStore;
  storageKey?: string;
}

/**
 * Simplest possible identity: a locally stored profile.
 *  - "设计师自注 Self Note" mode (default) for designers annotating their own prototype.
 *  - Named mode with a free-form nickname for reviewers.
 *
 * Swap for an SSO / OAuth adapter later without touching src/core.
 */
export function createLocalAuthAdapter(options: LocalAuthAdapterOptions = {}): AuthAdapter {
  const store: KeyValueStore = options.store ?? safeLocalStorage();
  const key = options.storageKey ?? 'marklet:v1:user';
  const listeners = new Set<(u: UserProfile) => void>();

  const load = (): UserProfile => {
    try {
      const raw = store.getItem(key);
      if (raw) return JSON.parse(raw) as UserProfile;
    } catch {
      /* ignore corrupt value */
    }
    const id = createId('u_');
    const fresh: UserProfile = { id, name: SELF_NOTE_NAME, mode: 'self-note', color: colorFor(id) };
    save(fresh);
    return fresh;
  };

  const save = (u: UserProfile) => {
    try {
      store.setItem(key, JSON.stringify(u));
    } catch {
      /* storage may be blocked – keep in memory */
    }
    listeners.forEach((fn) => fn({ ...u }));
  };

  let current: UserProfile | null = null;
  const get = () => (current ??= load());

  return {
    async getCurrentUser() {
      return { ...get() };
    },
    async useSelfNote() {
      current = { ...get(), name: SELF_NOTE_NAME, mode: 'self-note' };
      save(current);
      return { ...current };
    },
    async setNickname(name: string) {
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed) return this.useSelfNote();
      current = { ...get(), name: trimmed, mode: 'named', color: colorFor(trimmed) };
      save(current);
      return { ...current };
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function safeLocalStorage(): KeyValueStore {
  try {
    return globalThis.localStorage;
  } catch {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
  }
}
