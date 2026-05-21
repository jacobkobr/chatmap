import { useState, useRef } from "react";
import type { ChatMessageRecord, ThreadMapSettings } from "../shared/types";
import { PreviewCard } from "./PreviewCard";
import { markerVariant } from "./markerClassifier";

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
  onScrollTo: (msg: ChatMessageRecord) => void;
}

export function Marker({
  msg,
  index,
  total,
  topPercent,
  active,
  streaming,
  unread,
  onScrollTo,
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
        onClick={() => onScrollTo(msg)}
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
