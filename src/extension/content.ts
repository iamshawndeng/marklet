/**
 * Marklet · extension shell (content script)
 *
 * Responsibilities:
 *   1. Create an isolated host <div> + ShadowRoot (promoted to Top Layer via Popover API).
 *   2. Inject styles.
 *   3. Choose & inject adapters (chrome.storage.local in extension runtime; localStorage fallback for ?harness).
 *   4. Mount OverlayApp, sync pageKey with SPA navigation, and listen to Popup activation messages.
 */
import { h, render } from 'preact';
import { OverlayApp, overlayCss, type OverlayController } from '../core';
import { createLocalStorageAdapter, resolvePageKey, type PageKeyStrategy } from '../adapters/localStorageAdapter';
import { createLocalAuthAdapter } from '../adapters/authAdapter';
import { createChromeAuthAdapter, createChromeStorageAdapter } from './chromeStorageAdapter';

const HOST_ID = 'marklet-host';
const ENABLED_KEY = 'marklet:v1:enabled';
const SIDEBAR_KEY = 'marklet:v1:sidebarOpen';
const PAGE_KEY_STRATEGY: PageKeyStrategy = 'pathname';

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function readSidebarOpen(): boolean | undefined {
  try {
    const val = sessionStorage.getItem(SIDEBAR_KEY);
    if (val === '1') return true;
    if (val === '0') return false;
    return undefined;
  } catch {
    return undefined;
  }
}

