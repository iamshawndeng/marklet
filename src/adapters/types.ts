/**
 * Marklet data contracts.
 *
 * These types are the boundary between the pure front-end engine (src/core) and any
 * persistence / identity backend (localStorage today; chrome.storage, VS Code
 * Webview postMessage, or an enterprise REST/WebSocket service tomorrow).
 *
 * Keep this file free of runtime code and of any platform API.
 */

/* ------------------------------------------------------------------ */
/* Identity                                                           */
/* ------------------------------------------------------------------ */

export type UserMode = 'self-note' | 'named';

export interface UserProfile {
  /** Stable id. Local adapters generate one; enterprise adapters use the IdP subject. */
  id: string;
  /** Display name, e.g. "Self Note" or "Alice". */
  name: string;
  mode: UserMode;
  /** Optional avatar accent color (CSS color). */
  color?: string;
  avatarUrl?: string;
}

export interface AuthAdapter {
  getCurrentUser(): Promise<UserProfile>;
  /** Switch to "designer self-note" mode. */
  useSelfNote(): Promise<UserProfile>;
  /** Switch to a named reviewer. */
  setNickname(name: string): Promise<UserProfile>;
  /** Subscribe to identity changes. Returns an unsubscribe function. */
  onChange?(listener: (user: UserProfile) => void): () => void;
}

/* ------------------------------------------------------------------ */
/* Anchors                                                            */
/* ------------------------------------------------------------------ */

export type AnchorStrategy = 'testid' | 'id' | 'semantic' | 'path';

/** Geometry captured at comment time, used as a last-resort fallback and for drift detection. */
export interface AnchorBoundingBox {
  /** Absolute document coordinates (px) at capture time. */
  pageX: number;
  pageY: number;
  width: number;
  height: number;
  /** Same box expressed as ratios (0..1) of the document scroll size – survives zoom / resize better. */
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  /** Document & viewport size at capture time. */
  docWidth: number;
  docHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

/** Optional context captured when the pinned element lives inside a dialog, drawer, or collapsible panel. */
export interface AnchorOverlayContext {
  kind: 'dialog' | 'drawer' | 'collapsible';
  /** Human-readable title of the overlay (e.g. dialog heading or <summary> text). */
  title?: string;
  /** Selector of the button/element the user clicked right before the overlay opened, if known. */
  triggerSelector?: string;
  triggerLabel?: string;
}

/**
 * Composite anchor. Resolution tries the strongest signal first
 * (data-testid → id → semantic selector → structural path) and validates the
 * candidate against tagName / text; geometry is the final fallback.
 */
export interface ElementAnchor {
  strategy: AnchorStrategy;
  /** Best selector produced by `strategy`. */
  selector: string;
  /** Pure structural (nth-of-type) path from <body>, always present as a fallback. */
  pathSelector: string;
  testId?: string;
  /** Which attribute held the test id (data-testid, data-test, data-cy...). */
  testIdAttr?: string;
  elementId?: string;
  tagName: string;
  /** First 30 visible characters (whitespace-collapsed). */
  textSnippet: string;
  /** A few stable attributes (role, name, aria-label, type, placeholder, href) for fuzzy matching. */
  attributes?: Record<string, string>;
  /** Set when the pinned element was inside a modal, drawer, or <details> panel. */
  overlayContext?: AnchorOverlayContext;
  boundingBox: AnchorBoundingBox;
}

/* ------------------------------------------------------------------ */
/* Comments                                                           */
/* ------------------------------------------------------------------ */

export type ThreadStatus = 'open' | 'resolved';

export interface CommentReply {
  id: string;
  threadId: string;
  body: string;
  author: UserProfile;
  createdAt: string; // ISO-8601
}

export interface CommentThread {
  id: string;
  /** Isolation key for the page (e.g. origin + pathname, or file path). */
  pageKey: string;
  /** Full URL where the thread was created (informational). */
  url: string;
  /** Human-friendly sequence number per page, shown on the pin. */
  pinNumber: number;
  anchor: ElementAnchor;
  status: ThreadStatus;
  /** First message of the thread. */
  body: string;
  /** Optional cropped screenshot of the pinned element (data URL) for visual context & AI briefs. */
  snapshotDataUrl?: string;
  author: UserProfile;
  replies: CommentReply[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedBy?: UserProfile;
}

export interface NewCommentInput {
  pageKey: string;
  url: string;
  anchor: ElementAnchor;
  body: string;
  snapshotDataUrl?: string;
  author: UserProfile;
}

/* ------------------------------------------------------------------ */
/* Storage                                                            */
/* ------------------------------------------------------------------ */

export interface SitePageSummary {
  pageKey: string;
  url: string;
  title: string;
  openCount: number;
  totalCount: number;
  updatedAt: string;
}

export interface StorageAdapter {
  /** All threads for a page, ordered by pinNumber. */
  getComments(pageKey: string): Promise<CommentThread[]>;
  addComment(input: NewCommentInput): Promise<CommentThread>;
  addReply(threadId: string, body: string, author: UserProfile): Promise<CommentReply>;
  /**
   * Mark a thread resolved (default) or reopen it with `resolved = false`.
   */
  resolveThread(threadId: string, by: UserProfile, resolved?: boolean): Promise<CommentThread>;

  /* ---- optional capabilities ---- */
  deleteThread?(threadId: string): Promise<void>;
  /** Merge incoming threads (e.g. from a teammate's share link) into this page without overwriting existing comments. */
  mergeComments?(
    pageKey: string,
    pageUrl: string,
    incoming: CommentThread[],
  ): Promise<{ added: number; updated: number }>;
  /** List pages on the same web origin (`http:`/`https:`) that have comments. */
  listSitePages?(origin: string): Promise<SitePageSummary[]>;
  /** Push-style updates (other tabs, realtime backends). Returns an unsubscribe function. */
  subscribe?(pageKey: string, listener: (threads: CommentThread[]) => void): () => void;
}
