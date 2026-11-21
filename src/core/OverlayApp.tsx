/**
 * Marklet core · OverlayApp
 *
 * Figma UI3-inspired commenting overlay rendered inside an isolated Shadow DOM.
 * Talks to persistence / identity exclusively through injected `StorageAdapter`
 * and `AuthAdapter` – never through chrome.* APIs.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type {
  AuthAdapter,
  CommentThread,
  ElementAnchor,
  StorageAdapter,
  UserProfile,
} from '../adapters/types';
import { ElementPicker, describeElement, detectOverlayContext, generateAnchor, resolveAnchor, type ResolvedAnchor } from './anchor';
import { buildAiIterationMarkdown, buildAiIterationZip } from './exportPrompt';

export interface OverlayController {
  setEnabled(enabled: boolean): void;
  getEnabled(): boolean;
  startPicking(): void;
  openSidebar(): void;
}

export interface OverlayAppProps {
  storage: StorageAdapter;
  auth: AuthAdapter;
  /** Isolation key for the current page (see adapters/localStorageAdapter#resolvePageKey). */
  pageKey: string;
  pageUrl: string;
  /** Shadow host element – excluded from picking and click-outside detection. */
  hostElement: Element;
  defaultEnabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  /** Optional imperative handle so host shells (extension popup, VS Code command) can toggle the overlay. */
  onControllerReady?: (controller: OverlayController) => void;
  /** Hide the bottom-right floating launcher when disabled (used by extension mode where the toolbar popup opens Marklet). */
  hideFabWhenDisabled?: boolean;
  /** Optional host-provided screenshot capturer for visual context in threads & AI briefs. */
  captureSnapshot?: (rect: DOMRect) => Promise<string | undefined>;
}

interface Draft {
  element: Element;
  anchor: ElementAnchor;
}

type HiddenReason = 'scrolled' | 'occluded' | 'hidden-overlay' | 'hidden';

interface PinGeo {
  x: number;
  y: number;
  rect: DOMRect | null;
  orphan: boolean;
  hidden: boolean;
  hiddenReason?: HiddenReason;
  flipped: boolean;
  below: boolean;
}

const SIDEBAR_OFFSET = 344; // 320px floating panel + 12px margin + 12px gap
const CARD_W = 344;
const PREVIEW_W = 280;

/* ================================================================== */
/* Root component                                                     */
/* ================================================================== */

