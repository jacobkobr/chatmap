import { useState, useEffect } from "react";
import type { ThreadMapSettings } from "../shared/types";
import type { ChatSiteAdapter } from "../adapters/types";
import { useMessageIndex } from "./useMessageIndex";
import { Marker } from "./Marker";
import { isMarkerVisible } from "./markerClassifier";
import { clamp } from "../shared/utils";

interface Props {
  adapter: ChatSiteAdapter;
  settings: ThreadMapSettings;
}

function scrollToIndex(el: HTMLElement, reduced: boolean) {
  el.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "start" });
}

export function Minimap({ adapter, settings }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const { messages, scrollHeight } = useMessageIndex(adapter);

  const visible = messages.filter((m) => isMarkerVisible(m, settings));

  // track which message is closest to the current scroll position
  useEffect(() => {
    function onScroll() {
      const mid = window.scrollY + window.innerHeight / 3;
      let best = -1;
      let bestDist = Infinity;
      visible.forEach((m, i) => {
        const dist = Math.abs(m.top - mid);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      setActiveIdx(best);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [visible]);

  function goUp() {
    const prev = activeIdx <= 0 ? visible.length - 1 : activeIdx - 1;
    if (visible[prev]) scrollToIndex(visible[prev].element, settings.reducedMotion);
  }

  function goDown() {
    const next = activeIdx < 0 || activeIdx >= visible.length - 1 ? 0 : activeIdx + 1;
    if (visible[next]) scrollToIndex(visible[next].element, settings.reducedMotion);
  }

  return (
    <div
      className={`rail${expanded ? " rail--expanded" : ""}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      aria-label="conversation minimap"
      role="navigation"
    >
      <button className="rail-arrow" onClick={goUp} aria-label="previous message">
        ▲
      </button>

      <div className="rail-track">
        {visible.map((msg) => {
          const topPercent = clamp((msg.top / scrollHeight) * 100, 0, 99);
          const idx = messages.indexOf(msg);
          return (
            <Marker
              key={msg.id}
              msg={msg}
              index={idx}
              total={messages.length}
              topPercent={topPercent}
              settings={settings}
              active={idx === messages.indexOf(visible[activeIdx] ?? ({} as never))}
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
