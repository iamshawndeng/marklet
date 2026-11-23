import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  clearAllData,
  deletePageComments,
  exportPageComments,
  getPageComments,
  importPageComments,
  listRecentPages,
  resolvePageKeyFromUrl,
  resolveSiteKey,
  type PageSummary,
} from './chromeStorageAdapter';
import { getMsSession, MS_AUTH_KEY, type MsAuthSession } from './msAuth';
import { copyShareLinkToClipboard, encodeShareLink, hasShareHash } from '../core/shareLink';

const FEEDBACK_URL = 'https://github.com/iamshawndeng/marklet/issues';

const SendIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M13.5 2.5 7.25 8.75M13.5 2.5l-4 11-2.25-4.75L2.5 6.5l11-4Z" />
  </svg>
);

const HelpIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="8" cy="8" r="6" />
    <path d="M6.25 6.35a1.85 1.85 0 0 1 3.55.7c0 1.15-1.8 1.4-1.8 2.45" />
    <circle cx="8" cy="11.65" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

const StepIllustMark = () => (
  <svg class="guide-svg" viewBox="0 0 88 54" fill="none" aria-hidden="true">
    <rect x="4" y="6" width="80" height="42" rx="8" fill="var(--bg)" stroke="var(--border)" />
    <rect x="12" y="14" width="34" height="7" rx="3.5" fill="var(--bg-hover)" />
    <rect x="12" y="25" width="44" height="14" rx="5" fill="var(--brand-tint)" stroke="var(--brand)" stroke-width="1.25" />
    <rect x="18" y="30" width="24" height="4" rx="2" fill="var(--brand)" opacity="0.45" />
    <path d="M55 25c0-5 4-9 9-9s9 4 9 9-4 9-9 9h-7.5c-.83 0-1.5-.67-1.5-1.5V25Z" fill="var(--brand)" />
    <text x="64" y="28.5" text-anchor="middle" fill="#fff" font-size="9.5" font-weight="700" font-family="Inter, sans-serif">
      1
    </text>
  </svg>
);

const StepIllustSend = () => (
  <svg class="guide-svg" viewBox="0 0 88 54" fill="none" aria-hidden="true">
    <rect x="4" y="13" width="34" height="28" rx="8" fill="var(--bg)" stroke="var(--border)" />
    <circle cx="15" cy="24" r="4.5" fill="var(--brand)" />
    <rect x="22" y="21.5" width="11" height="2.5" rx="1.25" fill="var(--text-3)" opacity="0.7" />
    <rect x="22" y="26" width="8" height="2.5" rx="1.25" fill="var(--text-3)" opacity="0.4" />
    <path d="M41 27h8m0 0-3-3m3 3-3 3" stroke="var(--brand)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    <rect x="52" y="16" width="32" height="22" rx="7" fill="var(--brand-tint)" stroke="var(--brand)" stroke-width="1.2" />
    <path d="M72 22.5 66.5 28M72 22.5l-3.4 9-1.9-3.9-3.9-1.9 9.2-3.2Z" stroke="var(--brand)" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);

const StepIllustMerge = () => (
  <svg class="guide-svg" viewBox="0 0 88 54" fill="none" aria-hidden="true">
    <circle cx="16" cy="18" r="6" fill="#6a9bcc" />
    <circle cx="16" cy="36" r="6" fill="#788c5d" />
    <path d="M24 18c8 0 8 9 15 9M24 36c8 0 8-9 15-9" stroke="var(--border)" stroke-width="1.6" stroke-linecap="round" />
    <rect x="40" y="10" width="44" height="34" rx="8" fill="var(--bg)" stroke="var(--border)" />
    <rect x="46" y="16" width="22" height="4" rx="2" fill="var(--text-3)" opacity="0.65" />
    <rect x="46" y="23" width="30" height="4" rx="2" fill="var(--text-3)" opacity="0.4" />
    <rect x="46" y="31" width="32" height="8" rx="4" fill="var(--brand)" />
    <text x="62" y="37" text-anchor="middle" fill="#fff" font-size="6.8" font-weight="700" font-family="Inter, sans-serif">
      .ZIP AI
    </text>
  </svg>
);

