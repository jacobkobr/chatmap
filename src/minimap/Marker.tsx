import { useState, useRef } from "react";
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
  streaming: boolean;
  unread: boolean;
}

export function Marker({
  msg,
  index,
  total,
  topPercent,
  settings,
  active,
  streaming,
  unread,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const variant = markerVariant(msg);

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  function scheduleClose() {
    closeTimer.current = setTimeout(() => setHovered(false), 260);
  }

  function scrollToMessage() {
    msg.element.scrollIntoView({
      behavior: settings.reducedMotion ? "instant" : "smooth",
      block: "start",
    });
    msg.element.classList.add("threadmap-highlight");
    setTimeout(
      () => msg.element.classList.remove("threadmap-highlight"),
      HIGHLIGHT_DURATION_MS
    );
  }

  const classes = [
    "marker",
    `marker--${variant}`,
    active ? "marker--active" : "",
    streaming ? "marker--streaming" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="marker-wrapper"
      style={{ top: `${topPercent}%` }}
      onMouseEnter={() => {
        cancelClose();
        setHovered(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        className={classes}
        onClick={scrollToMessage}
        aria-label={`message ${index + 1}: ${msg.textPreview.slice(0, 40)}`}
      >
        {streaming ? (
          <span className="marker-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : unread ? (
          <span className="marker-unread-dot" aria-hidden="true" />
        ) : null}
      </button>

      {hovered && (
        <div
          className="marker-preview"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <PreviewCard msg={msg} index={index} total={total} />
        </div>
      )}
    </div>
  );
}