function writeSidebarOpen(open: boolean): void {
  try {
    sessionStorage.setItem(SIDEBAR_KEY, open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function isHtmlDocument(): boolean {
  return document.documentElement?.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

function bootstrap(): void {
  if (window.top !== window) return; // top frame only
  if (!isHtmlDocument()) return; // skip raw XML / SVG / JSON viewers
  if (document.getElementById(HOST_ID)) return; // already injected

  // 1. Host + ShadowRoot ------------------------------------------------
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-marklet', 'host');
  host.style.cssText =
    'all:initial !important;position:fixed !important;top:0 !important;left:0 !important;' +
    'width:0 !important;height:0 !important;margin:0 !important;padding:0 !important;' +
    'border:0 !important;background:transparent !important;overflow:visible !important;' +
    'z-index:2147483647 !important;display:block !important;';

  // Promote host into the browser Top Layer (Popover API) so it stays above native <dialog>.showModal()
  const promoteTopLayer = () => {
    const el = host as HTMLElement & { showPopover?: () => void; hidePopover?: () => void };
    if (typeof el.showPopover !== 'function') return;
    try {
      if (!host.hasAttribute('popover')) host.setAttribute('popover', 'manual');
      if (host.matches(':popover-open')) el.hidePopover?.();
      el.showPopover();
    } catch {
      /* ignore if document not ready or unsupported */
    }
  };

  const shadow = host.attachShadow({ mode: 'open' });

  // 2. Styles -----------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = overlayCss;
  shadow.appendChild(style);
  const container = document.createElement('div');
  shadow.appendChild(container);
  document.documentElement.appendChild(host);
  promoteTopLayer();

  // Re-promote above any newly opened native <dialog>
  const dialogObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'open' && (m.target as Element).tagName === 'DIALOG') {
        if ((m.target as HTMLDialogElement).open) promoteTopLayer();
      }
    }
  });
  dialogObserver.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });

  // 3. Adapters & visual snapshot capturer ------------------------------
  const inExtension = hasChromeStorage();
  const storage = inExtension ? createChromeStorageAdapter() : createLocalStorageAdapter();
  const auth = inExtension ? createChromeAuthAdapter() : createLocalAuthAdapter();
  const defaultEnabled = readEnabled();
  const defaultSidebarOpen = readSidebarOpen();
  let controller: OverlayController | null = null;
  const pendingActions: Array<(ctrl: OverlayController) => void> = [];

  const runController = (fn: (ctrl: OverlayController) => void) => {
    if (controller) fn(controller);
    else pendingActions.push(fn);
  };

  const captureSnapshot = inExtension
    ? async (rect: DOMRect): Promise<string | undefined> => {
        // Temporarily hide Marklet's own UI so the crop shows the clean target element
        const prevVis = host.style.visibility;
        host.style.visibility = 'hidden';
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        let rawUrl: string | undefined;
        try {
          const res = (await chrome.runtime.sendMessage({ type: 'MARKLET_CAPTURE_TAB' })) as
            | { dataUrl?: string }
            | undefined;
          rawUrl = res?.dataUrl;
        } finally {
          host.style.visibility = prevVis;
        }
        if (!rawUrl) return undefined;

        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const dpr = img.naturalWidth / Math.max(1, window.innerWidth);
            const pad = 36;
            const sx = Math.max(0, Math.floor((rect.left - pad) * dpr));
            const sy = Math.max(0, Math.floor((rect.top - pad) * dpr));
            const ex = Math.min(img.naturalWidth, Math.ceil((rect.right + pad) * dpr));
            const ey = Math.min(img.naturalHeight, Math.ceil((rect.bottom + pad) * dpr));
            const sw = Math.max(1, ex - sx);
            const sh = Math.max(1, ey - sy);

            // Cap max export width at 720px so storage & zip bundles stay fast and lean
            const scale = Math.min(1, 720 / sw);
            const cw = Math.max(1, Math.round(sw * scale));
            const ch = Math.max(1, Math.round(sh * scale));

            const canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(undefined);

            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
            // Draw crisp terracotta highlight box around the exact pinned element
            const bx = (rect.left * dpr - sx) * scale;
            const by = (rect.top * dpr - sy) * scale;
            const bw = rect.width * dpr * scale;
            const bh = rect.height * dpr * scale;
            ctx.strokeStyle = '#C96442';
            ctx.lineWidth = Math.max(2, 2 * scale * dpr);
            ctx.strokeRect(bx, by, bw, bh);

            resolve(canvas.toDataURL('image/jpeg', 0.86));
          };
          img.onerror = () => resolve(undefined);
          img.src = rawUrl!;
        });
      }
    : undefined;

  // 4. Mount ------------------------------------------------------------
  let currentHref = '';
  let badgeUnsub: (() => void) | null = null;

  const syncBadgeForPage = (pageKey: string) => {
    if (!inExtension || !chrome.runtime?.sendMessage) return;
    const pushCount = (list: { status: string }[]) => {
      const openCount = list.filter((t) => t.status === 'open').length;
      chrome.runtime.sendMessage({ type: 'MARKLET_SYNC_BADGE', count: openCount }).catch(() => {
        /* ignore if service worker is inactive */
      });
    };
    badgeUnsub?.();
    storage.getComments(pageKey).then(pushCount).catch(() => {});
    badgeUnsub = storage.subscribe?.(pageKey, pushCount) ?? null;
  };

  const handleEnabledChange = (next: boolean) => {
    writeEnabled(next);
    if (inExtension && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'MARKLET_SET_TAB_ACTIVE', active: next }).catch(() => {});
    }
  };

  const handleNavigatePage = (url: string) => {
    if (inExtension && chrome.runtime?.sendMessage) {
      chrome.runtime
        .sendMessage({ type: 'MARKLET_NAVIGATE_AND_RESUME', url })
        .then((res) => {
          if (!(res as { ok?: boolean } | undefined)?.ok) window.location.assign(url);
        })
        .catch(() => window.location.assign(url));
    } else {
      window.location.assign(url);
    }
  };

  const renderApp = () => {
    currentHref = location.href;
    const pageKey = resolvePageKey(location, PAGE_KEY_STRATEGY);
    render(
      h(OverlayApp, {
        storage,
        auth,
        pageKey,
        pageUrl: location.href,
        hostElement: host,
        defaultEnabled,
        defaultSidebarOpen,
        hideFabWhenDisabled: inExtension,
        onEnabledChange: handleEnabledChange,
        onSidebarOpenChange: writeSidebarOpen,
        onNavigatePage: handleNavigatePage,
        captureSnapshot,
        onControllerReady: (ctrl) => {
          controller = ctrl;
          while (pendingActions.length > 0) {
            pendingActions.shift()?.(ctrl);
          }
        },
      }),
      container,
    );
    syncBadgeForPage(pageKey);
  };
  renderApp();

  // Listen for activation messages from the extension popup / background worker
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return false;
      if (msg.type === 'MARKLET_GET_STATE') {
        sendResponse({ injected: true, enabled: controller?.getEnabled() ?? false });
        return false;
      }
      if (msg.type === 'MARKLET_SET_ENABLED') {
        const next = Boolean(msg.enabled);
        runController((ctrl) => ctrl.setEnabled(next));
        sendResponse({ ok: true });
        return false;
      }
      if (msg.type === 'MARKLET_START_PICKING') {
        runController((ctrl) => ctrl.startPicking());
        sendResponse({ ok: true });
        return false;
      }
      if (msg.type === 'MARKLET_OPEN_SIDEBAR') {
        writeSidebarOpen(true);
        runController((ctrl) => ctrl.openSidebar());
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });
  }

  // Keep pageKey in sync with SPA navigation & re-attach if the page wipes our host.
  const sync = () => {
    if (!host.isConnected) {
      document.documentElement.appendChild(host);
      promoteTopLayer();
    }
    if (location.href !== currentHref) renderApp();
  };
  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);
  window.setInterval(sync, 1000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
