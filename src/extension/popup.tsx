import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  clearAllData,
  deletePageComments,
  exportPageComments,
  importPageComments,
  isSafeHttpOrFileUrl,
  listRecentPages,
  resolvePageKeyFromUrl,
  resolveSiteKey,
  type PageSummary,
} from './chromeStorageAdapter';

const FEEDBACK_URL = 'https://x.com/shawnzpdeng';

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
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  }, []);

  const flashStatus = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 2600);
  };

  const toggleReview = async () => {
    if (!tab || busy) return;
    setBusy(true);
    const action = activeOnTab ? 'disable' : 'enable';
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

  const handleDeleteRecent = async (pageKey: string) => {
    await deletePageComments(pageKey);
    await refresh();
    flashStatus('Removed page comments.');
  };

  const openRecent = async (item: PageSummary) => {
    if (!isSafeHttpOrFileUrl(item.url)) {
      flashStatus('Blocked unsafe URL.');
      return;
    }
    await chrome.tabs.create({ url: item.url });
    window.close();
  };

  const openExtensionSettings = async () => {
    await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    window.close();
  };

  const handleFeedback = async () => {
    if (!FEEDBACK_URL) {
      flashStatus('Feedback link coming soon — set FEEDBACK_URL before release.');
      return;
    }
    await chrome.tabs.create({ url: FEEDBACK_URL });
    window.close();
  };

  const currentSummary = tab ? recent.find((p) => p.pageKey === tab.pageKey) : undefined;
  const resolvedCount = currentSummary ? Math.max(0, currentSummary.totalCount - currentSummary.openCount) : 0;
  const otherPages = recent.filter((p) => p.pageKey !== tab?.pageKey).slice(0, 5);
  const needsFilePermission = Boolean(tab && tab.siteKey === 'file://' && !fileAccessAllowed);

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
        <button class="head-feedback" title="Send feedback" onClick={handleFeedback}>
          Feedback ↗
        </button>
        <button
          class="more-btn"
          title="More"
          aria-label="More"
          onClick={(e) => {
            e.stopPropagation();
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
            <div class="menu-sep" />
            <button
              class="menu-item danger"
              disabled={!tab || !currentSummary || currentSummary.totalCount === 0}
              onClick={handleClearCurrentPage}
            >
              Clear this page
            </button>
            <button class="menu-item danger" disabled={recent.length === 0} onClick={handleClearAll}>
              {confirmClearAll ? 'Confirm clear all?' : 'Clear all data'}
            </button>
          </div>
        )}
      </header>

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

            {needsFilePermission ? (
              <div class="warn-box">
                To review local HTML files, enable <strong>Allow access to file URLs</strong> in extension settings.
                <br />
                <button class="warn-link" onClick={openExtensionSettings}>
                  Open Extension Settings →
                </button>
              </div>
            ) : activeOnTab ? (
              <button class="stop-btn" disabled={busy} onClick={toggleReview}>
                {busy ? 'Stopping…' : 'Stop Review'}
              </button>
            ) : (
              <button class="primary-btn" disabled={busy} onClick={toggleReview}>
                {busy ? 'Starting…' : 'Start Review'}
              </button>
            )}
          </>
        ) : null}
      </section>

      {otherPages.length > 0 && (
        <section class="sec">
          <div class="sec-label">Recent pages</div>
          <div class="recent-list">
            {otherPages.map((item) => (
              <div key={item.pageKey} class="recent-row">
                <button class="recent-item" onClick={() => openRecent(item)}>
                  <div class="recent-main">
                    <div class="recent-title">{item.title}</div>
                    <div class="recent-sub">{item.pageKey}</div>
                  </div>
                  <span class={`pill${item.openCount > 0 ? ' open' : ''}`}>
                    {item.openCount > 0 ? item.openCount : `${item.totalCount} ✓`}
                  </span>
                </button>
                <button
                  class="del-btn"
                  title="Delete comments"
                  aria-label={`Delete comments for ${item.title}`}
                  onClick={() => handleDeleteRecent(item.pageKey)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {status && <div class="status">{status}</div>}

      <footer class="foot">
        <span class={`status-dot${activeOnTab ? ' active' : ''}`} />
        <span>
          {activeOnTab
            ? 'Saved privately on your device'
            : 'Start review to enable Marklet on this tab'}
        </span>
      </footer>

      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handleImportBackup} />
    </div>
  );
}

render(<PopupApp />, document.getElementById('app')!);
