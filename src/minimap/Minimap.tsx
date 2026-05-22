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
import { useBookmarks } from "./useBookmarks";
import { isMarkerVisible } from "./markerClassifier";
import {
  bookmarkKey,
  getConversationId,
  setBookmark,
  deleteBookmark,
} from "../storage/bookmarks";
import { matchesKeybind } from "../shared/keybinds";
import { DESKTOP_MIN_WIDTH, HIGHLIGHT_DURATION_MS } from "../shared/constants";

interface Props {
  adapter: ChatSiteAdapter;
  settings: ChatMapSettings;
}

const TOP_GAP = 110; // px gap from viewport top after scroll

// find chatgpt's scroll container.
// current chatgpt uses [data-scroll-root] — confirmed via devtools (scrollHeight ~41k).
// fall back to largest-scroll-range ancestor for future dom changes.
function findScrollContainer(el: HTMLElement): HTMLElement | null {
  // current chatgpt dom
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
const CANCEL_TOLERANCE = 3;     // px diff that distinguishes user scroll from our writes

function tweenContainerToMessage(
  container: HTMLElement,
  msg: ChatMessageRecord,
  reduced: boolean
) {
  const initial = resolveTarget(msg);
  if (!initial) return;

  const initialDest = Math.max(0, destScrollTop(initial, container));
  const initialDelta = Math.abs(container.scrollTop - initialDest);

  if (reduced || initialDelta < 8) {
    container.scrollTo({ top: initialDest, behavior: "instant" as ScrollBehavior });
    return;
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

  // distinguish a browser-driven scroll shift (chatgpt lazy-loading older
  // turns above the viewport, which forces scrollTop to grow so the visible
  // content stays put) from a genuine user wheel/touch. when scrollHeight
  // grew this frame, we re-baseline startScrollTop and lastWritten so the
  // tween formula keeps aiming at the same visual target instead of giving
  // up and leaving the user halfway there.
  const onUserScroll = () => {
    const sh = container.scrollHeight;
    if (sh !== lastScrollHeight) {
      const shift = container.scrollTop - lastWritten;
      startScrollTop += shift;
      lastWritten = container.scrollTop;
      lastScrollHeight = sh;
      return;
    }
    if (Math.abs(container.scrollTop - lastWritten) > CANCEL_TOLERANCE) {
      cancelled = true;
    }
  };
  container.addEventListener("scroll", onUserScroll, { passive: true });
  const cleanup = () => container.removeEventListener("scroll", onUserScroll);

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
}

// resolve the freshest live dom node for a message. tries (in order):
//   1. the stored element, if still attached
//   2. our stamped data-chatmap-id (cheap, may be stripped by react re-renders)
//   3. the adapter-supplied dom anchor (chatgpt's conversation-turn-N data-testid)
// returns null if nothing resolves — caller should treat that as "virtualized
// out, need to scroll into view first."
function resolveTarget(msg: ChatMessageRecord): HTMLElement | null {
  if (msg.element && document.contains(msg.element)) return msg.element;

  const byId = document.querySelector<HTMLElement>(
    `[data-chatmap-id="${msg.id}"]`
  );
  if (byId) return byId;

  if (msg.domAnchor) {
    // escape attribute value just in case future anchors contain quotes
    const safe = msg.domAnchor.replace(/"/g, '\\"');
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
  return document.querySelector<HTMLElement>(
    "[data-testid^='conversation-turn-']"
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
) {
  const target = resolveTarget(msg);

  if (target) {
    const container = findScrollContainer(target);
    if (container) {
      tweenContainerToMessage(container, msg, reduced);
    } else {
      const eRect = target.getBoundingClientRect();
      window.scrollTo({
        top: Math.max(0, window.scrollY + eRect.top - TOP_GAP),
        behavior: reduced ? "instant" : "smooth",
      });
    }
    return;
  }

  // virtualized: snap toward an estimated scroll position, poll for the
  // element to mount (chatgpt's lazy-load takes ~100-300ms per slice), then
  // run the normal tween once it's resolvable.
  const anyTurn = anyLiveTurn();
  if (!anyTurn) return;
  const container = findScrollContainer(anyTurn);
  if (!container) return;

  const estimate = estimateScrollForIndex(container, msgIdx, totalMessages);
  container.scrollTo({ top: estimate, behavior: "instant" as ScrollBehavior });

  let attempts = 0;
  const tryResolve = () => {
    attempts++;
    const live = resolveTarget(msg);
    if (live) {
      tweenContainerToMessage(container, msg, reduced);
      return;
    }
    if (attempts < 10) setTimeout(tryResolve, 120);
  };
  setTimeout(tryResolve, 180);
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
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  } = useMessageIndex(adapter);
  const [showScanOffer, setShowScanOffer] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const bookmarks = useBookmarks();
  const convId = useMemo(() => getConversationId(), [messages.length]);

  const visible = useMemo(
    () => messages.filter((m) => isMarkerVisible(m, settings)),
    [messages, settings]
  );

  // resolve a bookmark for a message (or undefined). cheap to call from
  // the render loop since the lookup is O(1).
  const bookmarkFor = useCallback(
    (msg: ChatMessageRecord): MessageBookmark | undefined => {
      const k = bookmarkKey(convId, msg.domAnchor);
      return k ? bookmarks[k] : undefined;
    },
    [bookmarks, convId]
  );

  // keep transient indices in range when the visible set shrinks
  useEffect(() => {
    if (hoverIdx >= visible.length) setHoverIdx(-1);
    if (editorIdx >= visible.length) setEditorIdx(-1);
  }, [visible.length, hoverIdx, editorIdx]);

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

      // scan the dom for the highest conversation-turn-N. that tells us
      // how far chatgpt's currently-rendered slice reaches.
      let maxDomTurn = 0;
      let domTurns = 0;
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

      const waitForStable = async () => {
        const startTs = performance.now();
        let lastCount = document.querySelectorAll(
          "[data-testid^='conversation-turn-']"
        ).length;
        let lastChangeTs = startTs;
        while (true) {
          await new Promise((r) => setTimeout(r, 80));
          const elapsed = performance.now() - startTs;
          const now = document.querySelectorAll(
            "[data-testid^='conversation-turn-']"
          ).length;
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

  // active tick tracks the message the user is actually looking at.
  // for each visible message, compute how much of it is on screen
  // (rect clamped to the viewport). the one with the greatest visible
  // extent wins — a long assistant turn dominating the viewport, a
  // short msg fully in view, etc. ties (within 1px) break toward the
  // lower message, which naturally lands on the bottom message when
  // several short ones all sit at the end of the conversation. no
  // bandaid edge cases — the same rule applies everywhere.
  useEffect(() => {
    if (visible.length === 0) {
      setActiveIdx(-1);
      return;
    }

    const firstLive = resolveTarget(visible[0]);
    const container = firstLive ? findScrollContainer(firstLive) : null;
    const scrollTarget: HTMLElement | Window = container ?? window;

    // score = visible extent + a large boost if the message's top edge
    // is sitting at the scroll-target reading position (TOP_GAP). that
    // way a message just scrolled to via click or keybind wins the
    // highlight even if the assistant turn right below it covers more
    // viewport area. for normal mid-conversation scrolling, no message
    // happens to sit exactly at TOP_GAP, so visible extent decides
    // unchanged.
    const READING_BOOST_WINDOW = 14; // px tolerance around TOP_GAP
    const READING_BOOST = 1e6;       // wins any reasonable extent comparison

    let raf = 0;
    const compute = () => {
      raf = 0;
      const vh = window.innerHeight;
      let active = -1;
      let bestScore = -1;
      let bestBottom = -Infinity;

      for (let i = 0; i < visible.length; i++) {
        const el = resolveTarget(visible[i]);
        if (!el || !document.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < vh) markRead(visible[i].id);

        // clamp visTop to TOP_GAP: chatgpt's sticky top header (~110px) hides
        // anything above it, so messages partially behind the header shouldn't
        // count toward visible extent — otherwise the active highlight locks
        // to a marker the user can't actually see.
        const visTop = Math.max(TOP_GAP, r.top);
        const visBot = Math.min(vh, r.bottom);
        const extent = visBot - visTop;
        if (extent <= 0) continue;

        const atReadingLine =
          r.top > TOP_GAP - READING_BOOST_WINDOW &&
          r.top < TOP_GAP + READING_BOOST_WINDOW;
        const score = extent + (atReadingLine ? READING_BOOST : 0);

        const better =
          score > bestScore + 1 ||
          (Math.abs(score - bestScore) <= 1 && visBot > bestBottom);
        if (better) {
          bestScore = score;
          bestBottom = visBot;
          active = i;
        }
      }

      setActiveIdx(active);
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
    };
  }, [visible, markRead]);

  // raw scroll + highlight without any nav-state side effects. used by
  // both the regular marker click path and the keybind jump path. when the
  // target is virtualized out (cache-only marker), the highlight is applied
  // after the dom node mounts in response to the estimated scroll.
  const performNavigate = useCallback(
    (msg: ChatMessageRecord) => {
      suppressRefresh(900);
      const idx = visible.indexOf(msg);
      scrollToMessage(
        msg,
        settings.reducedMotion,
        idx >= 0 ? idx : 0,
        visible.length
      );

      // outline the message body (chatgpt's `[data-message-author-role]`
      // element) rather than the whole conversation-turn wrapper, which
      // also includes the role label and action row and produces a much
      // baggier outline than feels right.
      const applyHighlight = (turn: HTMLElement) => {
        const inner =
          turn.querySelector<HTMLElement>("[data-message-author-role]") ?? turn;
        inner.classList.add("chatmap-highlight");
        setTimeout(
          () => inner.classList.remove("chatmap-highlight"),
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
    [suppressRefresh, settings.reducedMotion, visible]
  );

  // marker click — same scroll but resets the keybind-nav anchor so the
  // next w/s starts from wherever the user actually clicked.
  const handleScrollTo = useCallback(
    (msg: ChatMessageRecord) => {
      lastNavIdxRef.current = null;
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
  // (color/name/note) were provided — empty bookmark = remove.
  const handleSaveBookmark = useCallback(
    async (msg: ChatMessageRecord, patch: MessageBookmark) => {
      const k = bookmarkKey(convId, msg.domAnchor);
      if (!k) {
        setEditorIdx(-1);
        return;
      }
      if (!patch.color && !patch.name && !patch.note) {
        await deleteBookmark(k);
      } else {
        await setBookmark(k, patch);
      }
      setEditorIdx(-1);
    },
    [convId]
  );

  const handleDeleteBookmark = useCallback(
    async (msg: ChatMessageRecord) => {
      const k = bookmarkKey(convId, msg.domAnchor);
      if (k) await deleteBookmark(k);
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
      // ignore when typing in an input/textarea — don't steal user keystrokes
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement | null)?.isContentEditable
      ) {
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

  if (!isDesktop) return null;

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

  return (
    <>
      {showScanOffer && (
        <ScanOffer
          scanning={isScanning}
          progress={scanProgress}
          onScan={runScan}
          onDismiss={handleDismissScan}
        />
      )}
      <div
      className={`rail${expanded ? " rail--expanded" : ""}`}
      style={{ height: `${height}px` }}
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
          const isActive = i === activeIdx;
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
            />
          );
        })}

        {hoverIdx !== -1 && visible[hoverIdx] && editorIdx === -1 && (
          <div
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
