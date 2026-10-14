import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type {
  ChatMessageRecord,
  MessageBookmark,
  ChatMapSettings,
} from "../shared/types";
import type { ChatSiteAdapter } from "../adapters/types";
import { useMessageIndex } from "./useMessageIndex";
import { Marker } from "./Marker";
import { PreviewCard } from "./PreviewCard";
import { BookmarkEditor } from "./BookmarkEditor";
import { ScanOffer } from "./ScanOffer";
import { Tutorial } from "./Tutorial";
import { ExportDialog } from "../export/ExportDialog";
import { useBookmarks } from "./useBookmarks";
import { isMarkerVisible } from "./markerClassifier";
import {
  bookmarkKey,
  legacyBookmarkKey,
  getConversationId,
  setBookmark,
  deleteBookmark,
} from "../storage/bookmarks";
import { saveSettings } from "../storage/settings";
import { matchesKeybind, formatKeybind } from "../shared/keybinds";
import { DESKTOP_MIN_WIDTH, HIGHLIGHT_DURATION_MS } from "../shared/constants";

interface Props {
  adapter: ChatSiteAdapter;
  settings: ChatMapSettings;
}

const TOP_GAP = 110; // px gap from viewport top after scroll

// find chatgpt's scroll container.
// current chatgpt (post-2026 rewrite) uses `.thread-scroll-container`.
// previous build used `[data-scroll-root]`. the largest-scroll-range
// ancestor walk is kept as a last-resort fallback for future renames.
function findScrollContainer(el: HTMLElement): HTMLElement | null {
  // current chatgpt dom
  const byClass = document.querySelector<HTMLElement>(".thread-scroll-container");
  if (byClass && byClass.scrollHeight > byClass.clientHeight + 4) return byClass;

  // pre-rewrite chatgpt dom
  const byAttr = document.querySelector<HTMLElement>("[data-scroll-root]");
  if (byAttr && byAttr.scrollHeight > byAttr.clientHeight + 4) return byAttr;

  // legacy: react-scroll-to-bottom first child
  const rtb = document.querySelector<HTMLElement>("[class*='react-scroll-to-bottom']");
  if (rtb) {
    for (const child of rtb.children) {
      if (child instanceof HTMLElement) {
        const s = getComputedStyle(child);
        if ((s.overflowY === "auto" || s.overflowY === "scroll") &&
            child.scrollHeight > child.clientHeight + 4) return child;
      }
    }
  }

  // fallback: collect all scrollable ancestors, pick the one with the largest range
  const candidates: HTMLElement[] = [];
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const s = getComputedStyle(node);
    if ((s.overflowY === "auto" || s.overflowY === "scroll") &&
        node.scrollHeight > node.clientHeight + 4) candidates.push(node);
    node = node.parentElement;
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    return candidates[0];
  }

  return null;
}

// compute the container scrollTop that places `el` at TOP_GAP from the container's top edge.
// uses rects relative to the container's current scroll position — accurate even when
// the offsetParent chain is broken by transforms/sticky/fixed ancestors.
function destScrollTop(el: HTMLElement, container: HTMLElement): number {
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  return container.scrollTop + (eRect.top - cRect.top) - TOP_GAP;
}

// rAF tween with per-frame target re-resolution and a follow-up correction
// phase. solves three problems chatgpt's lazy-loading conversation creates:
//
//   1. native scrollTo({behavior:"smooth"}) scales duration with distance —
//      a 10k px jump takes 5+ seconds and feels broken. we cap the tween at
//      a fixed duration regardless of distance.
//
//   2. lazy-load inserts content mid-flight and shifts the target. we
//      re-measure dest every frame, AND re-resolve the dom node every frame
//      (since react may rebuild the turn entirely, detaching the original
//      element). previous implementations bailed on detached elements; that
//      was the "click multiple times to get closer" bug.
//
//   3. lazy-load batches can arrive after the tween ends. a critically-
//      damped follow-up phase keeps gently snapping to dest for up to 1.5s
//      until we're stable for ~200ms, then exits.
//
// raw .scrollTop writes also tear the compositor (frame duplication bug),
// so every write goes through scrollTo({behavior:"instant"}).
const TWEEN_MS = 460;
const FOLLOWUP_MS = 1500;
const STABLE_FRAMES = 12;       // ~200ms at 60fps before we declare arrival
const CORRECTION_ALPHA = 0.28;  // fraction of remaining gap closed per frame
const ARRIVAL_TOLERANCE = 1.5;

