import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { ChatMessageRecord, ThreadMapSettings } from "../shared/types";
import type { ChatSiteAdapter } from "../adapters/types";
import { useMessageIndex } from "./useMessageIndex";
import { Marker } from "./Marker";
import { PreviewCard } from "./PreviewCard";
import { isMarkerVisible } from "./markerClassifier";
import { DESKTOP_MIN_WIDTH, HIGHLIGHT_DURATION_MS } from "../shared/constants";

interface Props {
  adapter: ChatSiteAdapter;
  settings: ThreadMapSettings;
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

  const startScrollTop = container.scrollTop;
  const startTime = performance.now();
  let lastWritten = startScrollTop;
  let cancelled = false;
  let stableFrames = 0;
  let cachedTarget: HTMLElement | null = initial;

  const resolveCached = (): HTMLElement | null => {
    if (cachedTarget && document.contains(cachedTarget)) return cachedTarget;
    cachedTarget = resolveTarget(msg);
    return cachedTarget;
  };

  const onUserScroll = () => {
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
//   2. our stamped data-threadmap-id (cheap, may be stripped by react re-renders)
//   3. the adapter-supplied dom anchor (chatgpt's conversation-turn-N data-testid)
// returns null if nothing resolves — caller should bail rather than scroll wrong.
function resolveTarget(msg: ChatMessageRecord): HTMLElement | null {
  if (document.contains(msg.element)) return msg.element;

  const byId = document.querySelector<HTMLElement>(
    `[data-threadmap-id="${msg.id}"]`
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

function scrollToMessage(msg: ChatMessageRecord, reduced: boolean) {
  const target = resolveTarget(msg);
  if (!target) return;

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
  const [isDesktop, setIsDesktop] = useState(
    () => window.innerWidth >= DESKTOP_MIN_WIDTH
  );
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { messages, isStreaming, unreadIds, markRead, suppressRefresh } =
    useMessageIndex(adapter);

  const visible = useMemo(
    () => messages.filter((m) => isMarkerVisible(m, settings)),
    [messages, settings]
  );

  // keep hoverIdx in range when the visible set shrinks
  useEffect(() => {
    if (hoverIdx >= visible.length) setHoverIdx(-1);
  }, [visible.length, hoverIdx]);

  // desktop-only: hide minimap on narrow viewports
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= DESKTOP_MIN_WIDTH);
    window.addEventListener("resize", check, { passive: true });
    return () => window.removeEventListener("resize", check);
  }, []);

  // active tick tracks the message the user is actually reading.
  // intersection observer was unreliable here — a long assistant turn can
  // stay "intersecting" the reading zone for the entire scroll past it,
  // so the active marker would stick to a turn the user has already left.
  // instead we recompute on every scroll frame: active = last message whose
  // top edge is at or above the reading line (about 30% from viewport top).
  // also marks anything currently on-screen as read.
  useEffect(() => {
    if (visible.length === 0) {
      setActiveIdx(-1);
      return;
    }

    const firstLive = resolveTarget(visible[0]);
    const container = firstLive ? findScrollContainer(firstLive) : null;
    const scrollTarget: HTMLElement | Window = container ?? window;

    let raf = 0;
    const compute = () => {
      raf = 0;
      const vh = window.innerHeight;
      const readingLine = vh * 0.30;
      let active = -1;
      for (let i = 0; i < visible.length; i++) {
        const el = resolveTarget(visible[i]);
        if (!el || !document.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < vh) markRead(visible[i].id);
        if (r.top <= readingLine) active = i;
      }

      // scroll-edge overrides — when the conversation is scrolled all the
      // way to the bottom, the user is reading the latest message even if
      // a short cluster of recent messages all sit above the reading line.
      // (without this, the reading-line walk would pick the topmost of the
      // cluster instead of the most recent.) likewise for the very top.
      if (visible.length > 0) {
        const sTop = container ? container.scrollTop : window.scrollY;
        const sHeight = container
          ? container.scrollHeight
          : document.documentElement.scrollHeight;
        const cHeight = container ? container.clientHeight : vh;
        const remaining = sHeight - sTop - cHeight;
        if (remaining < 24) active = visible.length - 1;
        else if (sTop < 24) active = 0;
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

  // scroll to a message — suppress observer during chatgpt's lazy-render window.
  // resolve the live dom node here too so the highlight lands on the same
  // element we're actually scrolling to.
  const handleScrollTo = useCallback(
    (msg: ChatMessageRecord) => {
      suppressRefresh(900);
      const target = resolveTarget(msg);
      if (!target) return;
      scrollToMessage(msg, settings.reducedMotion);
      target.classList.add("threadmap-highlight");
      setTimeout(
        () => target.classList.remove("threadmap-highlight"),
        HIGHLIGHT_DURATION_MS
      );
    },
    [suppressRefresh, settings.reducedMotion]
  );

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
              onScrollTo={handleScrollTo}
              onHoverStart={handleHoverStart}
              onHoverEnd={handleHoverEnd}
              hoverIdx={i}
            />
          );
        })}

        {hoverIdx !== -1 && visible[hoverIdx] && (
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
            />
          </div>
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
  );
}
