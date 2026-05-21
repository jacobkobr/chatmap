import { useState, useEffect, useRef } from "react";
import type { ThreadMapSettings } from "../shared/types";
import type { ChatSiteAdapter } from "../adapters/types";
import { useMessageIndex } from "./useMessageIndex";
import { Marker } from "./Marker";
import { isMarkerVisible } from "./markerClassifier";

interface Props {
  adapter: ChatSiteAdapter;
  settings: ThreadMapSettings;
}

function scrollTo(el: HTMLElement, reduced: boolean) {
  el.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "start" });
}

// 14px per message, clamped between 80px and 85% of viewport
function railHeight(count: number): number {
  const raw = Math.max(count, 6) * 14;
  return Math.min(raw, Math.round(window.innerHeight * 0.85));
}

export function Minimap({ adapter, settings }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { messages } = useMessageIndex(adapter);

  const visible = messages.filter((m) => isMarkerVisible(m, settings));

  // track viewport scroll position to highlight nearest marker
  useEffect(() => {
    function update() {
      const mid = window.scrollY + window.innerHeight * 0.35;
      let best = -1;
      let bestDist = Infinity;
      visible.forEach((m, i) => {
        const dist = Math.abs(m.top - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setActiveIdx(best);
    }
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => window.removeEventListener("scroll", update);
  }, [visible]);

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

  return (
    <div
      className={`rail${expanded ? " rail--expanded" : ""}`}
      style={{ height: `${height}px` }}
      onMouseEnter={expand}
      onMouseLeave={scheduleCollapse}
      aria-label="conversation minimap"
      role="navigation"
    >
      <button className="rail-arrow" onClick={goUp} aria-label="previous message">
        ▲
      </button>

      <div className="rail-track">
        {visible.map((msg, i) => {
          // even distribution — one slot per turn regardless of message length
          const topPercent =
            visible.length <= 1
              ? 50
              : (i / (visible.length - 1)) * 92 + 4;
          const globalIdx = messages.indexOf(msg);
          const isActive = visible[activeIdx] === msg;

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
            />
          );
        })}
      </div>

      <button className="rail-arrow" onClick={goDown} aria-label="next message">
        ▼
      </button>
    </div>
  );
}
