/**
 * Marklet · MV3 background service worker (least-privilege)
 *
 * Zero background tab monitoring, zero host_permissions, zero network requests.
 * Only activates when the user explicitly invokes Marklet on the active tab:
 *   1. MARKLET_ACTIVATE_TAB  -> on-demand injection of content.js via activeTab + scripting.
 *   2. MARKLET_CAPTURE_TAB   -> captures visible viewport for cropped element snapshots (activeTab).
 *   3. MARKLET_SYNC_BADGE    -> updates the per-tab toolbar badge for active annotated tabs.
 */

const BADGE_BG = '#C96442';

type ActivateAction = 'enable' | 'disable' | 'pick' | 'sidebar';

async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
}

async function setBadgeCount(tabId: number, count: number): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_BG });
    await chrome.action.setBadgeText({
      tabId,
      text: count > 0 ? (count > 99 ? '99+' : String(count)) : '',
    });
  } catch {
    /* tab may have closed */
  }
}

async function activateOnTab(tabId: number, action: ActivateAction): Promise<boolean> {
  try {
    await injectContentScript(tabId);
    if (action === 'pick') {
      await chrome.tabs.sendMessage(tabId, { type: 'MARKLET_START_PICKING' });
    } else if (action === 'sidebar') {
      await chrome.tabs.sendMessage(tabId, { type: 'MARKLET_OPEN_SIDEBAR' });
    } else {
      await chrome.tabs.sendMessage(tabId, {
        type: 'MARKLET_SET_ENABLED',
        enabled: action === 'enable',
      });
    }
    return true;
  } catch (err) {
    console.warn('[Marklet] unable to activate on tab', tabId, err);
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'MARKLET_ACTIVATE_TAB' && typeof msg.tabId === 'number') {
    const action: ActivateAction =
      msg.action === 'pick' || msg.action === 'sidebar' || msg.action === 'disable'
        ? msg.action
        : msg.enabled === false
          ? 'disable'
          : 'enable';
    activateOnTab(msg.tabId, action).then((ok) => sendResponse({ ok }));
    return true;
  }

  if (msg.type === 'MARKLET_CAPTURE_TAB' && sender.tab?.windowId !== undefined) {
    chrome.tabs
      .captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch(() => sendResponse({ dataUrl: undefined }));
    return true;
  }

  if (msg.type === 'MARKLET_SYNC_BADGE' && sender.tab?.id !== undefined) {
    const count = typeof msg.count === 'number' && Number.isFinite(msg.count) ? Math.max(0, Math.floor(msg.count)) : 0;
    setBadgeCount(sender.tab.id, count);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