function tweenContainerToMessage(
  container: HTMLElement,
  msg: ChatMessageRecord,
  reduced: boolean
): () => void {
  const noop = () => {};
  const initial = resolveTarget(msg);
  if (!initial) return noop;

  const initialDest = Math.max(0, destScrollTop(initial, container));
  const initialDelta = Math.abs(container.scrollTop - initialDest);

  if (reduced || initialDelta < 8) {
    container.scrollTo({ top: initialDest, behavior: "instant" as ScrollBehavior });
    return noop;
  }

  let startScrollTop = container.scrollTop;
  const startTime = performance.now();
  let lastWritten = startScrollTop;
  let lastScrollHeight = container.scrollHeight;
  let cancelled = false;
  let stableFrames = 0;
  let cachedTarget: HTMLElement | null = initial;

  const resolveCached = (): HTMLElement | null => {
    if (cachedTarget && document.contains(cachedTarget)) return cachedTarget;
    cachedTarget = resolveTarget(msg);
    return cachedTarget;
  };

  // detect lazy-load reflow (chatgpt mounting older turns above, or
  // unmounting turns below, etc) and re-baseline startScrollTop so the
  // tween keeps aiming at the same visual target. previous code used a
  // scrollTop-diff heuristic to also detect user scrolls, but virtual
  // mount/unmount can shift scrollTop without changing scrollHeight, which
  // tripped the heuristic and cancelled the tween mid-flight. user-scroll
  // detection is now driven by actual input events (below) — much more
  // reliable.
  const onScroll = () => {
    const sh = container.scrollHeight;
    if (sh !== lastScrollHeight) {
      const shift = container.scrollTop - lastWritten;
      startScrollTop += shift;
      lastWritten = container.scrollTop;
      lastScrollHeight = sh;
    }
  };
  container.addEventListener("scroll", onScroll, { passive: true });

  // cancel on real user gestures: wheel, touch, navigation keys. these are
  // ground truth — no false positives from chatgpt's virtualization, which
  // is what made the prior diff-based heuristic flaky on the first click.
  const onUserInput = () => { cancelled = true; };
  const onKey = (e: KeyboardEvent) => {
    if (
      e.key === "ArrowUp" || e.key === "ArrowDown" ||
      e.key === "PageUp" || e.key === "PageDown" ||
      e.key === "Home"   || e.key === "End"      ||
      e.key === " "
    ) {
      cancelled = true;
    }
  };
  container.addEventListener("wheel", onUserInput, { passive: true });
  container.addEventListener("touchstart", onUserInput, { passive: true });
  window.addEventListener("wheel", onUserInput, { passive: true });
  window.addEventListener("touchstart", onUserInput, { passive: true });
  document.addEventListener("keydown", onKey);

  const cleanup = () => {
    container.removeEventListener("scroll", onScroll);
    container.removeEventListener("wheel", onUserInput);
    container.removeEventListener("touchstart", onUserInput);
    window.removeEventListener("wheel", onUserInput);
    window.removeEventListener("touchstart", onUserInput);
    document.removeEventListener("keydown", onKey);
  };

  const ease = (t: number) => 1 - Math.pow(1 - t, 3);

  const tick = (now: number) => {
    if (cancelled) { cleanup(); return; }

    const elapsed = now - startTime;
    const inTween = elapsed < TWEEN_MS;
    const inFollowup = elapsed < TWEEN_MS + FOLLOWUP_MS;

    const target = resolveCached();
    if (!target) {
      if (!inFollowup) { cleanup(); return; }
      requestAnimationFrame(tick);
      return;
    }

    const dest = Math.max(0, destScrollTop(target, container));
    let next: number;

    if (inTween) {
      const t = elapsed / TWEEN_MS;
      next = Math.round(startScrollTop + (dest - startScrollTop) * ease(t));
    } else if (inFollowup) {
      const delta = dest - container.scrollTop;
      if (Math.abs(delta) < ARRIVAL_TOLERANCE) {
        stableFrames++;
        if (stableFrames >= STABLE_FRAMES) { cleanup(); return; }
        requestAnimationFrame(tick);
        return;
      }
      stableFrames = 0;
      next = Math.round(container.scrollTop + delta * CORRECTION_ALPHA);
    } else {
      lastWritten = dest;
      container.scrollTo({ top: dest, behavior: "instant" as ScrollBehavior });
      cleanup();
      return;
    }

    lastWritten = next;
    container.scrollTo({ top: next, behavior: "instant" as ScrollBehavior });
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
  // cancel handle for the caller — rapid sequential clicks need to be able
  // to halt the prior tween before starting a new one, otherwise both tick
  // loops write to scrollTop every frame and the page lands somewhere
  // between the two targets (worst on long jumps where the first tween is
  // still mid-flight when the second click lands).
  return () => {
    cancelled = true;
    cleanup();
  };
}

// resolve the freshest live dom node for a message. tries (in order):
//   1. the stored element, if still attached
//   2. our stamped data-chatmap-id (cheap, may be stripped by react re-renders)
//   3. chatgpt's message uuid: new dom stores it in a space-separated list on
//      [data-chatgpt-search-message-ids] (wrapper) and on
//      [data-dil-message-id] (assistant body); legacy nested it under
//      [data-message-author-role] as data-message-id
//   4. the adapter-supplied dom anchor: new = search-unit-key value,
//      legacy = conversation-turn-N data-testid
// returns null if nothing resolves — caller treats that as "virtualized out,
// need to estimate-scroll into view first."
function resolveTarget(msg: ChatMessageRecord): HTMLElement | null {
  if (msg.element && document.contains(msg.element)) return msg.element;

  const byId = document.querySelector<HTMLElement>(
    `[data-chatmap-id="${msg.id}"]`
  );
  if (byId) return byId;

  if (msg.chatgptMsgId) {
    const safe = msg.chatgptMsgId.replace(/"/g, '\\"');

    // current dom: wrapper carries a space-separated id list. `~=` matches
    // one whitespace-separated token.
    const byUnit = document.querySelector<HTMLElement>(
      `[data-chatgpt-search-message-ids~="${safe}"]`
    );
    if (byUnit) return byUnit;

    // current dom: assistant body carries its own data-dil-message-id;
    // climb to the search-unit wrapper so the scroll offset lines up with
    // the full message block (including role label / action row).
    const byDil = document.querySelector<HTMLElement>(
      `[data-dil-message-id="${safe}"]`
    );
    if (byDil) {
      const wrapper = byDil.closest<HTMLElement>("[data-chatgpt-search-unit-key]");
      return wrapper ?? byDil;
    }

    // legacy dom
    const inner = document.querySelector<HTMLElement>(
      `[data-message-id="${safe}"]`
    );
    if (inner) {
      const wrapper = inner.closest<HTMLElement>(
        "[data-testid^='conversation-turn-']"
      );
      return wrapper ?? inner;
    }
  }

  if (msg.domAnchor) {
    // escape attribute value just in case future anchors contain quotes
    const safe = msg.domAnchor.replace(/"/g, '\\"');
    // current dom
    const byUnitKey = document.querySelector<HTMLElement>(
      `[data-chatgpt-search-unit-key="${safe}"]`
    );
    if (byUnitKey) return byUnitKey;
    // legacy dom
    const byAnchor = document.querySelector<HTMLElement>(
      `[data-testid="${safe}"]`
    );
    if (byAnchor) return byAnchor;
  }

  return null;
}

// pick any in-dom conversation turn so we can find the scroll container
// even when the desired message is virtualized out.
function anyLiveTurn(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>("[data-chatgpt-search-unit-key]") ??
    document.querySelector<HTMLElement>("[data-testid^='conversation-turn-']")
  );
}

// estimate a scroll position for a message that's not in the dom right now.
// we don't know its actual y, but we know its position in the sorted message
// list and the container's scroll range — that gets us close enough to
// trigger chatgpt's lazy-load, after which the element appears and we can
// run the normal smooth tween.
function estimateScrollForIndex(
  container: HTMLElement,
  msgIdx: number,
  totalMessages: number
): number {
  if (totalMessages <= 1) return 0;
  const ratio = msgIdx / (totalMessages - 1);
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  return Math.round(ratio * maxScroll);
}

function scrollToMessage(
  msg: ChatMessageRecord,
  reduced: boolean,
  msgIdx: number,
  totalMessages: number
): () => void {
  const noop = () => {};
  const target = resolveTarget(msg);

  if (target) {
    const container = findScrollContainer(target);
    if (container) {
      return tweenContainerToMessage(container, msg, reduced);
    }
    const eRect = target.getBoundingClientRect();
    window.scrollTo({
      top: Math.max(0, window.scrollY + eRect.top - TOP_GAP),
      behavior: reduced ? "instant" : "smooth",
    });
    return noop;
  }

  // virtualized: snap toward an estimated scroll position, poll for the
  // element to mount (chatgpt's lazy-load takes ~100-300ms per slice), then
  // run the normal tween once it's resolvable.
  const anyTurn = anyLiveTurn();
  if (!anyTurn) return noop;
  const container = findScrollContainer(anyTurn);
  if (!container) return noop;

  const estimate = estimateScrollForIndex(container, msgIdx, totalMessages);
  container.scrollTo({ top: estimate, behavior: "instant" as ScrollBehavior });

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let subCancel: (() => void) | null = null;
  let attempts = 0;
  const tryResolve = () => {
    if (cancelled) return;
    attempts++;
    const live = resolveTarget(msg);
    if (live) {
      subCancel = tweenContainerToMessage(container, msg, reduced);
      return;
    }
    if (attempts < 10) timer = setTimeout(tryResolve, 120);
  };
  timer = setTimeout(tryResolve, 180);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    if (subCancel) subCancel();
  };
}

// 14px per message, 80px min, 88% viewport max
function railHeight(count: number): number {
  const raw = Math.max(count, 6) * 14;
  return Math.min(raw, Math.round(window.innerHeight * 0.88));
}

export function Minimap({ adapter, settings }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const [editorIdx, setEditorIdx] = useState(-1);
  const [isDesktop, setIsDesktop] = useState(
    () => window.innerWidth >= DESKTOP_MIN_WIDTH
  );
  const [railRight, setRailRight] = useState(52);
  // index of the marker the user has just navigated to (wheel / click /
  // keybind). drives the floating callout that animates out of the
  // active marker. -1 = no callout shown.
  const [navCalloutIdx, setNavCalloutIdx] = useState(-1);
  // after a click-driven navigation the active highlight should track the
  // clicked marker, not whatever compute() lands on once the smooth scroll
  // settles. holds the target until the user actually scrolls again.
  const [clickLockIdx, setClickLockIdx] = useState(-1);
  const navCalloutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // cancel handle for the most-recent scroll tween. rapid sequential clicks
  // (or wheel-nav steps on a long chat) need to halt the prior tween before
  // starting a new one — otherwise multiple tick loops fight for scrollTop.
  const tweenCancelRef = useRef<(() => void) | null>(null);
  // last marker idx reached via alt+shift+scroll. used as the anchor for
  // the next wheel event so chained scrolls advance reliably even before
  // activeIdx has caught up to the in-flight smooth scroll.
  const wheelNavRef = useRef<number | null>(null);
  // idx of the marker that just got a quick-bookmark — drives a brief
  // glow on the marker as confirmation. -1 = no flash active.
  const [flashIdx, setFlashIdx] = useState(-1);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // active-marker walk state — refs so it survives effect re-runs caused
  // by chatgpt virtualizing turns in/out (which mutates `visible`).
  const walkCurRef = useRef(-1);
  const walkTargetRef = useRef(-1);
  const walkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // mirrors clickLockIdx for read inside the active-marker effect without
  // making it a dep (which would tear the effect down on every click).
  const clickLockIdxRef = useRef(-1);
  // last conversation id the walk operated on. when this changes the walk's
  // running indices belong to the previous chat — they're meaningless in the
  // new visible[] and must be reset before compute() runs again.
  const lastConvIdRef = useRef<string | null>(null);
  // last bookmark idx visited via keybind nav. lets us advance/retreat in
  // rail order even when the visible-extent active tracker has drifted to
  // a neighboring message (e.g. a long assistant turn right after a short
  // user turn). cleared on regular marker click so manual navigation
  // resets the anchor.
  const lastNavIdxRef = useRef<number | null>(null);
  const {
    messages,
    isStreaming,
    unreadIds,
    markRead,
    suppressRefresh,
    cacheLoaded,
    cacheState,
    markFullyScanned,
    markOfferDismissed,
  } = useMessageIndex(adapter, settings.chatLoadMode);
  const [showScanOffer, setShowScanOffer] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  // monotonic counter the tutorial watches to detect the quick-bookmark
  // keybind specifically (vs an editor-saved bookmark, which also grows the
  // bookmark map). bumped inside the quickBookmark keydown handler.
  const [quickBookmarkFires, setQuickBookmarkFires] = useState(0);
  // export dialog visibility — opened via keybind or rail button.
  const [showExport, setShowExport] = useState(false);
  // monotonic counter the tutorial watches to know when the export step has
  // been triggered. bumped each time the dialog is opened from this rail.
  const [exportOpens, setExportOpens] = useState(0);
  const bookmarks = useBookmarks();
  const convId = useMemo(() => getConversationId(), [messages.length]);

  const visible = useMemo(() => {
    const base = messages.filter((m) => isMarkerVisible(m, settings));
    if (!settings.bookmarksOnly) return base;
    return base.filter((m) => {
      const k = bookmarkKey(convId, m.domAnchor, m.chatgptMsgId);
      if (k && bookmarks[k]) return true;
      const legacy = legacyBookmarkKey(convId, m.domAnchor);
      return !!(legacy && bookmarks[legacy]);
    });
  }, [messages, settings, bookmarks, convId]);

  // resolve a bookmark for a message (or undefined). cheap to call from
  // the render loop since the lookup is O(1).
  const bookmarkFor = useCallback(
    (msg: ChatMessageRecord): MessageBookmark | undefined => {
      const k = bookmarkKey(convId, msg.domAnchor, msg.chatgptMsgId);
      if (k && bookmarks[k]) return bookmarks[k];
      // fall back to the legacy dom-anchor key so bookmarks saved before
      // the msg-uuid preference still resolve.
      const legacy = legacyBookmarkKey(convId, msg.domAnchor);
      return legacy ? bookmarks[legacy] : undefined;
    },
    [bookmarks, convId]
  );

  // keep transient indices in range when the visible set shrinks
  useEffect(() => {
    if (hoverIdx >= visible.length) setHoverIdx(-1);
    if (editorIdx >= visible.length) setEditorIdx(-1);
  }, [visible.length, hoverIdx, editorIdx]);

  // shift the rail left when chatgpt opens a right-docked panel (expanded
  // thoughts, canvas, etc.). identified purely by geometry — chatgpt's
  // `#stage-slideover-sidebar` is the LEFT chat list, not the right one.
  //
  // mounting order is the tricky part: panel inserts at full width and
  // animates in via transform/translate, so its visible left/right shift
  // every frame WITHOUT firing DOM mutations. MutationObserver alone
  // misses the slide-in. fix:
  //   1. on every MO event, recompute (catches insertion/removal)
  //   2. when a panel is found, ResizeObserver tracks its size changes
  //   3. for transform-based animation (no size change), rAF-poll for the
  //      brief window after any mutation. cheap and bounded.
  useEffect(() => {
    const DEFAULT_RIGHT = 52;
    const GAP = 28;
    let currentPanel: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;
    let rafId: number | null = null;
    let rafEnd = 0;

    function findPanel(): HTMLElement | null {
      const vw = window.innerWidth;
      const main = document.querySelector<HTMLElement>("main");
      if (!main) return null;
      const mainR = main.getBoundingClientRect();
      const candidates = document.querySelectorAll<HTMLElement>("aside, div");
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        // must visibly reach the right edge of the viewport
        if (r.right < vw - 8) continue;
        // must be off main's right edge — excludes the chat column itself
        if (r.left < mainR.right - 8) continue;
        // ignore zero-area placeholders, but allow narrow widths so we
        // catch the panel during its slide-in animation
        if (r.width < 1 || r.width > 900) continue;
        if (r.height < 80) continue;
        if (r.top > 220) continue;
        return el;
      }
      return null;
    }

    function apply() {
      const panel = findPanel();
      if (panel !== currentPanel) {
        if (ro) ro.disconnect();
        currentPanel = panel;
        if (panel) {
          ro = new ResizeObserver(apply);
          ro.observe(panel);
        } else {
          ro = null;
        }
      }
      if (!panel) {
        setRailRight(DEFAULT_RIGHT);
        return;
      }
      const r = panel.getBoundingClientRect();
      setRailRight(Math.max(DEFAULT_RIGHT, window.innerWidth - r.left + GAP));
    }

    // run apply() every frame for the next `durMs` ms. used to catch
    // transform-based slide-ins that don't fire size/dom events.
    function pulse(durMs: number) {
      const now = performance.now();
      rafEnd = Math.max(rafEnd, now + durMs);
      if (rafId !== null) return;
      const tick = () => {
        apply();
        if (performance.now() < rafEnd) {
          rafId = requestAnimationFrame(tick);
        } else {
          rafId = null;
        }
      };
      rafId = requestAnimationFrame(tick);
    }

    apply();
    const mo = new MutationObserver(() => pulse(450));
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("resize", apply);
    return () => {
      mo.disconnect();
      if (ro) ro.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", apply);
    };
  }, []);

  // decide whether to surface the scan offer. shown when:
  //   - the cache load attempt completed
  //   - this conversation has never been fully scanned
  //   - the user hasn't already dismissed the offer for this conversation
  //   - the chat is non-trivial (several turns rendered OR real scroll range)
  //   - AND we don't already have full coverage. coverage check: the live
  //     `messages` set reaches the highest `conversation-turn-N` in the dom
  //     and has at least that many entries. that's true for any chat the
  //     user built up while the extension was installed, so they're never
  //     re-offered to scan a chat they effectively scanned by living through.
  useEffect(() => {
    // bail entirely while a scan is in flight — otherwise message growth
    // during the scan retriggers this effect and unmounts the popup,
    // losing the progress bar mid-scan.
    if (isScanning) return;
    // reset whenever the cache state changes (chat switch or scan completion)
    setShowScanOffer(false);
    if (!cacheLoaded) return;
    if (cacheState?.fullyScanned) return;
    if (cacheState?.offerDismissed) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 8;

    const check = () => {
      if (cancelled) return;
      attempts++;

      // scan the dom for the highest rendered turn number. that tells us
      // how far chatgpt's currently-mounted slice reaches. prefer the
      // current search-unit-key selector; fall back to legacy testid.
      let maxDomTurn = 0;
      let domTurns = 0;
      const unitEls = document.querySelectorAll("[data-chatgpt-search-unit-key]");
      if (unitEls.length > 0) {
        unitEls.forEach((el) => {
          domTurns++;
          const m = el
            .getAttribute("data-chatgpt-search-unit-key")
            ?.match(/-turn-(\d+)/);
          if (m) {
            const n = parseInt(m[1]);
            if (n > maxDomTurn) maxDomTurn = n;
          }
        });
      } else {
        document
          .querySelectorAll("[data-testid^='conversation-turn-']")
          .forEach((el) => {
            domTurns++;
            const m = el.getAttribute("data-testid")?.match(/(\d+)$/);
            if (m) {
              const n = parseInt(m[1]);
              if (n > maxDomTurn) maxDomTurn = n;
            }
          });
      }

      // coverage: live messages reach the latest visible turn AND there
      // are enough of them to plausibly fill the gap. flip fullyScanned
      // so future visits skip the offer entirely.
      if (messages.length > 0 && maxDomTurn > 0) {
        const maxCaptured = messages.reduce((m, msg) => {
          const o = msg.order ?? 0;
          return o > m ? o : m;
        }, 0);
        if (maxCaptured >= maxDomTurn && messages.length >= maxDomTurn) {
          markFullyScanned();
          return;
        }
      }

      const turn = anyLiveTurn();
      const container = turn ? findScrollContainer(turn) : null;
      const scrollExcess = container
        ? container.scrollHeight - container.clientHeight
        : 0;
      if (domTurns >= 4 || scrollExcess > 600) {
        setShowScanOffer(true);
        return;
      }
      if (attempts < MAX_ATTEMPTS) {
        timer = setTimeout(check, 500);
      }
    };

    timer = setTimeout(check, 600);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [cacheLoaded, cacheState, messages, markFullyScanned, isScanning]);

  // distance-based scan: walk down the conversation one viewport at a
  // time, waiting on each step for chatgpt's lazy-load to settle before
  // advancing. earlier time-based tweens raced past long chats at
  // hundreds of px/frame and missed turns whenever the mount rate
  // couldn't keep up. now each chunk is bounded by chatgpt's loader
  // speed, not a wall clock — short chats finish in seconds, long ones
  // take longer but never skip content.
  const runScan = useCallback(async () => {
    const turn = anyLiveTurn();
    if (!turn) return;
    const container = findScrollContainer(turn);
    if (!container) return;

    setIsScanning(true);
    setScanProgress(0);
    try {
      const savedTop = container.scrollTop;
      const savedHeight = container.scrollHeight;

      // 1. snap to top, then dwell — the oldest turns sometimes take
      // longer to mount than mid-chat slices, so give them extra grace.
      container.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      setScanProgress(0.02);
      await new Promise((r) => setTimeout(r, 900));

      // step bounds. waits adapt: as soon as no new turns mount for
      // STABLE_MS we move on, but never sooner than MIN_MS or later
      // than MAX_MS per chunk.
      const STEP_MIN_MS = 320;
      const STEP_STABLE_MS = 240;
      const STEP_MAX_MS = 1800;
      // safety: bail if we somehow loop too many times (large chat +
      // never-stabilizing loader). 600 chunks @ 60% viewport = ~360k px
      // of scroll range, which is far beyond anything realistic.
      const HARD_CHUNK_CAP = 600;

      const countTurns = () =>
        document.querySelectorAll(
          "[data-chatgpt-search-unit-key], [data-testid^='conversation-turn-']"
        ).length;

      const waitForStable = async () => {
        const startTs = performance.now();
        let lastCount = countTurns();
        let lastChangeTs = startTs;
        while (true) {
          await new Promise((r) => setTimeout(r, 80));
          const elapsed = performance.now() - startTs;
          const now = countTurns();
          if (now !== lastCount) {
            lastCount = now;
            lastChangeTs = performance.now();
          }
          const stableTime = performance.now() - lastChangeTs;
          if (elapsed >= STEP_MIN_MS && stableTime >= STEP_STABLE_MS) return;
          if (elapsed >= STEP_MAX_MS) return;
        }
      };

      // 2. step down 60% of a viewport at a time. recompute maxScroll
      // every iteration because lazy-loading turns grows the container.
      // exit when we're within a few px of the actual bottom, even if
      // the bottom kept moving as we descended.
      let currentTop = 0;
      let chunks = 0;
      while (chunks < HARD_CHUNK_CAP) {
        chunks++;
        const maxScroll = Math.max(
          0,
          container.scrollHeight - container.clientHeight
        );
        if (currentTop >= maxScroll - 4) break;
        const stepSize = Math.max(200, container.clientHeight * 0.6);
        currentTop = Math.min(maxScroll, currentTop + stepSize);
        container.scrollTo({
          top: currentTop,
          behavior: "instant" as ScrollBehavior,
        });
        const pct = maxScroll > 0 ? currentTop / maxScroll : 1;
        setScanProgress(0.02 + Math.min(0.93, pct * 0.93));
        await waitForStable();
      }

      // 3. dwell at the bottom so the last slice has time to settle
      await new Promise((r) => setTimeout(r, 600));

      // 4. restore, accounting for content lazy-loaded above the user's anchor
      const delta = container.scrollHeight - savedHeight;
      container.scrollTo({
        top: savedTop + delta,
        behavior: "instant" as ScrollBehavior,
      });
      setScanProgress(1);

      await markFullyScanned();
    } finally {
      // brief pause on the full bar before we tear it down so the user
      // actually sees 100%, then unflag scanning — the offer effect will
      // run, see fullyScanned, and unmount the popup.
      setTimeout(() => {
        setIsScanning(false);
        setShowScanOffer(false);
      }, 250);
    }
  }, [markFullyScanned]);

  const handleDismissScan = useCallback(async () => {
    await markOfferDismissed();
    setShowScanOffer(false);
  }, [markOfferDismissed]);

  // desktop-only: hide minimap on narrow viewports
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= DESKTOP_MIN_WIDTH);
    window.addEventListener("resize", check, { passive: true });
    return () => window.removeEventListener("resize", check);
  }, []);

  // active tick — which message the user is reading.
  //
  // selection: nearest message to a reading line. line slides from 42%
  // mid-scroll toward 15% near top / 88% near bottom so first/last msgs
  // each get their turn instead of getting hidden behind a tall neighbor.
  //
  // chronological walking: rAF can only sample at 16ms. fast scroll moves
  // through several short msgs between samples, so the selected "best"
  // can jump by 3+ — the user sees "skipped" markers. fix: when best
  // jumps by >1, step through the intermediates one per frame so the rail
  // visibly walks the markers in order. if best changes again mid-walk,
  // the walk redirects toward the new target.
  useEffect(() => {
    if (visible.length === 0) {
      setActiveIdx(-1);
      return;
    }

    // find the scroll container off any in-dom message — not just visible[0].
    // entering an old chat lands the user at the bottom, where visible[0] (the
    // first message of the conversation) is virtualized out. without a
    // fallback, container resolves to null → scrollTarget=window → and the
    // listener never hears chatgpt's internal scroll events, so compute()
    // doesn't fire until the user scrolls so far up that visible[0] mounts.
    const firstLive = resolveTarget(visible[0]) ?? anyLiveTurn();
    const container = firstLive ? findScrollContainer(firstLive) : null;
    const scrollTarget: HTMLElement | Window = container ?? window;

    let raf = 0;
    // walk pace adapts to remaining distance. close target = slow per step
    // so each marker is visibly active. far target (fast scroll caught us
    // 10+ markers behind) = faster per step so the rail catches up without
    // a perceptible lag.
    const STEP_SLOW = 70;
    const STEP_FAST = 35;
    const FAST_THRESHOLD = 6;

    const cancelWalk = () => {
      if (walkTimerRef.current) {
        clearTimeout(walkTimerRef.current);
        walkTimerRef.current = null;
      }
    };
    const commit = (idx: number) => {
      if (idx === walkCurRef.current) return;
      walkCurRef.current = idx;
      setActiveIdx(idx);
    };
    // snap directly to target, cancel any walk in progress. used for
    // boundary forcing where the user is definitively at the edge —
    // dragging a stale walk through 10 markers would feel laggy.
    const snap = (target: number) => {
      if (target < 0) return;
      cancelWalk();
      walkTargetRef.current = target;
      commit(target);
    };
    const setTarget = (target: number) => {
      if (target < 0) return;
      // first commit ever — no walk, just commit
      if (walkCurRef.current < 0) {
        walkTargetRef.current = target;
        commit(target);
        return;
      }
      walkTargetRef.current = target;
      if (walkCurRef.current === walkTargetRef.current) return;
      if (walkTimerRef.current) return; // walk already running picks up new target
      const step = () => {
        walkTimerRef.current = null;
        if (walkCurRef.current === walkTargetRef.current) return;
        // if either end of the walk is out of range for the current visible[]
        // (chat just changed or markers got filtered out under us), snap to
        // target instead of stepping — stepping would address indices that
        // don't correspond to any marker, leaving no highlight at all.
        if (
          walkTargetRef.current < 0 ||
          walkTargetRef.current >= visible.length ||
          walkCurRef.current < 0 ||
          walkCurRef.current >= visible.length
        ) {
          commit(
            Math.max(0, Math.min(visible.length - 1, walkTargetRef.current))
          );
          return;
        }
        const remaining = Math.abs(
          walkTargetRef.current - walkCurRef.current
        );
        const dir = walkTargetRef.current > walkCurRef.current ? 1 : -1;
        commit(walkCurRef.current + dir);
        if (walkCurRef.current !== walkTargetRef.current) {
          const nextRem = Math.abs(
            walkTargetRef.current - walkCurRef.current
          );
          const ms = nextRem > FAST_THRESHOLD ? STEP_FAST : STEP_SLOW;
          walkTimerRef.current = setTimeout(step, ms);
        }
        // reference `remaining` so eslint doesn't whine and so the
        // pre-step value can be inspected during debugging.
        void remaining;
      };
      step();
    };

    const getScrollPos = () =>
      container ? container.scrollTop : window.scrollY;
    const getMaxScroll = () => {
      if (container)
        return Math.max(0, container.scrollHeight - container.clientHeight);
      const doc = document.documentElement;
      return Math.max(0, doc.scrollHeight - window.innerHeight);
    };
    const getViewBounds = () => {
      if (container) {
        const r = container.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      }
      return { top: 0, bottom: window.innerHeight };
    };

    const compute = () => {
      raf = 0;
      // freeze the walk while a click-lock is in flight. otherwise the
      // smooth-scroll's own scroll events drive compute, which can
      // boundary-force the walk to lastVisible/firstVisible — and once the
      // lock releases, the user sees the highlight jump to whatever stale
      // position the walk landed on.
      if (clickLockIdxRef.current >= 0) return;
      const { top: vTop, bottom: vBot } = getViewBounds();
      const viewportH = vBot - vTop;
      if (viewportH <= 0) return;

      const scrollPos = getScrollPos();
      const maxScroll = getMaxScroll();

      // reading line slides near the scroll boundaries so the first/last
      // few messages each get their turn at the line. without this, the
      // line is stuck at 42% from top and the last small msgs at scroll-
      // bottom never reach it (an earlier long msg keeps winning), and
      // first msgs at scroll-top hit the line only after the user has
      // scrolled past them.
      //   - mid-scroll:   42% from top
      //   - near bottom:  slides toward 88% over last viewportH pixels
      //   - near top:     slides toward 15% over first viewportH pixels
      const BASE_FRAC = 0.42;
      const BOT_FRAC = 0.88;
      const TOP_FRAC = 0.15;
      let frac = BASE_FRAC;
      if (maxScroll > 0) {
        const distFromBot = maxScroll - scrollPos;
        if (distFromBot < viewportH) {
          const t = 1 - distFromBot / viewportH; // 0 → 1 as we near bottom
          frac = BASE_FRAC + (BOT_FRAC - BASE_FRAC) * t;
        } else if (scrollPos < viewportH) {
          const t = 1 - scrollPos / viewportH; // 0 → 1 as we near top
          frac = BASE_FRAC + (TOP_FRAC - BASE_FRAC) * t;
        }
      }
      const readingLine = vTop + viewportH * frac;

      let firstVisible = -1;
      let lastVisible = -1;
      let best = -1;
      let bestDist = Infinity;
      let bestTop = -Infinity;

      for (let i = 0; i < visible.length; i++) {
        const el = resolveTarget(visible[i]);
        if (!el || !document.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom <= vTop || r.top >= vBot) continue;
        markRead(visible[i].id);
        if (firstVisible === -1) firstVisible = i;
        lastVisible = i;

        const dist =
          r.top <= readingLine && r.bottom >= readingLine
            ? 0
            : r.top > readingLine
              ? r.top - readingLine
              : readingLine - r.bottom;

        if (
          dist < bestDist ||
          (dist === bestDist && r.top > bestTop)
        ) {
          best = i;
          bestDist = dist;
          bestTop = r.top;
        }
      }

      if (firstVisible === -1) return; // nothing visible, leave active alone

      // boundary forcing — last message often can't reach the reading line.
      // snap instantly (no walk) because the user is definitively at the
      // edge; dragging an in-flight walk through 10 markers feels laggy.
      if (scrollPos <= 4) {
        snap(firstVisible);
        return;
      }
      if (scrollPos >= maxScroll - 4) {
        snap(lastVisible);
        return;
      }

      if (best !== -1) setTarget(best);
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };

    compute();
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      scrollTarget.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      // walkTimer is intentionally not cleared — it persists across
      // effect re-runs (caused by chatgpt virtualizing turns) so the
      // walk doesn't get cancelled mid-step every time `visible` updates.
    };
  }, [visible, markRead]);

  // mirror clickLockIdx to a ref so compute() can read it without
  // re-subscribing to the scroll listener on every change.
  useEffect(() => {
    clickLockIdxRef.current = clickLockIdx;
  }, [clickLockIdx]);

  // reset the walk state when the conversation changes. walkCurRef/walkTargetRef
  // persist across the active-marker effect's re-runs (deliberate, to survive
  // chatgpt virtualizing turns mid-walk), but those persistent values are
  // stale when the user jumps into a different chat — they point at indices
  // that mean a different message in the new visible[]. without this, the
  // walk runs a long catch-up across nonsensical indices on chat-enter and
  // some rail markers briefly flash while others never get highlighted at all.
  //
  // crucially: only reset on a real transition between two known ids, NOT on
  // the initial mount (null → "abc"), because this effect runs AFTER the
  // active-marker effect — resetting on first mount would wipe the first
  // compute()'s result and leave nothing highlighted until a scroll fires.
  useEffect(() => {
    const prev = lastConvIdRef.current;
    lastConvIdRef.current = convId;
    if (!prev || !convId || prev === convId) return;
    walkCurRef.current = -1;
    walkTargetRef.current = -1;
    if (walkTimerRef.current) {
      clearTimeout(walkTimerRef.current);
      walkTimerRef.current = null;
    }
    setActiveIdx(-1);
  }, [convId]);

  // release the click-lock as soon as the user actually scrolls or hits a
  // scroll-relevant key. mirrors the same input set the smooth-scroll uses
  // to detect "the user wants to take over." also expires on a long safety
  // timeout so a stale lock never sticks forever.
  useEffect(() => {
    if (clickLockIdx < 0) return;
    const release = () => setClickLockIdx(-1);
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "ArrowUp" || e.key === "ArrowDown" ||
        e.key === "PageUp" || e.key === "PageDown" ||
        e.key === "Home"   || e.key === "End"      ||
        e.key === " "
      ) release();
    };
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchstart", release, { passive: true });
    document.addEventListener("keydown", onKey);
    const safety = setTimeout(release, 8000);
    return () => {
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchstart", release);
      document.removeEventListener("keydown", onKey);
      clearTimeout(safety);
    };
  }, [clickLockIdx]);

  // briefly show the callout next to a marker the user just jumped to.
  // re-keyed by idx so the bubble animation replays on each step. dismiss
  // timer is reset on every call so a burst of wheel-navs keeps it visible
  // until the user pauses.
  const showNavCallout = useCallback((idx: number) => {
    if (navCalloutTimer.current) clearTimeout(navCalloutTimer.current);
    setNavCalloutIdx(idx);
    navCalloutTimer.current = setTimeout(() => setNavCalloutIdx(-1), 1400);
  }, []);

  // raw scroll + highlight without any nav-state side effects. used by
  // both the regular marker click path and the keybind jump path. when the
  // target is virtualized out (cache-only marker), the highlight is applied
  // after the dom node mounts in response to the estimated scroll.
  const performNavigate = useCallback(
    (msg: ChatMessageRecord) => {
      suppressRefresh(900);
      const idx = visible.indexOf(msg);
      if (idx >= 0) {
        showNavCallout(idx);
        setClickLockIdx(idx);
        // also force the underlying walk state to the click target so that
        // when the lock releases, compute() resumes from a sane position
        // instead of from whatever the smooth-scroll boundary-forced it to
        // (e.g. snap(lastVisible) when the target sits near the chat bottom).
        setActiveIdx(idx);
        walkCurRef.current = idx;
        walkTargetRef.current = idx;
        if (walkTimerRef.current) {
          clearTimeout(walkTimerRef.current);
          walkTimerRef.current = null;
        }
      }
      // halt any in-flight tween from a prior click before we start a new
      // one; without this, two tick loops race on scrollTop and the page
      // lands somewhere between the two targets (worst on long jumps).
      tweenCancelRef.current?.();
      tweenCancelRef.current = scrollToMessage(
        msg,
        settings.reducedMotion,
        idx >= 0 ? idx : 0,
        visible.length
      );

      if (!settings.navHighlight) return;

      // outline the message body (chatgpt's `[data-message-author-role]`
      // element) rather than the whole conversation-turn wrapper, which
      // also includes the role label and action row and produces a much
      // baggier outline than feels right. for user messages we dig one
      // level deeper to find the bubble, since the role wrapper spans the
      // full column even when the bubble itself is only a few words wide.
      const findBubble = (el: HTMLElement): HTMLElement => {
        const outerWidth = el.offsetWidth;
        const text = el.textContent || "";
        if (!text || outerWidth === 0) return el;
        // first descendant whose width is MEANINGFULLY narrower (>=8%) AND
        // still contains effectively all the message text. the threshold
        // skips intermediate full-width wrappers that are only marginally
        // narrower because of parent padding — we want the actual bubble
        // (user msgs) or, for a short assistant reply, the prose <p> sized
        // to its text. long full-width content has no match and we fall
        // back to the role element so the glow spans the column naturally.
        const tightCap = outerWidth * 0.92;
        for (const child of Array.from(el.querySelectorAll("*"))) {
          if (!(child instanceof HTMLElement)) continue;
          const w = child.offsetWidth;
          if (w <= 0 || w >= tightCap) continue;
          const childText = child.textContent || "";
          if (childText.length < text.length * 0.9) continue;
          return child;
        }
        return el;
      };

      const applyHighlight = (turn: HTMLElement) => {
        // prefer the current dom's semantic bodies so the outline hugs the
        // message bubble, not the surrounding chrome; legacy selector kept
        // as a fallback for users on the pre-rewrite client.
        const role =
          turn.querySelector<HTMLElement>(
            "[data-user-message-bubble], [data-markdown-copy='contents'], [data-dil-message-id], [data-message-author-role]"
          ) ?? turn;
        const target = findBubble(role);
        // clear any in-flight highlight on other messages so a rapid sequence
        // of jumps fades the old ones out as the new one fades in, rather
        // than leaving a trail of overlapping highlights.
        document
          .querySelectorAll(".chatmap-highlight")
          .forEach((el) => {
            if (el !== target) el.classList.remove("chatmap-highlight");
          });
        target.classList.add("chatmap-highlight");
        setTimeout(
          () => target.classList.remove("chatmap-highlight"),
          HIGHLIGHT_DURATION_MS
        );
      };

      const immediate = resolveTarget(msg);
      if (immediate) {
        applyHighlight(immediate);
        return;
      }

      // virtualized — poll until the element shows up, then highlight.
      let tries = 0;
      const poll = () => {
        tries++;
        const live = resolveTarget(msg);
        if (live) {
          applyHighlight(live);
          return;
        }
        if (tries < 14) setTimeout(poll, 140);
      };
      setTimeout(poll, 240);
    },
    [suppressRefresh, settings.reducedMotion, settings.navHighlight, visible, showNavCallout]
  );

  // marker click — same scroll but resets the keybind-nav anchor so the
  // next w/s starts from wherever the user actually clicked.
  const handleScrollTo = useCallback(
    (msg: ChatMessageRecord) => {
      lastNavIdxRef.current = null;
      wheelNavRef.current = null;
      performNavigate(msg);
    },
    [performNavigate]
  );

  // open the bookmark editor for a marker. invoked from Marker on
  // modifier-click (matched against settings.keybinds.editBookmark).
  const handleEditBookmark = useCallback((idx: number) => {
    setHoverIdx(-1);
    setEditorIdx(idx);
  }, []);

  // persist bookmark changes. drops the bookmark entirely if no fields
  // (color/name/note) were provided — empty bookmark = remove. uses the
  // msg-uuid-preferred key so bookmarks save even for markers the user
  // hasn't scrolled to yet (api-only records have no domAnchor).
  const handleSaveBookmark = useCallback(
    async (msg: ChatMessageRecord, patch: MessageBookmark) => {
      const k = bookmarkKey(convId, msg.domAnchor, msg.chatgptMsgId);
      if (!k) {
        setEditorIdx(-1);
        return;
      }
      if (!patch.color && !patch.name && !patch.note) {
        await deleteBookmark(k);
        // also remove any legacy dom-anchor-keyed entry so the bookmark
        // doesn't ghost-resurrect on the next refresh
        const legacy = legacyBookmarkKey(convId, msg.domAnchor);
        if (legacy && legacy !== k) await deleteBookmark(legacy);
      } else {
        await setBookmark(k, patch);
      }
      setEditorIdx(-1);
    },
    [convId]
  );

  const handleDeleteBookmark = useCallback(
    async (msg: ChatMessageRecord) => {
      const k = bookmarkKey(convId, msg.domAnchor, msg.chatgptMsgId);
      if (k) await deleteBookmark(k);
      // also purge the legacy key in case the bookmark predates the
      // msg-uuid migration
      const legacy = legacyBookmarkKey(convId, msg.domAnchor);
      if (legacy && legacy !== k) await deleteBookmark(legacy);
      setEditorIdx(-1);
    },
    [convId]
  );

  // alt+shift+w / alt+shift+s (or whatever the user configured) — jump
  // to the next or previous bookmarked message in rail order.
  //
  // anchor preference:
  //   1. lastNavIdxRef — the last bookmark we keybind-nav'd to. lets
  //      W/W/W cycle in order even when the visible-extent active tracker
  //      drifts to the message AFTER a short bookmark (which would
  //      otherwise cause a strict `>` lookup to skip the next bookmark
  //      because activeIdx already equals it).
  //   2. activeIdx — fresh start, no keybind yet.
  useEffect(() => {
    const { nextImportant, prevImportant } = settings.keybinds;

    const sorted = visible
      .map((msg, i) => (bookmarkFor(msg) ? i : -1))
      .filter((i) => i !== -1);

    if (sorted.length === 0) return;

    function jump(dir: 1 | -1) {
      // slot = position in `sorted` of the bookmark the user is "at"
      let slot: number;
      const lastIdx = lastNavIdxRef.current;
      if (lastIdx !== null && sorted.includes(lastIdx)) {
        slot = sorted.indexOf(lastIdx);
      } else {
        const anchor = activeIdx >= 0 ? activeIdx : -1;
        slot = -1;
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i] <= anchor) slot = i;
          else break;
        }
      }

      let nextSlot: number;
      if (dir > 0) {
        nextSlot = slot + 1 >= sorted.length ? 0 : slot + 1;
      } else {
        nextSlot = slot <= 0 ? sorted.length - 1 : slot - 1;
      }

      const targetIdx = sorted[nextSlot];
      lastNavIdxRef.current = targetIdx;
      if (visible[targetIdx]) performNavigate(visible[targetIdx]);
    }

    function onKey(e: KeyboardEvent) {
      // ignore when typing in an input/textarea — don't steal user keystrokes.
      // events that originate inside our shadow root get retargeted to the
      // host on the way out, so e.target is the host (a div) and the tagname
      // check passes through. composedPath()[0] is the real innermost element.
      const real = (e.composedPath()[0] ?? e.target) as HTMLElement | null;
      const tag = real?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || real?.isContentEditable) {
        return;
      }
      if (matchesKeybind(e, nextImportant)) {
        e.preventDefault();
        jump(1);
      } else if (matchesKeybind(e, prevImportant)) {
        e.preventDefault();
        jump(-1);
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, activeIdx, bookmarkFor, settings.keybinds, performNavigate]);

  // alt+shift+scroll (modifier-only) — accumulator-driven marker stepping.
  // deltaY adds to an accumulator and each STEP_PX of accumulated travel
  // advances one marker. fast spins build the accumulator quickly and skip
  // several markers in one performNavigate, which retargets the in-flight
  // smooth scroll instead of stuttering through discrete cooldown steps.
  // accumulator resets after a brief pause so a new gesture starts fresh.
  useEffect(() => {
    const { scrollNav } = settings.keybinds;
    if (!scrollNav) return;
    if (visible.length === 0) return;
    if (!scrollNav.altKey && !scrollNav.shiftKey && !scrollNav.ctrlKey && !scrollNav.metaKey) {
      return;
    }
    let accum = 0;
    let lastTs = 0;
    const STEP_PX = 100;
    const RESET_MS = 320;

    function onWheel(e: WheelEvent) {
      if (!matchesKeybind(e, scrollNav, false)) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastTs > RESET_MS) accum = 0;
      lastTs = now;
      accum += e.deltaY;
      const steps = (accum > 0 ? Math.floor : Math.ceil)(accum / STEP_PX);
      if (steps === 0) return;
      accum -= steps * STEP_PX;

      const baseIdx =
        wheelNavRef.current !== null ? wheelNavRef.current : activeIdx;
      let idx = (baseIdx < 0 ? 0 : baseIdx) + steps;
      if (idx < 0) idx = 0;
      if (idx > visible.length - 1) idx = visible.length - 1;
      if (idx === baseIdx) return;
      wheelNavRef.current = idx;
      if (visible[idx]) performNavigate(visible[idx]);
    }

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [visible, activeIdx, settings.keybinds, performNavigate]);

  // quick-bookmark: single-key toggle on the active marker. drops a
  // bookmark with the user's configured color (default pink), or removes
  // it if one already exists. ignored while focus is in a text input so
  // it doesn't fire while typing in the chat box.
  useEffect(() => {
    const { quickBookmark } = settings.keybinds;
    if (!quickBookmark) return;
    if (visible.length === 0) return;

    function onKey(e: KeyboardEvent) {
      // composedPath()[0] sees through the shadow boundary; e.target alone
      // returns our shadow host (a div) when the user is typing inside the
      // bookmark editor, which would let the quick-bookmark keybind fire
      // while they're trying to enter a 'b' in the name/note fields.
      const t = (e.composedPath()[0] ?? e.target) as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      if (!matchesKeybind(e, quickBookmark)) return;
      e.preventDefault();
      // bump the counter even before idx is resolved so the tutorial sees the
      // keypress itself, not just successful saves. (a press with no active
      // marker shouldn't fail the lesson.)
      setQuickBookmarkFires((n) => n + 1);
      const idx =
        navCalloutIdx >= 0 && navCalloutIdx < visible.length
          ? navCalloutIdx
          : activeIdx;
      if (idx < 0 || !visible[idx]) return;
      const msg = visible[idx];
      const k = bookmarkKey(convId, msg.domAnchor, msg.chatgptMsgId);
      if (!k) return;
      const existing = bookmarkFor(msg);
      if (existing) {
        deleteBookmark(k);
        const legacy = legacyBookmarkKey(convId, msg.domAnchor);
        if (legacy && legacy !== k) deleteBookmark(legacy);
        return;
      }
      setBookmark(k, {
        color: settings.quickBookmarkColor,
        createdAt: Date.now(),
      });
      // brief glow on the marker so the user sees the change land
      setFlashIdx(idx);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashIdx(-1), 600);
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    visible,
    activeIdx,
    navCalloutIdx,
    settings.keybinds,
    settings.quickBookmarkColor,
    convId,
    bookmarkFor,
  ]);

  // toggle the bookmarks-only filter + open the export dialog. both keybinds
  // ignore typing-in-input focus the same way the rest of our keybinds do.
  useEffect(() => {
    const { toggleBookmarksOnly, exportBookmarks } = settings.keybinds;
    function onKey(e: KeyboardEvent) {
      const t = (e.composedPath()[0] ?? e.target) as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      if (toggleBookmarksOnly && matchesKeybind(e, toggleBookmarksOnly)) {
        e.preventDefault();
        saveSettings({ ...settings, bookmarksOnly: !settings.bookmarksOnly });
        return;
      }
      if (exportBookmarks && matchesKeybind(e, exportBookmarks)) {
        e.preventDefault();
        setShowExport(true);
        setExportOpens((n) => n + 1);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settings]);

  // walk the live dom for the currently-open chat and grab full message text
  // for every bookmarked message. cache only stores 160-char previews so the
  // dom is the only place to get the rest; non-open chats fall back to the
  // preview inside the exporter. dug into [data-message-author-role] to skip
  // role labels and action rows.
  const buildLiveText = useCallback((): Record<string, Record<string, string>> => {
    if (!convId) return {};
    const out: Record<string, string> = {};
    for (const msg of messages) {
      const el = msg.element;
      if (!el || !document.contains(el)) continue;
      const root =
        el.querySelector<HTMLElement>(
          "[data-user-message-bubble], [data-markdown-copy='contents'], [data-dil-message-id], [data-message-author-role]"
        ) ?? el;
      const text = (root.textContent || "").trim();
      if (!text) continue;
      const k = bookmarkKey(convId, msg.domAnchor, msg.chatgptMsgId);
      if (k && bookmarks[k]) out[k] = text;
      const legacy = legacyBookmarkKey(convId, msg.domAnchor);
      if (legacy && bookmarks[legacy]) out[legacy] = text;
    }
    return { [convId]: out };
  }, [convId, messages, bookmarks]);

  if (!isDesktop) {
    // mobile/narrow viewport: rail is hidden, but the export dialog can still
    // be triggered via the keybind, so render just that.
    return showExport ? (
      <ExportDialog
        liveText={buildLiveText()}
        onClose={() => setShowExport(false)}
      />
    ) : null;
  }

  function expand() {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    setExpanded(true);
  }

  function scheduleCollapse() {
    collapseTimer.current = setTimeout(() => setExpanded(false), 300);
  }

  // marker hover handlers — one preview at rail level, snaps text but
  // glides between marker positions
  function handleHoverStart(idx: number) {
    if (previewCloseTimer.current) clearTimeout(previewCloseTimer.current);
    setHoverIdx(idx);
  }

  function handleHoverEnd() {
    // tiny grace so moving across the gap between markers doesn't flicker
    previewCloseTimer.current = setTimeout(() => setHoverIdx(-1), 120);
  }

  function keepPreviewOpen() {
    if (previewCloseTimer.current) clearTimeout(previewCloseTimer.current);
  }

  function goUp() {
    const prev = activeIdx <= 0 ? visible.length - 1 : activeIdx - 1;
    if (visible[prev]) handleScrollTo(visible[prev]);
  }

  function goDown() {
    const next =
      activeIdx < 0 || activeIdx >= visible.length - 1 ? 0 : activeIdx + 1;
    if (visible[next]) handleScrollTo(visible[next]);
  }

  const height = railHeight(visible.length);
  const lastAssistantIdx = (() => {
    for (let i = visible.length - 1; i >= 0; i--) {
      if (visible[i].role === "assistant") return i;
    }
    return -1;
  })();
  // during navigation the visible-extent tracker lags behind the smooth
  // scroll target — promote the nav-callout target so the highlighted
  // marker stays in sync with where the user is actually scrolling to.
  // click-lock wins over the nav-callout override (same target, longer life)
  // which wins over compute's scroll-driven activeIdx.
  const effectiveActiveIdx =
    clickLockIdx >= 0 && clickLockIdx < visible.length
      ? clickLockIdx
      : navCalloutIdx >= 0 && navCalloutIdx < visible.length
      ? navCalloutIdx
      : activeIdx;

  // brief label for the nav callout — bookmark name when set, otherwise
  // the first sentence (or first 48 chars) of the preview text.
  function navCalloutLabel(msg: ChatMessageRecord): string {
    const bm = bookmarkFor(msg);
    if (bm?.name) return bm.name;
    const text = (msg.textPreview || "").trim();
    if (!text) return msg.role === "user" ? "Your message" : "ChatGPT";
    const sentenceEnd = text.search(/[.!?\n]/);
    const sentence =
      sentenceEnd > 4 && sentenceEnd < 80
        ? text.slice(0, sentenceEnd)
        : text.slice(0, 48);
    return sentence.length < text.length ? `${sentence}…` : sentence;
  }

  // tutorial gating: only show on a non-empty chat (so there's something to
  // demo on) and only while the user hasn't completed or dismissed it. step
  // is bounded so a stale future value never re-opens it.
  const tutorialActive =
    settings.tutorialState === "pending" &&
    settings.tutorialStep < 4 &&
    messages.length >= 2;

  const handleTutorialAdvance = useCallback(() => {
    saveSettings({ ...settings, tutorialStep: settings.tutorialStep + 1 });
  }, [settings]);
  const handleTutorialSkip = useCallback(() => {
    saveSettings({ ...settings, tutorialState: "skipped" });
  }, [settings]);
  const handleTutorialComplete = useCallback(() => {
    saveSettings({ ...settings, tutorialState: "completed" });
  }, [settings]);

  return (
    <>
      {showExport && (
        <ExportDialog
          liveText={buildLiveText()}
          onClose={() => setShowExport(false)}
        />
      )}
      {showScanOffer && (
        <ScanOffer
          scanning={isScanning}
          progress={scanProgress}
          onScan={runScan}
          onDismiss={handleDismissScan}
        />
      )}
      {tutorialActive && (
        <Tutorial
          step={settings.tutorialStep}
          bookmarkCount={Object.keys(bookmarks).length}
          quickBookmarkFireCount={quickBookmarkFires}
          exportOpenCount={exportOpens}
          modifierLabel={
            formatKeybind(settings.keybinds.editBookmark) || "Alt + Shift"
          }
          quickKeyLabel={
            formatKeybind(settings.keybinds.quickBookmark) || "B"
          }
          scrollNavLabel={
            formatKeybind(settings.keybinds.scrollNav) || "Alt + Shift"
          }
          nextLabel={
            formatKeybind(settings.keybinds.nextImportant) || "Alt + Shift + S"
          }
          prevLabel={
            formatKeybind(settings.keybinds.prevImportant) || "Alt + Shift + W"
          }
          exportKeyLabel={
            formatKeybind(settings.keybinds.exportBookmarks) || "Alt + Shift + E"
          }
          onAdvance={handleTutorialAdvance}
          onSkip={handleTutorialSkip}
          onComplete={handleTutorialComplete}
        />
      )}
      <div
      className={`rail${expanded ? " rail--expanded" : ""}`}
      style={{ height: `${height}px`, right: `${railRight}px` }}
      onMouseEnter={expand}
      onMouseLeave={scheduleCollapse}
      aria-label="conversation minimap"
      role="navigation"
    >
      <button
        className={`rail-arrow${expanded ? " rail-arrow--visible" : ""}`}
        onClick={goUp}
        aria-label="previous message"
      >
        ▲
      </button>

      <div className="rail-track">
        {visible.map((msg, i) => {
          const topPercent =
            visible.length <= 1
              ? 50
              : (i / (visible.length - 1)) * 92 + 4;
          const globalIdx = messages.indexOf(msg);
          const isActive = i === effectiveActiveIdx;
          const isStreamingTick =
            isStreaming && i === lastAssistantIdx && msg.role === "assistant";

          return (
            <Marker
              key={msg.id}
              msg={msg}
              index={globalIdx}
              topPercent={topPercent}
              settings={settings}
              active={isActive}
              expanded={expanded}
              streaming={isStreamingTick}
              unread={unreadIds.has(msg.id)}
              bookmark={bookmarkFor(msg)}
              onScrollTo={handleScrollTo}
              onEditBookmark={handleEditBookmark}
              onHoverStart={handleHoverStart}
              onHoverEnd={handleHoverEnd}
              hoverIdx={i}
              flash={i === flashIdx}
            />
          );
        })}

        {navCalloutIdx !== -1 &&
          visible[navCalloutIdx] &&
          hoverIdx === -1 &&
          editorIdx === -1 && (
            <div
              key={`nav-${visible[navCalloutIdx].id}`}
              className={`nav-callout nav-callout--${visible[navCalloutIdx].role}`}
              style={{
                top: `${
                  visible.length <= 1
                    ? 50
                    : (navCalloutIdx / (visible.length - 1)) * 92 + 4
                }%`,
              }}
              aria-hidden="true"
            >
              {navCalloutLabel(visible[navCalloutIdx])}
            </div>
          )}

        {hoverIdx !== -1 && visible[hoverIdx] && editorIdx === -1 && (
          <div
            key={visible[hoverIdx].id}
            className="rail-preview"
            style={{
              top: `${
                visible.length <= 1
                  ? 50
                  : (hoverIdx / (visible.length - 1)) * 92 + 4
              }%`,
            }}
            onMouseEnter={keepPreviewOpen}
            onMouseLeave={handleHoverEnd}
          >
            <PreviewCard
              msg={visible[hoverIdx]}
              index={messages.indexOf(visible[hoverIdx])}
              total={messages.length}
              bookmark={bookmarkFor(visible[hoverIdx])}
              onDeleteBookmark={() => handleDeleteBookmark(visible[hoverIdx])}
            />
          </div>
        )}

        {editorIdx !== -1 && visible[editorIdx] && (
          <BookmarkEditor
            msg={visible[editorIdx]}
            existing={bookmarkFor(visible[editorIdx])}
            topPercent={
              visible.length <= 1
                ? 50
                : (editorIdx / (visible.length - 1)) * 92 + 4
            }
            onSave={(patch) => handleSaveBookmark(visible[editorIdx], patch)}
            onDelete={() => handleDeleteBookmark(visible[editorIdx])}
            onClose={() => setEditorIdx(-1)}
          />
        )}
      </div>

      <button
        className={`rail-arrow${expanded ? " rail-arrow--visible" : ""}`}
        onClick={goDown}
        aria-label="next message"
      >
        ▼
      </button>
    </div>
    </>
  );
}
