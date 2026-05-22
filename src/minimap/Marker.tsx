import type { ChatMessageRecord, ThreadMapSettings } from "../shared/types";
import { markerVariant } from "./markerClassifier";

interface Props {
  msg: ChatMessageRecord;
  index: number;
  topPercent: number;
  settings: ThreadMapSettings;
  active: boolean;
  expanded: boolean;
  streaming: boolean;
  unread: boolean;
  onScrollTo: (msg: ChatMessageRecord) => void;
  onHoverStart: (idx: number) => void;
  onHoverEnd: () => void;
  hoverIdx: number;
}

export function Marker({
  msg,
  index,
  topPercent,
  active,
  streaming,
  unread,
  onScrollTo,
  onHoverStart,
  onHoverEnd,
  hoverIdx,
}: Props) {
  const variant = markerVariant(msg);

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
      onMouseEnter={() => onHoverStart(hoverIdx)}
      onMouseLeave={onHoverEnd}
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
    </div>
  );
}
