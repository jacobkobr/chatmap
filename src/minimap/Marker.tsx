import { useState } from "react";
import type { ChatMessageRecord, ThreadMapSettings } from "../shared/types";
import { PreviewCard } from "./PreviewCard";
import { markerVariant } from "./markerClassifier";
import { HIGHLIGHT_DURATION_MS } from "../shared/constants";

interface Props {
  msg: ChatMessageRecord;
  index: number;
  total: number;
  topPercent: number;
  settings: ThreadMapSettings;
  active: boolean;
  expanded: boolean;
}

export function Marker({ msg, index, total, topPercent, settings, active, expanded }: Props) {
  const [hovered, setHovered] = useState(false);
  const variant = markerVariant(msg);

  function scrollToMessage() {
    msg.element.scrollIntoView({
      behavior: settings.reducedMotion ? "instant" : "smooth",
      block: "start",
    });
    msg.element.classList.add("threadmap-highlight");
    setTimeout(() => msg.element.classList.remove("threadmap-highlight"), HIGHLIGHT_DURATION_MS);
  }

  return (
    <div
      className="marker-wrapper"
      style={{ top: `${topPercent}%` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        className={`marker marker--${variant}${active ? " marker--active" : ""}`}
        onClick={scrollToMessage}
        aria-label={`message ${index + 1}: ${msg.textPreview.slice(0, 40)}`}
      />

      {(hovered || (active && expanded)) && (
        <div className="marker-preview">
          <PreviewCard msg={msg} index={index} total={total} />
        </div>
      )}
    </div>
  );
}
