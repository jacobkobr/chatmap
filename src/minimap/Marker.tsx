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
}

export function Marker({ msg, index, total, topPercent, settings }: Props) {
  const [hovered, setHovered] = useState(false);
  const variant = markerVariant(msg);

  function scrollToMessage() {
    const el = msg.element;
    el.scrollIntoView({
      behavior: settings.reducedMotion ? "instant" : "smooth",
      block: "start",
    });

    // brief highlight — adds a class then removes it
    el.classList.add("threadmap-highlight");
    setTimeout(() => el.classList.remove("threadmap-highlight"), HIGHLIGHT_DURATION_MS);
  }

  return (
    <div
      className="marker-wrapper"
      style={{ top: `${topPercent}%` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        className={`marker marker--${variant}`}
        onClick={scrollToMessage}
        aria-label={`go to message ${index + 1}: ${msg.textPreview.slice(0, 40)}`}
      />

      {hovered && (
        <div className="marker-preview">
          <PreviewCard msg={msg} index={index} total={total} />
        </div>
      )}
    </div>
  );
}
