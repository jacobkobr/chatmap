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

// find the real scroll container by walking up from the element.
// we require scrollHeight > clientHeight so we skip overflow:auto wrappers
// that happen to have the property set but contain no overflow.
function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const s = getComputedStyle(node);
    const scrollable = s.overflowY === "auto" || s.overflowY === "scroll";
    if (scrollable && node.scrollHeight > node.clientHeight + 4) return node;
    node = node.parentElement;
  }
  // fallback: walk DOWN from main to find the first truly scrollable div
  const main = document.querySelector<HTMLElement>("main");
  if (main) {
    const found = findScrollableDown(main, 0);
    if (found) return found;
  }
  return null;
}

function findScrollableDown(el: HTMLElement, depth: number): HTMLElement | null {
  if (depth > 8) return null;
  const s = getComputedStyle(el);
  if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 4) return el;
  for (const child of el.children) {
    const r = findScrollableDown(child as HTMLElement, depth + 1);
    if (r) return r;
  }
  return null;
}

function scrollToElement(el: HTMLElement, reduced: boolean) {
  const behavior: ScrollBehavior = reduced ? "instant" : "smooth";

  // if el was removed from DOM by chatgpt, look it up by stamped id
  let target = el;
  if (!document.contains(target)) {
    const fresh = target.dataset.threadmapId
      ? document.querySelector<HTMLElement>(`[data-threadmap-id="${target.dataset.threadmapId}"]`)
      : null;
    if (!fresh) return;
    target = fresh;
  }

  const container = findScrollContainer(target);
  if (container) {
    const cRect = container.getBoundingClientRect();
    const eRect = target.getBoundingClientRect();
    const scrollTo = container.scrollTop + (eRect.top - cRect.top) - TOP_GAP;
    container.scrollTo({ top: Math.max(0, scrollTo), behavior });
  } else {
    const eRect = target.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, window.scrollY + eRect.top - TOP_GAP), behavior });
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

  // scroll to a message — suppress observer during chatgpt's lazy-render window
  const handleScrollTo = useCallback(
    (msg: ChatMessageRecord) => {
      suppressRefresh(900);
      scrollToElement(msg.element, settings.reducedMotion);
      msg.element.classList.add("threadmap-highlight");
      setTimeout(
        () => msg.element.classList.remove("threadmap-highlight"),
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
