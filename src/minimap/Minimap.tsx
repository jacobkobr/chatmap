import { useState, useEffect, useRef, useMemo } from "react";
import type { ThreadMapSettings } from "../shared/types";
import type { ChatSiteAdapter } from "../adapters/types";
import { useMessageIndex } from "./useMessageIndex";
import { Marker } from "./Marker";
import { isMarkerVisible } from "./markerClassifier";
import { DESKTOP_MIN_WIDTH } from "../shared/constants";

interface Props {
  adapter: ChatSiteAdapter;
  settings: ThreadMapSettings;
}

const TOP_GAP = 72; // px gap from viewport top after scroll

function scrollTo(el: HTMLElement, reduced: boolean) {
  const behavior = reduced ? "instant" : "smooth";
  const rect = el.getBoundingClientRect();

  // find inner scroll container (chatgpt uses one inside main)
  let container: HTMLElement | null = el.parentElement;
  while (container && container !== document.body) {
    const s = getComputedStyle(container);
    if (s.overflowY === "auto" || s.overflowY === "scroll") break;
    container = container.parentElement;
  }

  if (container && container !== document.body) {
    const cRect = container.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + rect.top - cRect.top - TOP_GAP,
      behavior,
    });
  } else {
    window.scrollTo({
      top: window.scrollY + rect.top - TOP_GAP,
      behavior,
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
  const { messages, isStreaming, unreadIds, markRead } = useMessageIndex(adapter);

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
    if (visible[prev]) scrollTo(visible[prev].element, settings.reducedMotion);
  }

  function goDown() {
    const next =
      activeIdx < 0 || activeIdx >= visible.length - 1 ? 0 : activeIdx + 1;
    if (visible[next]) scrollTo(visible[next].element, settings.reducedMotion);
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