const MicrosoftIcon = () => (
  <svg width="14" height="14" viewBox="0 0 21 21" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="9" height="9" fill="#F25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
    <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
  </svg>
);

const GoogleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      fill="#4285F4"
    />
    <path
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      fill="#34A853"
    />
    <path
      d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3-2.33Z"
      fill="#FBBC05"
    />
    <path
      d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      fill="#EA4335"
    />
  </svg>
);

interface TabInfo {
  id: number;
  url: string;
  title: string;
  pageKey: string;
  siteKey: string;
}

const BrandLogo = () => (
  <svg class="head-logo" viewBox="0 0 128 128" fill="none" aria-hidden="true">
    <rect width="128" height="128" rx="30" fill="#F0EEE6" />
    <path
      d="M34 44C34 35.1634 41.1634 28 50 28H68V94C68 98.4183 64.4183 102 60 102H42C37.5817 102 34 98.4183 34 94V44Z"
      fill="#141413"
    />
    <path
      d="M56 54C56 41.8497 65.8497 32 78 32C90.1503 32 100 41.8497 100 54C100 66.1503 90.1503 76 78 76H62C58.6863 76 56 73.3137 56 70V54Z"
      fill="#D97757"
      fill-opacity="0.94"
    />
  </svg>
);

function PopupApp() {
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [activeOnTab, setActiveOnTab] = useState(false);
  const [fileAccessAllowed, setFileAccessAllowed] = useState(true);
  const [recent, setRecent] = useState<PageSummary[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msSession, setMsSession] = useState<MsAuthSession | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const version = chrome.runtime.getManifest().version;

  const refresh = async () => {
    const [[active], pages, fileAllowed] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      listRecentPages(),
      new Promise<boolean>((resolve) => {
        if (chrome.extension?.isAllowedFileSchemeAccess) {
          chrome.extension.isAllowedFileSchemeAccess((allowed) => resolve(Boolean(allowed)));
        } else {
          resolve(true);
        }
      }),
    ]);

    setRecent(pages);
    setFileAccessAllowed(fileAllowed);

    if (active?.id !== undefined && active.url) {
      const pageKey = resolvePageKeyFromUrl(active.url);
      const siteKey = resolveSiteKey(active.url);
      if (pageKey && siteKey) {
        setTab({
          id: active.id,
          url: active.url,
          title: active.title || pageKey,
          pageKey,
          siteKey,
        });
        setUnsupported(false);

        try {
          const state = (await chrome.tabs.sendMessage(active.id, { type: 'MARKLET_GET_STATE' })) as
            | { enabled?: boolean }
            | undefined;
          setActiveOnTab(Boolean(state?.enabled));
        } catch {
          setActiveOnTab(false);
        }
        return;
      }
    }
    setTab(null);
    setActiveOnTab(false);
    setUnsupported(true);
  };

  useEffect(() => {
    refresh();
    getMsSession().then(setMsSession).catch(() => {});
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[MS_AUTH_KEY]) {
        setMsSession((changes[MS_AUTH_KEY].newValue as MsAuthSession | undefined) ?? null);
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

  const handleSignIn = async (provider: 'microsoft' | 'google') => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      const type = provider === 'google' ? 'MARKLET_GOOGLE_SIGN_IN' : 'MARKLET_MS_SIGN_IN';
      const res = (await chrome.runtime.sendMessage({ type })) as
        | { ok: true; session: MsAuthSession }
        | { ok: false; error: string }
        | undefined;
      if (res?.ok) {
        setMsSession(res.session);
        flashStatus(`Signed in as ${res.session.name}`);
      } else {
        flashStatus(res?.error || `${provider === 'google' ? 'Google' : 'Microsoft'} sign-in failed.`);
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleMsSignOut = async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      await chrome.runtime.sendMessage({ type: 'MARKLET_MS_SIGN_OUT' });
      setMsSession(null);
      flashStatus('Signed out.');
    } finally {
      setAuthBusy(false);
    }
  };

  const flashStatus = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 2600);
  };

  const openSidebar = async () => {
    if (!tab || busy) return;
    setBusy(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'MARKLET_ACTIVATE_TAB',
        tabId: tab.id,
        action: 'sidebar',
      })) as { ok?: boolean } | undefined;
      if (res?.ok) window.close();
    } finally {
      setBusy(false);
    }
  };

  const toggleReview = async () => {
    if (!tab || busy) return;
    setBusy(true);
    const hasShared = hasShareHash(tab.url);
    const action = activeOnTab ? 'disable' : hasShared ? 'sidebar' : 'enable';
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'MARKLET_ACTIVATE_TAB',
        tabId: tab.id,
        action,
      })) as { ok?: boolean } | undefined;
      if (res?.ok) {
        if (action === 'disable') {
          setActiveOnTab(false);
        } else {
          window.close();
        }
      } else {
        flashStatus(
          tab.siteKey === 'file://'
            ? 'Enable "Allow access to file URLs" in Extension settings.'
            : 'Cannot start review on this page.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleExportBackup = async () => {
    setMenuOpen(false);
    if (!tab) return;
    const json = await exportPageComments(tab.pageKey);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marklet-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flashStatus('Exported backup file.');
  };

  const handleSendFromPopup = async () => {
    if (!tab) return;
    const threads = await getPageComments(tab.pageKey);
    if (threads.length === 0) return;
    const sharedBy = msSession?.name || 'A teammate';
    const encoded = await encodeShareLink(tab.url, threads, sharedBy);
    if (encoded.tooLong) {
      await handleExportBackup();
      flashStatus('Too many comments for a link — downloaded .json file.');
      return;
    }
    const title = (tab.title || tab.pageKey).trim().slice(0, 50);
    const label = `Marklet feedback (${encoded.count} ${encoded.count === 1 ? 'comment' : 'comments'} on ${title})`;
    await copyShareLinkToClipboard(encoded.url, label);
    flashStatus('Link copied — paste in Teams, Slack, or email.');
  };

  const handleImportBackup = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !tab) return;
    try {
      const text = await file.text();
      const added = await importPageComments(tab.pageKey, tab.url, tab.title, text);
      await refresh();
      flashStatus(added > 0 ? `Restored ${added} comment${added === 1 ? '' : 's'}.` : 'No new comments to restore.');
    } catch {
      flashStatus('Invalid backup file.');
    }
  };

  const handleClearCurrentPage = async () => {
    setMenuOpen(false);
    if (!tab) return;
    await deletePageComments(tab.pageKey);
    await refresh();
    flashStatus('Cleared comments for this page.');
  };

  const handleClearAll = async () => {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      return;
    }
    setConfirmClearAll(false);
    setMenuOpen(false);
    await clearAllData();
    await refresh();
    flashStatus('All local data cleared.');
  };

  const openExtensionSettings = async () => {
    await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    window.close();
  };

  const handleFeedback = async () => {
    await chrome.tabs.create({ url: FEEDBACK_URL });
    window.close();
  };

  const currentSummary = tab ? recent.find((p) => p.pageKey === tab.pageKey) : undefined;
  const resolvedCount = currentSummary ? Math.max(0, currentSummary.totalCount - currentSummary.openCount) : 0;
  const needsFilePermission = Boolean(tab && tab.siteKey === 'file://' && !fileAccessAllowed);
  const hasSharedFeedback = Boolean(tab && hasShareHash(tab.url));

  return (
    <div
      onClick={() => {
        if (menuOpen) {
          setMenuOpen(false);
          setConfirmClearAll(false);
        }
      }}
    >
      <header class="head">
        <BrandLogo />
        <span class="brand">Marklet</span>
        <span class="ver">v{version}</span>
        <span class="spacer" />
        <button
          class={`more-btn${helpOpen ? ' is-active' : ''}`}
          title="How Marklet works"
          aria-label="How Marklet works"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(false);
            setConfirmClearAll(false);
            setHelpOpen(!helpOpen);
          }}
        >
          <HelpIcon />
        </button>
        <button
          class="more-btn"
          title="More"
          aria-label="More"
          onClick={(e) => {
            e.stopPropagation();
            setHelpOpen(false);
            setMenuOpen(!menuOpen);
            setConfirmClearAll(false);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3.5" cy="8" r="1.25" />
            <circle cx="8" cy="8" r="1.25" />
            <circle cx="12.5" cy="8" r="1.25" />
          </svg>
        </button>
        {menuOpen && (
          <div class="menu" onClick={(e) => e.stopPropagation()}>
            <button
              class="menu-item"
              disabled={!tab || !currentSummary || currentSummary.totalCount === 0}
              onClick={handleExportBackup}
            >
              Export JSON
            </button>
            <button
              class="menu-item"
              disabled={!tab}
              onClick={() => {
                setMenuOpen(false);
                fileRef.current?.click();
              }}
            >
              Import JSON
            </button>
            <button
              class="menu-item"
              onClick={() => {
                setMenuOpen(false);
                handleFeedback();
              }}
            >
              Feedback ↗
            </button>
            <div class="menu-sep" />
            <button
              class="menu-item danger"
              disabled={!tab || !currentSummary || currentSummary.totalCount === 0}
              onClick={handleClearCurrentPage}
            >
              Clear this page
            </button>
            <button
              class={`menu-item danger${confirmClearAll ? ' is-confirming' : ''}`}
              disabled={recent.length === 0}
              onClick={handleClearAll}
            >
              {confirmClearAll ? 'Confirm clear all?' : 'Clear all data'}
            </button>
          </div>
        )}
      </header>

      {helpOpen ? (
        <section class="guide-view" role="region" aria-label="How Marklet works">
          <div class="guide-head">
            <div>
              <div class="guide-title">How Marklet works</div>
              <div class="guide-sub">Zero-server async reviews for teams &amp; AI</div>
            </div>
            <button class="guide-close" aria-label="Close guide" onClick={() => setHelpOpen(false)}>
              ×
            </button>
          </div>

          <div class="guide-steps">
            <div class="guide-step">
              <StepIllustMark />
              <div class="guide-copy">
                <div class="guide-step-title">1. Mark any element</div>
                <div class="guide-step-desc">
                  Start review, press <kbd>C</kbd>, and leave comments on any webpage or prototype.
                </div>
              </div>
            </div>

            <div class="guide-step">
              <StepIllustSend />
              <div class="guide-copy">
                <div class="guide-step-title">2. Reviewers send a link</div>
                <div class="guide-step-desc">
                  Click <strong>Send</strong> to copy a feedback link and drop it in Teams, Slack, or email.
                </div>
              </div>
            </div>

            <div class="guide-step">
              <StepIllustMerge />
              <div class="guide-copy">
                <div class="guide-step-title">3. Owner merges &amp; exports</div>
                <div class="guide-step-desc">
                  Open each teammate&apos;s link to merge feedback, then export one <strong>.zip</strong> brief for AI.
                </div>
              </div>
            </div>
          </div>

          <div class="guide-foot">
            <div class="guide-keys">
              <span><kbd>C</kbd> Comment</span>
              <span><kbd>S</kbd> All comments</span>
              <span><kbd>Esc</kbd> Close</span>
            </div>
            <button class="guide-done" onClick={() => setHelpOpen(false)}>
              Got it
            </button>
          </div>
        </section>
      ) : (
        <>
          <section class="sec">
        {unsupported ? (
          <div class="note">Marklet works on web pages (http/https) and local HTML prototypes (file://).</div>
        ) : tab ? (
          <>
            <div class="page-title" title={tab.title}>
              {tab.title}
            </div>
            <div class="page-host" title={tab.pageKey}>
              {tab.siteKey === 'file://' ? tab.pageKey.replace(/^file:\/\//, '') : tab.siteKey}
            </div>

            {(activeOnTab || (currentSummary && currentSummary.totalCount > 0)) && (
              <div class="marks-meta">
                {activeOnTab && (
                  <span class="live-pill">
                    <span class="live-dot" />
                    Reviewing
                  </span>
                )}
                {currentSummary && currentSummary.openCount > 0 && (
                  <span class="mark-chip open">
                    {currentSummary.openCount} open {currentSummary.openCount === 1 ? 'comment' : 'comments'}
                  </span>
                )}
                {resolvedCount > 0 && (
                  <span class="mark-chip">
                    {resolvedCount} resolved
                    {!currentSummary || currentSummary.openCount === 0
                      ? resolvedCount === 1
                        ? ' comment'
                        : ' comments'
                      : ''}
                  </span>
                )}
              </div>
            )}

            {hasSharedFeedback && (
              <div class="share-banner">
                {activeOnTab
                  ? 'Shared comments are ready to review and merge in All comments.'
                  : 'Shared comments are ready to review and merge.'}
              </div>
            )}

            {needsFilePermission ? (
              <div class="warn-box">
                To review local HTML files, enable <strong>Allow access to file URLs</strong> in extension settings.
                <br />
                <button class="warn-link" onClick={openExtensionSettings}>
                  Open Extension Settings →
                </button>
              </div>
            ) : activeOnTab ? (
              <>
                {hasSharedFeedback ? (
                  <button class="primary-btn" disabled={busy} onClick={openSidebar}>
                    Show comments
                  </button>
                ) : currentSummary && currentSummary.totalCount > 0 ? (
                  <button class="primary-btn" disabled={busy} onClick={handleSendFromPopup}>
                    <SendIcon />
                    <span>
                      Send {currentSummary.totalCount} {currentSummary.totalCount === 1 ? 'comment' : 'comments'}
                    </span>
                  </button>
                ) : null}
                <button class="stop-btn" disabled={busy} onClick={toggleReview}>
                  {busy ? 'Stopping…' : 'Stop Review'}
                </button>
              </>
            ) : (
              <>
                <button class="primary-btn" disabled={busy} onClick={toggleReview}>
                  {busy ? 'Starting…' : hasSharedFeedback ? 'Review & Merge' : 'Start Review'}
                </button>
                {!hasSharedFeedback && currentSummary && currentSummary.totalCount > 0 && (
                  <button class="send-btn" onClick={handleSendFromPopup}>
                    <SendIcon />
                    <span>
                      Send {currentSummary.totalCount} {currentSummary.totalCount === 1 ? 'comment' : 'comments'}
                    </span>
                  </button>
                )}
              </>
            )}
          </>
        ) : null}
        {status && <div class="status">{status}</div>}
      </section>

      <section class="sec">
        {msSession ? (
          <div class="acct-row">
            {msSession.avatarDataUrl ? (
              <img class="acct-avatar" src={msSession.avatarDataUrl} alt={msSession.name} />
            ) : (
              <span class="acct-avatar acct-initial">{Array.from(msSession.name.trim())[0] ?? 'M'}</span>
            )}
            <div class="acct-main">
              <div class="acct-name" title={msSession.name}>
                {msSession.name}
              </div>
              <div class="acct-email" title={msSession.email}>
                {msSession.email}
              </div>
            </div>
            <button class="acct-signout" disabled={authBusy} onClick={handleMsSignOut}>
              Sign out
            </button>
          </div>
        ) : (
          <>
            <div class="auth-row">
              <button class="ms-btn" disabled={authBusy} onClick={() => handleSignIn('microsoft')}>
                <MicrosoftIcon />
                <span>{authBusy ? '…' : 'Microsoft'}</span>
              </button>
              <button class="ms-btn" disabled={authBusy} onClick={() => handleSignIn('google')}>
                <GoogleIcon />
                <span>{authBusy ? '…' : 'Google'}</span>
              </button>
            </div>
            <div class="ms-hint">Sign in to sync your name &amp; avatar (optional)</div>
          </>
        )}
      </section>

          <footer class="foot">
            <span class={`status-dot${activeOnTab ? ' active' : ''}`} />
            <span>
              {activeOnTab
                ? 'Saved privately on your device'
                : 'Start review to enable Marklet on this tab'}
            </span>
          </footer>
        </>
      )}

      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handleImportBackup} />
    </div>
  );
}

render(<PopupApp />, document.getElementById('app')!);
