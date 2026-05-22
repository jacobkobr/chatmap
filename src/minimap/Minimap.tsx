import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { ChatMessageRecord, ThreadMapSettings } from "../shared/types";
import type { ChatSiteAdapter } from "../adapters/types";
import { useMessageIndex } from "./useMessageIndex";
import { Marker } from "./Marker";
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

// custom rAF tween with fixed duration.
//
// chrome's native scrollTo({behavior:"smooth"}) is unusable here — its
// duration scales with distance, so far jumps take 5+ seconds of slow
// easing. lazy-load also inserts content mid-animation which shifts the
// target's position. instead we run our own tween with:
//   - capped duration regardless of distance (feels snappy on big jumps)
//   - ease-out cubic for natural deceleration
//   - per-frame dest re-measurement so lazy-load shifts get absorbed
//   - scrollTo({behavior:"instant"}) writes (avoids the compositor
//     tearing/duplication bug seen with raw .scrollTop assignments)
//   - correction passes after the tween for slow lazy-load batches
//   - manual scroll cancels the tween mid-flight
const SCROLL_DURATION_MS = 460;
const EARLY_CANCEL_TOLERANCE = 3; // ignore the tween's own scroll writes

function scrollContainerTo(container: HTMLElement, el: HTMLElement, reduced: boolean) {
  const measure = (): number => Math.max(0, destScrollTop(el, container));

  const finalSnap = (): boolean => {
    if (!document.contains(el)) return true;
    const dest = measure();
    if (Math.abs(container.scrollTop - dest) < 2) return true;
    container.scrollTo({ top: dest, behavior: "instant" as ScrollBehavior });
    return false;
  };

  // reduced-motion or tiny distance — just snap and skip the tween
  const initialDest = measure();
  const initialDelta = Math.abs(container.scrollTop - initialDest);
  if (reduced || initialDelta < 8) {
    finalSnap();
    runCorrectionPasses(finalSnap);
    return;
  }

  const start = container.scrollTop;
  const startTime = performance.now();
  let lastWritten = start;
  let cancelled = false;

  // cancel on real user scroll (wheel, touch). our own writes match
  // lastWritten within a few px so we ignore them.
  const onUserScroll = () => {
    if (Math.abs(container.scrollTop - lastWritten) > EARLY_CANCEL_TOLERANCE) {
      cancelled = true;
    }
  };
  container.addEventListener("scroll", onUserScroll, { passive: true });

  // ease-out cubic — fast start, gentle finish
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);

  const step = (now: number) => {
    if (cancelled || !document.contains(el)) {
      container.removeEventListener("scroll", onUserScroll);
      return;
    }
    const t = Math.min(1, (now - startTime) / SCROLL_DURATION_MS);
    // re-measure dest every frame — absorbs lazy-load shifts mid-tween
    const dest = measure();
    const next = Math.round(start + (dest - start) * ease(t));
    lastWritten = next;
    container.scrollTo({ top: next, behavior: "instant" as ScrollBehavior });

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      container.removeEventListener("scroll", onUserScroll);
      // post-tween correction: lazy-load that fires after the tween ends
      // can still shift the target. these passes catch it.
      runCorrectionPasses(finalSnap);
    }
  };

  requestAnimationFrame(step);
}

function runCorrectionPasses(snap: () => boolean) {
  setTimeout(() => {
    if (snap()) return;
    setTimeout(() => {
      if (snap()) return;
      setTimeout(snap, 350);
    }, 220);
  }, 120);
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
    scrollContainerTo(container, target, reduced);
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
  const [isDesktop, setIsDesktop] = useState(
    () => window.innerWidth >= DESKTOP_MIN_WIDTH
  );
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { messages, isStreaming, unreadIds, markRead, suppressRefresh } =
    useMessageIndex(adapter);

  const visible = useMemo(
    () => messages.filter((m) => isMarkerVisible(m, settings)),
    [messages, settings]
  );

  // desktop-only: hide minimap on narrow viewports
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= DESKTOP_MIN_WIDTH);
    window.addEventListener("resize", check, { passive: true });
    return () => window.removeEventListener("resize", check);
  }, []);

  // IntersectionObserver — active tick tracks the topmost visible message
  useEffect(() => {
    if (visible.length === 0) return;

    const currentlyVisible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const msg = visible.find((m) => m.element === entry.target);
          if (!msg) return;
          if (entry.isIntersecting) {
            currentlyVisible.add(msg.id);
            markRead(msg.id);
          } else {
            currentlyVisible.delete(msg.id);
          }
        });

        // active = topmost message currently intersecting the reading zone
        const idx = visible.findIndex((m) => currentlyVisible.has(m.id));
        if (idx !== -1) setActiveIdx(idx);
      },
      // reading zone: top 5% to 45% of viewport
      { threshold: 0.1, rootMargin: "-5% 0px -55% 0px" }
    );

    visible.forEach((m) => observer.observe(m.element));
    return () => observer.disconnect();
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
              total={messages.length}
              topPercent={topPercent}
              settings={settings}
              active={isActive}
              expanded={expanded}
              streaming={isStreamingTick}
              unread={unreadIds.has(msg.id)}
              onScrollTo={handleScrollTo}
            />
          );
        })}
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