export function OverlayApp(props: OverlayAppProps) {
  const { storage, auth, pageKey, pageUrl, hostElement } = props;

  const [enabled, setEnabledState] = useState(!!props.defaultEnabled);
  const [picking, setPicking] = useState(false);
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'open' | 'resolved'>('open');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; seq: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resolveVersion, setResolveVersion] = useState(0);
  const [, setTick] = useState(0);

  const layerRef = useRef<HTMLDivElement>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const flashTimer = useRef<number>();
  const toastTimer = useRef<number>();
  /** Tracks the last page button/link clicked outside any overlay, used to help reopen dialogs later. */
  const lastTriggerRef = useRef<{ selector: string; label: string } | null>(null);

  const setEnabled = useCallback(
    (next: boolean) => {
      enabledRef.current = next;
      setEnabledState(next);
      props.onEnabledChange?.(next);
      if (!next) {
        setPicking(false);
        setDraft(null);
        setActiveId(null);
        setSidebarOpen(false);
        setUserMenuOpen(false);
      }
    },
    [props.onEnabledChange],
  );

  useEffect(() => {
    props.onControllerReady?.({
      setEnabled,
      getEnabled: () => enabledRef.current,
      startPicking: () => {
        setEnabled(true);
        setDraft(null);
        setActiveId(null);
        setUserMenuOpen(false);
        setPicking(true);
      },
      openSidebar: () => {
        setEnabled(true);
        setPicking(false);
        setDraft(null);
        setActiveId(null);
        setSidebarOpen(true);
      },
    });
  }, [props.onControllerReady, setEnabled]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  /* ---------------- data ---------------- */

  const refresh = useCallback(async () => {
    try {
      setThreads(await storage.getComments(pageKey));
    } catch (err) {
      console.error('[Marklet] failed to load comments', err);
    }
  }, [storage, pageKey]);

  useEffect(() => {
    setActiveId(null);
    setDraft(null);
    refresh();
    const unsub = storage.subscribe?.(pageKey, (list) =>
      setThreads([...list].sort((a, b) => a.pinNumber - b.pinNumber)),
    );
    return () => unsub?.();
  }, [storage, pageKey, refresh]);

  useEffect(() => {
    auth.getCurrentUser().then(setUser);
    const unsub = auth.onChange?.(setUser);
    return () => unsub?.();
  }, [auth]);

  /* ---------------- anchor resolution & layout tracking ---------------- */

  const resolved = useMemo(() => {
    const map = new Map<string, ResolvedAnchor>();
    if (!enabled) return map;
    for (const t of threads) map.set(t.id, resolveAnchor(t.anchor));
    return map;
  }, [threads, resolveVersion, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let resolveTimer: number | undefined;
    const bump = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    const scheduleResolve = () => {
      if (resolveTimer !== undefined) return;
      resolveTimer = window.setTimeout(() => {
        resolveTimer = undefined;
        setResolveVersion((v) => v + 1);
      }, 400);
    };
    const mo = new MutationObserver(() => {
      bump();
      scheduleResolve();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    window.addEventListener('scroll', bump, true);
    window.addEventListener('scrollend', bump, true);
    window.addEventListener('resize', bump);
    document.addEventListener('transitionend', bump, true);
    document.addEventListener('animationend', bump, true);
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(resolveTimer);
      window.removeEventListener('scroll', bump, true);
      window.removeEventListener('scrollend', bump, true);
      window.removeEventListener('resize', bump);
      document.removeEventListener('transitionend', bump, true);
      document.removeEventListener('animationend', bump, true);
    };
  }, [enabled]);

  /* ---------------- passive trigger tracker (for reopening dialogs) ---------------- */

  useEffect(() => {
    const onPageClick = (e: MouseEvent) => {
      if (e.composedPath().includes(hostElement)) return;
      const target = e.target as Element | null;
      if (!target || target.nodeType !== 1) return;
      // Ignore clicks inside an already-open dialog/drawer
      if (target.closest('dialog, [role="dialog"], [aria-modal="true"], .modal, .drawer')) return;
      const clickable = target.closest('button, a, [role="button"], summary');
      if (!clickable) return;
      const label = (clickable.textContent ?? clickable.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!label) return;
      const a = generateAnchor(clickable);
      lastTriggerRef.current = { selector: a.selector, label };
    };
    window.addEventListener('click', onPageClick, true);
    return () => window.removeEventListener('click', onPageClick, true);
  }, [hostElement]);

  /* ---------------- picker ---------------- */

  const pickerActive = enabled && picking && !draft;

  useEffect(() => {
    if (!pickerActive || !layerRef.current) return;
    const picker = new ElementPicker({
      layer: layerRef.current,
      ignoreHost: hostElement,
      onPick: ({ element, anchor }) => {
        // Attach the last clicked page trigger if this element lives inside a dialog/drawer
        if (anchor.overlayContext && anchor.overlayContext.kind !== 'collapsible' && lastTriggerRef.current) {
          anchor = {
            ...anchor,
            overlayContext: {
              ...anchor.overlayContext,
              triggerSelector: lastTriggerRef.current.selector,
              triggerLabel: lastTriggerRef.current.label,
            },
          };
        }
        setActiveId(null);
        setDraft({ element, anchor });
      },
      onCancel: () => setPicking(false),
    });
    picker.start();
    return () => picker.stop();
  }, [pickerActive, hostElement]);

  /* ---------------- keyboard & click-outside ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditable(e.composedPath()[0])) return;
      // Alt+Shift+C : master switch (always available)
      if (e.altKey && e.shiftKey && e.code === 'KeyC') {
        e.preventDefault();
        setEnabled(!enabled);
        return;
      }
      if (!enabled) return;
      if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setDraft(null);
        setSidebarOpen(false);
        setUserMenuOpen(false);
        setActiveId(null);
        setPicking((p) => !p);
      } else if (e.key === 'Escape') {
        if (draft) {
          setDraft(null);
        } else if (picking) {
          setPicking(false);
        } else {
          setActiveId(null);
          setUserMenuOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, setEnabled, draft, picking]);

  useEffect(() => {
    if (!activeId && !userMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (e.composedPath().includes(hostElement)) return;
      setActiveId(null);
      setUserMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [activeId, userMenuOpen, hostElement]);

  /* ---------------- actions ---------------- */

  const run = async (fn: () => Promise<unknown>, errMsg: string) => {
    try {
      await fn();
      await refresh();
    } catch (err) {
      console.error('[Marklet]', err);
      showToast(errMsg);
    }
  };

  const submitDraft = (body: string) =>
    run(async () => {
      if (!draft || !user) return;
      let snapshotDataUrl: string | undefined;
      if (props.captureSnapshot && draft.element.isConnected) {
        try {
          const rect = draft.element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            snapshotDataUrl = await props.captureSnapshot(rect);
          }
        } catch {
          /* non-fatal: proceed without screenshot */
        }
      }
      await storage.addComment({
        pageKey,
        url: pageUrl,
        anchor: draft.anchor,
        body,
        snapshotDataUrl,
        author: user,
      });
      // Stay in continuous commenting mode so the user can pin the next element immediately
      setDraft(null);
    }, 'Failed to save comment');

  const reply = (threadId: string, body: string) =>
    run(() => storage.addReply(threadId, body, user!), 'Failed to post reply');

  const toggleResolve = (t: CommentThread) =>
    run(async () => {
      const next = t.status === 'open';
      await storage.resolveThread(t.id, user!, next);
      showToast(next ? 'Resolved' : 'Reopened');
    }, 'Failed to update status');

  const remove = (t: CommentThread) => {
    if (!storage.deleteThread) return;
    if (!window.confirm(`Delete comment #${t.pinNumber}? This cannot be undone.`)) return;
    setActiveId(null);
    run(() => storage.deleteThread!(t.id), 'Failed to delete comment');
  };

  const openOverlayAndLocate = (t: CommentThread) => {
    const r = resolved.get(t.id);
    const el = r?.element;
    // 1. Native <details>: open directly
    const details = el?.closest('details') as HTMLDetailsElement | null | undefined;
    if (details && !details.open) {
      details.open = true;
      window.setTimeout(() => focusThread(t), 60);
      return;
    }
    // 2. Recorded trigger button (e.g. "Open Modal" / "＋ 新建项目")
    const triggerSel = t.anchor.overlayContext?.triggerSelector;
    if (triggerSel) {
      try {
        const trigger = document.querySelector(triggerSel) as HTMLElement | null;
        if (trigger && isRendered(trigger)) {
          trigger.click();
          window.setTimeout(() => focusThread(t), 120);
          return;
        }
      } catch {
        /* ignore invalid selector */
      }
    }
    showToast('Open the dialog first to view this comment');
  };

  const focusThread = (t: CommentThread) => {
    const r = resolved.get(t.id);
    setSidebarOpen(false);
    setUserMenuOpen(false);
    setActiveId(t.id);
    setDraft(null);
    const el = r?.element;
    if (el && isRendered(el)) {
      const rect = el.getBoundingClientRect();
      // If an open modal/drawer is covering the target (and doesn't contain it), dismiss it first
      if (isOccluded(el, rect, hostElement) && tryDismissBlockingOverlay(el, rect, hostElement)) {
        window.setTimeout(() => {
          if (el.isConnected && isRendered(el)) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
          }
          setTick((n) => n + 1);
        }, 60);
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }
    } else if (!el) {
      const bb = t.anchor.boundingBox;
      window.scrollTo({ top: Math.max(0, bb.pageY - window.innerHeight / 3), behavior: 'smooth' });
    }
    clearTimeout(flashTimer.current);
    setFlash({ id: t.id, seq: Date.now() });
    // Re-sync coordinates once smooth scrolling settles
    window.setTimeout(() => setTick((n) => n + 1), 350);
    window.setTimeout(() => setTick((n) => n + 1), 700);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
  };

  const stepThread = (dir: -1 | 1) => {
    if (!activeThread) return;
    const peerList = threads.filter((t) => t.status === activeThread.status);
    if (peerList.length < 2) return;
    const idx = peerList.findIndex((t) => t.id === activeThread.id);
    const next = peerList[(idx + dir + peerList.length) % peerList.length];
    if (next) focusThread(next);
  };

  const openPanelFromCard = () => {
    if (activeThread) setSidebarTab(activeThread.status);
    setActiveId(null);
    setDraft(null);
    setPicking(false);
    setSidebarOpen(true);
  };

  const buildBrief = () => {
    const hasOpen = threads.some((t) => t.status === 'open');
    return buildAiIterationMarkdown(threads, {
      pageTitle: document.title || undefined,
      pageUrl,
      includeResolved: !hasOpen,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
  };

  const copyAiBrief = async () => {
    if (threads.length === 0) return;
    const md = buildBrief();
    const count = threads.filter((t) => t.status === 'open').length || threads.length;
    try {
      await navigator.clipboard.writeText(md);
      showToast(`Copied AI brief (${count} ${count === 1 ? 'comment' : 'comments'})`);
    } catch {
      // Fallback for restricted clipboard contexts (e.g. file:// without focus)
      const ta = document.createElement('textarea');
      ta.value = md;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast(`Copied AI brief (${count} ${count === 1 ? 'comment' : 'comments'})`);
    }
  };

  const downloadAiBrief = () => {
    if (threads.length === 0) return;
    const hasOpen = threads.some((t) => t.status === 'open');
    const zipBlob = buildAiIterationZip(threads, {
      pageTitle: document.title || undefined,
      pageUrl,
      includeResolved: !hasOpen,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marklet-brief-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Design brief exported');
  };

  /* ---------------- derived layout ---------------- */

  const openCount = threads.filter((t) => t.status === 'open').length;
  const rightLimit = window.innerWidth - (sidebarOpen ? SIDEBAR_OFFSET : 0);

  const geos = new Map<string, PinGeo>();
  if (enabled) {
    const stack = new Map<Element, number>();
    for (const t of threads) {
      const g = pinGeometry(t, resolved.get(t.id), rightLimit, hostElement);
      const el = resolved.get(t.id)?.element;
      if (el && !g.orphan && !g.hidden) {
        const n = stack.get(el) ?? 0;
        stack.set(el, n + 1);
        g.x -= n * 26;
      }
      geos.set(t.id, g);
    }
  }

  const isPinVisible = (t: CommentThread) =>
    t.status === 'open' || showResolved || t.id === activeId || t.id === flash?.id;

  const activeThread = threads.find((t) => t.id === activeId) ?? null;
  const activePeerCount = activeThread ? threads.filter((t) => t.status === activeThread.status).length : 0;
  const hoverThread = hoverId && hoverId !== activeId ? threads.find((t) => t.id === hoverId) ?? null : null;
  const highlightId = hoverId ?? activeId;
  const highlightGeo = highlightId ? geos.get(highlightId) : undefined;
  const highlightRect = highlightGeo && !highlightGeo.hidden ? highlightGeo.rect : null;
  const flashGeo = flash ? geos.get(flash.id) : undefined;
  const flashRect = flashGeo && !flashGeo.hidden ? flashGeo.rect : null;
  const rawDraftRect = draft && draft.element.isConnected ? draft.element.getBoundingClientRect() : null;
  const draftRect = rawDraftRect && isRectInView(rawDraftRect, rightLimit) ? rawDraftRect : null;

  const stopKeys = (e: Event) => e.stopPropagation();

  /* ---------------- render ---------------- */

  return (
    <div class="pp-root" onKeyDown={stopKeys} onKeyUp={stopKeys} onKeyPress={stopKeys}>
      <div class="pp-layer" ref={layerRef}>
        {enabled && highlightRect && !picking && <Highlight rect={highlightRect} />}
        {enabled && flashRect && <Highlight key={`flash-${flash!.seq}`} rect={flashRect} variant="flash" />}
        {enabled && draftRect && <Highlight rect={draftRect} variant="draft" />}

        {enabled &&
          threads.filter(isPinVisible).map((t) => {
            const g = geos.get(t.id);
            if (!g || g.hidden) return null;
            return (
              <button
                key={t.id}
                class={cx(
                  'pp-pin',
                  t.status === 'resolved' && 'is-resolved',
                  g.orphan && 'is-orphan',
                  t.id === activeId && 'is-active',
                  g.flipped && 'is-flipped',
                  g.below && 'is-below',
                )}
                style={{ left: g.x, top: g.y }}
                title={g.orphan ? 'Element not found' : `Comment #${t.pinNumber}`}
                onMouseEnter={() => setHoverId(t.id)}
                onMouseLeave={() => setHoverId((h) => (h === t.id ? null : h))}
                onClick={() => {
                  setPicking(false);
                  setDraft(null);
                  setSidebarOpen(false);
                  setUserMenuOpen(false);
                  setActiveId(activeId === t.id ? null : t.id);
                }}
              >
                <span class="pp-pin-inner">
                  {t.status === 'resolved' ? <IconCheck small /> : t.pinNumber}
                </span>
              </button>
            );
          })}

        {enabled && hoverThread && geos.get(hoverThread.id) && !geos.get(hoverThread.id)!.hidden && isPinVisible(hoverThread) && (
          <ThreadCard
            mode="preview"
            thread={hoverThread}
            resolved={resolved.get(hoverThread.id)}
            style={placeCard(geos.get(hoverThread.id)!, PREVIEW_W, 130, rightLimit)}
          />
        )}

        {enabled && activeThread && user && (() => {
          const activeGeo = geos.get(activeThread.id);
          const outOfView = !activeGeo || activeGeo.hidden;
          const hiddenReason = activeGeo?.hiddenReason;
          const r = resolved.get(activeThread.id);
          const canReopen =
            hiddenReason === 'hidden-overlay' &&
            Boolean(r?.element?.closest('details') || activeThread.anchor.overlayContext?.triggerSelector);
          return (
            <ThreadCard
              key={activeThread.id}
              mode="full"
              thread={activeThread}
              resolved={r}
              user={user}
              canDelete={!!storage.deleteThread}
              canNavigate={activePeerCount > 1}
              outOfView={outOfView}
              hiddenReason={hiddenReason}
              canReopen={canReopen}
              style={outOfView ? undefined : placeCard(activeGeo, CARD_W, 340, rightLimit)}
              onClose={() => setActiveId(null)}
              onOpenSidebar={openPanelFromCard}
              onPrev={() => stepThread(-1)}
              onNext={() => stepThread(1)}
              onLocate={() => (canReopen ? openOverlayAndLocate(activeThread) : focusThread(activeThread))}
              onReply={(body) => reply(activeThread.id, body)}
              onToggleResolve={() => toggleResolve(activeThread)}
              onDelete={() => remove(activeThread)}
            />
          );
        })()}

        {enabled && draft && user && (() => {
          const outOfView = !draftRect;
          return (
            <Composer
              anchor={draft.anchor}
              label={draft.element.isConnected ? describeElement(draft.element) : draft.anchor.selector}
              user={user}
              outOfView={outOfView}
              style={
                outOfView
                  ? undefined
                  : placeCard(
                      { x: draftRect.right, y: draftRect.top, rect: draftRect, orphan: false, hidden: false, flipped: false, below: false },
                      CARD_W,
                      210,
                      rightLimit,
                    )
              }
              onLocate={() => {
                if (draft.element.isConnected && isRendered(draft.element)) {
                  draft.element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
                  window.setTimeout(() => setTick((n) => n + 1), 350);
                  window.setTimeout(() => setTick((n) => n + 1), 700);
                } else {
                  const bb = draft.anchor.boundingBox;
                  window.scrollTo({ top: Math.max(0, bb.pageY - window.innerHeight / 3), behavior: 'smooth' });
                }
              }}
              onSubmit={submitDraft}
              onCancel={() => setDraft(null)}
            />
          );
        })()}
      </div>

      {enabled && sidebarOpen && (
        <Sidebar
          threads={threads}
          resolved={resolved}
          activeId={activeId}
          tab={sidebarTab}
          onTabChange={setSidebarTab}
          onSelect={focusThread}
          onCopyBrief={copyAiBrief}
          onDownloadBrief={downloadAiBrief}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      {enabled && userMenuOpen && user && (
        <UserMenu
          user={user}
          auth={auth}
          showResolved={showResolved}
          onToggleShowResolved={setShowResolved}
          style={{
            left: 'calc(50% - 138px)',
            bottom: 68,
          }}
          onClose={() => setUserMenuOpen(false)}
        />
      )}

      {!enabled ? (
        props.hideFabWhenDisabled ? null : (
          <button
            class="pp-fab"
            title="Open Marklet (Alt+Shift+C)"
            aria-pressed={false}
            onClick={() => setEnabled(true)}
          >
            <IconBrand />
            <span>Marklet</span>
            {openCount > 0 && <span class="pp-fab-dot" aria-label="Has open comments" />}
          </button>
        )
      ) : (
        <div
          class={cx('pp-toolbar', picking && 'is-picking')}
          role="toolbar"
          aria-label="Marklet comments toolbar"
        >
          <button
            class={cx('pp-tool', picking && 'is-on')}
            data-tip={picking ? 'Cancel (Esc)' : 'Comment (C)'}
            aria-label={picking ? 'Cancel' : 'Comment'}
            aria-pressed={picking}
            onClick={() => {
              if (picking) {
                setPicking(false);
                setDraft(null);
              } else {
                setSidebarOpen(false);
                setUserMenuOpen(false);
                setActiveId(null);
                setDraft(null);
                setPicking(true);
              }
            }}
          >
            <IconCommentPlus />
          </button>

          {picking ? (
            <>
              <span class="pp-pick-status">
                {draft ? 'Write a comment · Enter to post' : 'Click any element to comment'}
              </span>
              {!draft && (
                <span class="pp-pick-hint">
                  <span class="pp-kbd">↑</span> Parent
                </span>
              )}
              <div class="pp-divider" />
              <button
                class="pp-pick-done"
                onClick={() => {
                  setPicking(false);
                  setDraft(null);
                }}
              >
                <span>Done</span>
                <span class="pp-kbd">Esc</span>
              </button>
            </>
          ) : (
            <>
              <button
                class={cx('pp-tool', sidebarOpen && 'is-soft-on')}
                data-tip="All comments"
                aria-label="All comments"
                aria-pressed={sidebarOpen}
                onClick={() => {
                  const next = !sidebarOpen;
                  setSidebarOpen(next);
                  if (next) {
                    setPicking(false);
                    setActiveId(null);
                    setDraft(null);
                  }
                }}
              >
                <IconSidebar />
                {openCount > 0 && <span class="pp-dot" aria-hidden="true" />}
              </button>
              <div class="pp-divider" />
              <button
                class={cx('pp-tool', userMenuOpen && 'is-soft-on')}
                data-tip="Settings"
                aria-label="Settings"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
              >
                {user ? <Avatar user={user} small /> : <IconUser />}
              </button>
              <button
                class="pp-tool"
                data-tip="Stop review (Alt+Shift+C)"
                aria-label="Stop review"
                onClick={() => setEnabled(false)}
              >
                <IconClose />
              </button>
            </>
          )}
        </div>
      )}

      {toast && <div class="pp-toast">{toast}</div>}
    </div>
  );
}

/* ================================================================== */
/* Sub components                                                     */
/* ================================================================== */

function Highlight({ rect, variant }: { rect: DOMRect; variant?: 'flash' | 'draft' }) {
  return (
    <div
      class={cx('pp-highlight', variant === 'flash' && 'is-flash', variant === 'draft' && 'is-draft')}
      style={{ left: rect.left - 2, top: rect.top - 2, width: rect.width + 4, height: rect.height + 4 }}
    />
  );
}

interface ThreadCardProps {
  mode: 'preview' | 'full';
  thread: CommentThread;
  resolved?: ResolvedAnchor;
  user?: UserProfile;
  canDelete?: boolean;
  canNavigate?: boolean;
  outOfView?: boolean;
  hiddenReason?: HiddenReason;
  canReopen?: boolean;
  style?: JSX.CSSProperties;
  onClose?: () => void;
  onOpenSidebar?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onLocate?: () => void;
  onReply?: (body: string) => void;
  onToggleResolve?: () => void;
  onDelete?: () => void;
}

function ThreadCard(p: ThreadCardProps) {
  const { thread: t } = p;
  const orphan = !p.resolved?.element;
  const lowConfidence = !orphan && (p.resolved?.confidence ?? 1) < 0.6;

  if (p.mode === 'preview') {
    return (
      <div class="pp-card is-preview" style={p.style}>
        <div class="pp-card-body">
          <Message author={t.author} time={t.createdAt} text={t.body} clamp />
          {t.replies.length > 0 && (
            <div class="pp-muted" style={{ paddingBottom: 4 }}>
              {t.replies.length} {t.replies.length === 1 ? 'reply' : 'replies'}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div class={cx('pp-card', p.outOfView && 'is-centered')} style={p.style}>
      <div class="pp-card-head">
        <button
          class="pp-icon-btn"
          title="All comments"
          aria-label="All comments"
          onClick={p.onOpenSidebar}
        >
          <IconSidebar />
        </button>
        <span class="pp-card-title" style={{ marginLeft: 2 }}>
          #{t.pinNumber}
        </span>
        <span class={cx('pp-chip', t.status === 'resolved' ? 'is-resolved' : 'is-blue')}>
          {t.status === 'resolved' ? 'Resolved' : 'Open'}
        </span>
        <span class="pp-spacer" />
        <button
          class="pp-icon-btn"
          title="Previous"
          aria-label="Previous"
          disabled={!p.canNavigate}
          onClick={p.onPrev}
        >
          <IconChevronLeft />
        </button>
        <button
          class="pp-icon-btn"
          title="Next"
          aria-label="Next"
          disabled={!p.canNavigate}
          onClick={p.onNext}
        >
          <IconChevronRight />
        </button>
        <span class="pp-head-divider" />
        <button
          class={cx('pp-icon-btn', t.status === 'resolved' && 'is-resolved')}
          title={t.status === 'open' ? 'Resolve' : 'Reopen'}
          aria-label={t.status === 'open' ? 'Resolve' : 'Reopen'}
          onClick={p.onToggleResolve}
        >
          <IconCheckCircle />
        </button>
        {p.canDelete && (
          <button class="pp-icon-btn is-danger" title="Delete" aria-label="Delete" onClick={p.onDelete}>
            <IconTrash />
          </button>
        )}
        <button class="pp-icon-btn" title="Close" aria-label="Close" onClick={p.onClose}>
          <IconClose />
        </button>
      </div>
      <div class="pp-card-body">
        {p.outOfView && !orphan && (() => {
          const ctx = t.anchor.overlayContext ?? (p.resolved?.element ? detectOverlayContext(p.resolved.element) : undefined);
          if (p.hiddenReason === 'hidden-overlay') {
            const kindLabel = ctx?.kind === 'drawer' ? 'drawer' : ctx?.kind === 'collapsible' ? 'collapsed section' : 'dialog';
            const titlePart = ctx?.title ? ` “${ctx.title}”` : '';
            const hint = ctx?.triggerLabel ? ` — click “${ctx.triggerLabel}”` : '';
            return (
              <div class="pp-offscreen-bar">
                <span class="pp-offscreen-msg">
                  <IconLocate />
                  <span>
                    Inside closed {kindLabel}
                    {titlePart}
                    {!p.canReopen && hint}
                  </span>
                </span>
                {p.canReopen && (
                  <button class="pp-locate-btn" onClick={p.onLocate}>
                    Open
                  </button>
                )}
              </div>
            );
          }
          if (p.hiddenReason === 'occluded') {
            return (
              <div class="pp-offscreen-bar">
                <span class="pp-offscreen-msg">
                  <IconLocate />
                  <span>Covered by an open overlay</span>
                </span>
              </div>
            );
          }
          if (p.hiddenReason === 'hidden') {
            return (
              <div class="pp-offscreen-bar">
                <span class="pp-offscreen-msg">
                  <IconLocate />
                  <span>Pinned element is currently hidden</span>
                </span>
              </div>
            );
          }
          return (
            <div class="pp-offscreen-bar">
              <span class="pp-offscreen-msg">
                <IconLocate />
                <span>Element is off-screen</span>
              </span>
              <button class="pp-locate-btn" onClick={p.onLocate}>
                Scroll to
              </button>
            </div>
          );
        })()}
        <Message author={t.author} time={t.createdAt} text={t.body} />
        <div class="pp-target" title={t.anchor.selector}>
          <span class="pp-target-text">
            &lt;{t.anchor.tagName}&gt; {t.anchor.textSnippet ? `“${t.anchor.textSnippet}”` : t.anchor.selector}
          </span>
        </div>
        {t.snapshotDataUrl && <img class="pp-snapshot" src={t.snapshotDataUrl} alt={`Comment #${t.pinNumber} context`} />}
        {orphan && <div class="pp-warn">Element not found — shown at last known position.</div>}
        {lowConfidence && <div class="pp-warn">Element may have moved.</div>}
        {t.replies.length > 0 && (
          <div class="pp-thread-replies">
            <div class="pp-replies-label">
              {t.replies.length} {t.replies.length === 1 ? 'reply' : 'replies'}
            </div>
            {t.replies.map((r) => (
              <Message key={r.id} author={r.author} time={r.createdAt} text={r.body} />
            ))}
          </div>
        )}
        {t.status === 'resolved' && t.resolvedBy && (
          <div class="pp-resolved-note">
            <IconCheck small />
            <span>
              Resolved by {t.resolvedBy.name} · {formatTime(t.resolvedAt!)}
            </span>
          </div>
        )}
      </div>
      <div class="pp-card-foot">
        <ReplyBox onSubmit={(b) => p.onReply?.(b)} onCancel={p.onClose} />
      </div>
    </div>
  );
}

function ReplyBox({ onSubmit, onCancel }: { onSubmit: (body: string) => void; onCancel?: () => void }) {
  const [text, setText] = useState('');
  const send = () => {
    const body = text.trim();
    if (!body) return;
    onSubmit(body);
    setText('');
  };
  return (
    <div class="pp-composer-box">
      <textarea
        rows={1}
        placeholder="Reply…"
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          } else if (e.key === 'Escape') {
            onCancel?.();
          }
        }}
      />
      <button class="pp-send-btn" title="Post reply (Enter)" aria-label="Post reply" disabled={!text.trim()} onClick={send}>
        <IconArrowUp />
      </button>
    </div>
  );
}

interface ComposerProps {
  anchor: ElementAnchor;
  label: string;
  user: UserProfile;
  outOfView?: boolean;
  style?: JSX.CSSProperties;
  onLocate?: () => void;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

function Composer(p: ComposerProps) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  const submit = () => {
    const body = text.trim();
    if (body) p.onSubmit(body);
  };
  return (
    <div class={cx('pp-card', p.outOfView && 'is-centered')} style={p.style}>
      <div class="pp-card-head">
        <Avatar user={p.user} small />
        <span class="pp-card-title">{p.user.name}</span>
        <span class="pp-chip" title="Anchor strategy">
          {p.anchor.strategy}
        </span>
        <span class="pp-spacer" />
        <button class="pp-icon-btn" title="Cancel" aria-label="Cancel" onClick={p.onCancel}>
          <IconClose />
        </button>
      </div>
      <div class="pp-card-body">
        {p.outOfView && (
          <div class="pp-offscreen-bar">
            <span class="pp-offscreen-msg">
              <IconLocate />
              <span>Pinned element is out of view</span>
            </span>
            <button class="pp-locate-btn" onClick={p.onLocate}>
              Jump to element
            </button>
          </div>
        )}
        <div class="pp-target" title={p.anchor.selector}>
          <span class="pp-target-text">{p.label}</span>
        </div>
        {p.anchor.textSnippet && <div class="pp-muted" style={{ marginTop: 4 }}>“{p.anchor.textSnippet}”</div>}
      </div>
      <div class="pp-card-foot">
        <div class="pp-composer-box is-tall">
          <textarea
            ref={ref}
            placeholder="Add a comment…"
            value={text}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                p.onCancel();
              }
            }}
          />
          <button class="pp-send-btn" title="Post comment (Enter)" aria-label="Post comment" disabled={!text.trim()} onClick={submit}>
            <IconArrowUp />
          </button>
        </div>
      </div>
    </div>
  );
}

interface SidebarProps {
  threads: CommentThread[];
  resolved: Map<string, ResolvedAnchor>;
  activeId: string | null;
  tab: 'open' | 'resolved';
  onTabChange: (tab: 'open' | 'resolved') => void;
  onSelect: (t: CommentThread) => void;
  onCopyBrief: () => void;
  onDownloadBrief: () => void;
  onClose: () => void;
}

function Sidebar(p: SidebarProps) {
  const { tab, onTabChange } = p;
  const open = p.threads.filter((t) => t.status === 'open');
  const done = p.threads.filter((t) => t.status === 'resolved');
  const visible = tab === 'open' ? open : done;
  const hasThreads = p.threads.length > 0;

  return (
    <aside class="pp-sidebar">
      <div class="pp-sidebar-head">
        <div class="pp-row">
          <span class="pp-sidebar-title">Comments</span>
          <span class="pp-count">{p.threads.length}</span>
          <span class="pp-spacer" />
          <button class="pp-icon-btn" title="Close" aria-label="Close" onClick={p.onClose}>
            <IconClose />
          </button>
        </div>
        <div class="pp-tabs" role="tablist" aria-label="Comment status filter">
          <button
            role="tab"
            aria-selected={tab === 'open'}
            class={cx('pp-tab', tab === 'open' && 'is-active')}
            onClick={() => onTabChange('open')}
          >
            <span>Open</span>
            <span class="pp-tab-count">{open.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'resolved'}
            class={cx('pp-tab', tab === 'resolved' && 'is-active')}
            onClick={() => onTabChange('resolved')}
          >
            <span>Resolved</span>
            <span class="pp-tab-count">{done.length}</span>
          </button>
        </div>
      </div>

      <div class="pp-sidebar-body">
        {visible.length === 0 ? (
          <div class="pp-empty">
            <div class="pp-empty-title">{tab === 'open' ? 'No open comments' : 'No resolved comments'}</div>
            {tab === 'open' ? (
              <>
                Press <span class="pp-kbd">C</span> or click the comment tool below to leave your first mark.
              </>
            ) : (
              'Resolved comments will appear here.'
            )}
          </div>
        ) : (
          visible.map((t) => {
            const r = p.resolved.get(t.id);
            const orphan = !r?.element;
            const hidden = !orphan && !isRendered(r!.element!);
            return (
              <button key={t.id} class={cx('pp-item', t.id === p.activeId && 'is-active')} onClick={() => p.onSelect(t)}>
                <div class="pp-item-head">
                  <Avatar user={t.author} small />
                  <span class="pp-item-author">{t.author.name}</span>
                  <span class="pp-item-time">{formatTime(t.updatedAt)}</span>
                  <span class={cx('pp-item-pin', t.status === 'resolved' && 'is-resolved', orphan && 'is-orphan')}>
                    #{t.pinNumber}
                  </span>
                </div>
                <div class="pp-item-text">{t.body}</div>
                <div class="pp-item-foot">
                  <div class="pp-item-tags">
                    <span class="pp-chip pp-chip-target" title={t.anchor.selector}>
                      &lt;{t.anchor.tagName}&gt;{t.anchor.textSnippet ? ` “${t.anchor.textSnippet}”` : ''}
                    </span>
                    {orphan && <span class="pp-chip is-orphan">Missing</span>}
                    {hidden && <span class="pp-chip is-orphan">Hidden</span>}
                  </div>
                  {t.replies.length > 0 && (
                    <span class="pp-item-replies">
                      {t.replies.length} {t.replies.length === 1 ? 'reply' : 'replies'}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      <div class="pp-sidebar-foot">
        <button
          class="pp-brief-btn"
          title="Export Design Brief (.zip with Markdown & element screenshots)"
          disabled={!hasThreads}
          onClick={p.onDownloadBrief}
        >
          <IconDownload />
          <span>Export Design Brief</span>
        </button>
        <p class="pp-brief-note">Downloads a .zip ready for AI coding tools</p>
      </div>
    </aside>
  );
}

function UserMenu({
  user,
  auth,
  showResolved,
  onToggleShowResolved,
  style,
  onClose,
}: {
  user: UserProfile;
  auth: AuthAdapter;
  showResolved: boolean;
  onToggleShowResolved: (v: boolean) => void;
  style: JSX.CSSProperties;
  onClose: () => void;
}) {
  const [mode, setMode] = useState(user.mode);
  const [name, setName] = useState(user.mode === 'named' ? user.name : '');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === 'named') nameRef.current?.focus({ preventScroll: true });
  }, [mode]);

  const selectMode = async (next: UserProfile['mode']) => {
    setMode(next);
    if (next === 'self-note') {
      await auth.useSelfNote();
    }
  };

  const confirmName = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await auth.setNickname(trimmed);
    onClose();
  };

  const canConfirm = Boolean(name.trim());

  const option = (value: UserProfile['mode'], title: string, desc: string) => (
    <label class={cx('pp-option', mode === value && 'is-selected')}>
      <input type="radio" name="pp-user-mode" checked={mode === value} onChange={() => selectMode(value)} />
      <span>
        <div class="pp-option-title">{title}</div>
        <div class="pp-muted">{desc}</div>
      </span>
    </label>
  );

  return (
    <div class="pp-popover" style={style}>
      <div class="pp-popover-section">Comment as</div>
      {option('self-note', 'Self Note', 'Personal design notes')}
      {option('named', 'Custom Name', 'Collaborator or reviewer')}
      {mode === 'named' && (
        <div class="pp-name-box">
          <input
            ref={nameRef}
            placeholder="Your name"
            maxLength={40}
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmName();
              else if (e.key === 'Escape') onClose();
            }}
          />
          <button
            class="pp-confirm-btn"
            title="Save (Enter)"
            aria-label="Save name"
            disabled={!canConfirm}
            onClick={confirmName}
          >
            <IconCheck />
          </button>
        </div>
      )}
      <div class="pp-popover-divider" />
      <div class="pp-popover-section">Display</div>
      <div
        class="pp-toggle-row"
        role="switch"
        aria-checked={showResolved}
        tabIndex={0}
        onClick={() => onToggleShowResolved(!showResolved)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onToggleShowResolved(!showResolved);
          }
        }}
      >
        <span class="pp-toggle-label">Show resolved comments</span>
        <span class={cx('pp-toggle', showResolved && 'is-on')} />
      </div>
    </div>
  );
}

function Message({ author, time, text, clamp }: { author: UserProfile; time: string; text: string; clamp?: boolean }) {
  return (
    <div class="pp-msg">
      <Avatar user={author} />
      <div class="pp-msg-main">
        <div class="pp-msg-meta">
          <span class="pp-msg-author">{author.name}</span>
          <span class="pp-msg-time">{formatTime(time)}</span>
        </div>
        <div class={cx('pp-msg-text', clamp && 'pp-preview-text')}>{text}</div>
      </div>
    </div>
  );
}

function Avatar({ user, small }: { user: UserProfile; small?: boolean }) {
  const initial = user.mode === 'self-note' ? 'S' : Array.from(user.name.trim())[0] ?? '?';
  return (
    <span class={cx('pp-avatar', small && 'is-sm')} style={{ background: user.color ?? '#d97757' }} title={user.name}>
      {initial}
    </span>
  );
}

/* ================================================================== */
/* Unified 16×16 Figma UI3 icon set (1.5px stroke, optical balance)   */
/* ================================================================== */

const Svg = ({ children, size }: { children: ComponentChildren; size?: number }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    style={size ? { width: size, height: size } : undefined}
  >
    {children}
  </svg>
);
const IconBrand = () => (
  <svg viewBox="0 0 128 128" fill="none" style={{ width: 20, height: 20, borderRadius: 5, display: 'block' }}>
    <rect width="128" height="128" rx="30" fill="#F5F3EE" />
    <path
      d="M34 44C34 35.1634 41.1634 28 50 28H68V94C68 98.4183 64.4183 102 60 102H42C37.5817 102 34 98.4183 34 94V44Z"
      fill="#292524"
    />
    <path
      d="M56 54C56 41.8497 65.8497 32 78 32C90.1503 32 100 41.8497 100 54C100 66.1503 90.1503 76 78 76H62C58.6863 76 56 73.3137 56 70V54Z"
      fill="#D97757"
      fill-opacity="0.92"
    />
  </svg>
);
const IconCommentPlus = () => (
  <Svg>
    <path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5c0 3.04-2.46 5.5-5.5 5.5H3.25l1.05-2.1A5.5 5.5 0 0 1 8 2.5Z" />
    <path d="M8 5.75v4.5M5.75 8h4.5" />
  </Svg>
);
const IconSidebar = () => (
  <Svg>
    <rect x="2.5" y="3" width="11" height="10" rx="2" />
    <path d="M10 3v10" />
  </Svg>
);
const IconUser = () => (
  <Svg>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3.25 13.25a4.75 4.75 0 0 1 9.5 0" />
  </Svg>
);
const IconClose = () => (
  <Svg>
    <path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5" />
  </Svg>
);
const IconCheck = ({ small }: { small?: boolean }) => (
  <Svg size={small ? 14 : undefined}>
    <path d="M3.5 8.25 6.5 11.25 12.5 4.75" />
  </Svg>
);
const IconCheckCircle = () => (
  <Svg>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M5.75 8.15 7.25 9.65 10.5 6.4" />
  </Svg>
);
const IconTrash = () => (
  <Svg>
    <path d="M3 4.5h10M6 4.5V3.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75V4.5M11.75 4.5l-.6 8.1a1.1 1.1 0 0 1-1.1 1.02H5.95a1.1 1.1 0 0 1-1.1-1.02l-.6-8.1" />
  </Svg>
);
const IconArrowUp = () => (
  <Svg>
    <path d="M8 12.25V3.75M4.5 7.25 8 3.75l3.5 3.5" />
  </Svg>
);
const IconChevronLeft = () => (
  <Svg>
    <path d="M10 3.75 5.75 8 10 12.25" />
  </Svg>
);
const IconChevronRight = () => (
  <Svg>
    <path d="M6 3.75 10.25 8 6 12.25" />
  </Svg>
);
const IconLocate = () => (
  <Svg>
    <circle cx="8" cy="8" r="4.25" />
    <path d="M8 1.75v1.75M8 12.5v1.75M1.75 8H3.5M12.5 8h1.75" />
  </Svg>
);
const IconDownload = () => (
  <Svg>
    <path d="M8 2.75v7.5M5 7.5l3 3 3-3M3 12.75h10" />
  </Svg>
);

/* ================================================================== */
/* Utils                                                              */
/* ================================================================== */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function isEditable(target: EventTarget | undefined): boolean {
  const el = target as HTMLElement | undefined;
  if (!el || el.nodeType !== 1) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
}

function isRendered(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

function isRectInView(rect: DOMRect, rightLimit: number): boolean {
  if (rect.width === 0 && rect.height === 0) return false;
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < rightLimit;
}

/** Check whether `el` is clipped out of sight by any scrollable/overflow-hidden ancestor. */
function isClippedByAncestor(el: Element, rect: DOMRect): boolean {
  let parent = el.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent);
    const ox = style.overflowX;
    const oy = style.overflowY;
    if (ox === 'hidden' || ox === 'scroll' || ox === 'auto' || ox === 'clip' ||
        oy === 'hidden' || oy === 'scroll' || oy === 'auto' || oy === 'clip') {
      const pr = parent.getBoundingClientRect();
      if (rect.bottom <= pr.top || rect.top >= pr.bottom || rect.right <= pr.left || rect.left >= pr.right) {
        return true;
      }
    }
    parent = parent.parentElement;
  }
  return false;
}

/**
 * Attempt to non-destructively dismiss an open modal/drawer that is covering `targetEl`
 * during explicit comment navigation. Returns `true` if a dismiss action was triggered.
 */
function tryDismissBlockingOverlay(targetEl: Element, rect: DOMRect, hostElement: Element): boolean {
  if (typeof document.elementsFromPoint !== 'function') return false;
  const cx = Math.max(0, Math.min(window.innerWidth - 1, (rect.left + rect.right) / 2));
  const cy = Math.max(0, Math.min(window.innerHeight - 1, (rect.top + rect.bottom) / 2));
  const stack = document.elementsFromPoint(cx, cy);
  const top = stack.find((n) => n !== hostElement && !hostElement.contains(n));
  if (!top || top === targetEl || targetEl.contains(top)) return false;

  const overlay = top.closest(
    'dialog[open], [role="dialog"], [aria-modal="true"], .modal-backdrop, .drawer-backdrop, .modal, .drawer',
  );
  if (!overlay || overlay.contains(targetEl)) return false;

  // 1. Native <dialog>
  if (overlay.tagName === 'DIALOG') {
    (overlay as HTMLDialogElement).close();
    return true;
  }
  // 2. Standard close button inside the overlay
  const closeBtn = overlay.querySelector<HTMLElement>(
    'button[aria-label*="close" i], button[aria-label*="关闭"], [data-dismiss], [data-close], [data-close-modal], [data-close-drawer], .modal-close, .close',
  );
  if (closeBtn) {
    closeBtn.click();
    return true;
  }
  // 3. Fallback: Escape key (supported by Radix, MUI, Headless UI, AntD, etc.)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return true;
}

/**
 * Hit-test whether `el` is completely covered by another layer (e.g. a modal backdrop,
 * drawer, or sticky header). Ignores our own Shadow DOM host.
 */
function isOccluded(el: Element, rect: DOMRect, hostElement: Element): boolean {
  if (typeof document.elementsFromPoint !== 'function') return false;
  const minX = Math.max(0, rect.left + 2);
  const maxX = Math.min(window.innerWidth - 1, rect.right - 2);
  const minY = Math.max(0, rect.top + 2);
  const maxY = Math.min(window.innerHeight - 1, rect.bottom - 2);
  if (minX > maxX || minY > maxY) return true;

  const points: Array<[number, number]> = [
    [(minX + maxX) / 2, (minY + maxY) / 2],
    [maxX, minY],
    [minX, minY],
  ];

  for (const [px, py] of points) {
    const stack = document.elementsFromPoint(px, py);
    const top = stack.find((node) => node !== hostElement && !hostElement.contains(node));
    if (!top) continue;
    if (top === el || el.contains(top)) return false;
  }
  return true;
}

function pinGeometry(t: CommentThread, r: ResolvedAnchor | undefined, rightLimit: number, hostElement: Element): PinGeo {
  const hiddenGeo = (orphan: boolean, hiddenReason: HiddenReason): PinGeo => ({
    x: 0,
    y: 0,
    rect: null,
    orphan,
    hidden: true,
    hiddenReason,
    flipped: false,
    below: false,
  });

  const el = r?.element;
  if (el && el.isConnected) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      const inOverlay = Boolean(t.anchor.overlayContext || detectOverlayContext(el));
      return hiddenGeo(false, inOverlay ? 'hidden-overlay' : 'hidden');
    }
    if (!isRectInView(rect, rightLimit) || isClippedByAncestor(el, rect)) {
      return hiddenGeo(false, 'scrolled');
    }
    if (isOccluded(el, rect, hostElement)) {
      return hiddenGeo(false, 'occluded');
    }
    const baseRight = rect.right - 6;
    const flipped = baseRight + 34 > rightLimit;
    const x = flipped ? Math.min(rect.right - 2, rightLimit - 8) : baseRight;
    const below = rect.top + 8 < 36;
    const y = below ? Math.min(rect.bottom - 8, window.innerHeight - 36) : rect.top + 8;

    if (y < 0 || y > window.innerHeight + 30 || x < -30 || x > rightLimit) {
      return hiddenGeo(false, 'scrolled');
    }
    return { x, y, rect, orphan: false, hidden: false, flipped, below };
  }
  const bb = t.anchor.boundingBox;
  const baseRight = bb.pageX + bb.width - window.scrollX - 6;
  const flipped = baseRight + 34 > rightLimit;
  const x = flipped ? Math.min(bb.pageX + bb.width - window.scrollX - 2, rightLimit - 8) : baseRight;
  const rawY = bb.pageY - window.scrollY + 8;
  const below = rawY < 36 && rawY > -30;
  const y = rawY;
  if (y < 0 || y > window.innerHeight + 30 || x < -30 || x > rightLimit) {
    return hiddenGeo(true, 'scrolled');
  }
  return { x, y, rect: null, orphan: true, hidden: false, flipped, below };
}

function placeCard(g: PinGeo, width: number, estHeight: number, rightLimit: number): JSX.CSSProperties {
  const pinLeft = g.flipped ? g.x - 30 : g.x;
  const pinRight = g.flipped ? g.x : g.x + 30;
  let left = g.flipped ? pinLeft - 12 - width : pinRight + 12;
  if (left + width > rightLimit - 12) left = pinLeft - 12 - width;
  if (left < 12) left = pinRight + 12;
  left = Math.max(12, Math.min(left, rightLimit - width - 12));
  const top = Math.max(12, Math.min(g.below ? g.y : g.y - 30, window.innerHeight - estHeight - 72));
  return { left, top };
}

function formatTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = (Date.now() - t) / 1000;
  if (diff < 45) return 'Just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)}d ago`;
  const d = new Date(t);
  return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`;
}
