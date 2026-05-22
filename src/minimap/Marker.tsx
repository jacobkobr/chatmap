import { useCallback } from "react";
import type {
  ChatMessageRecord,
  MessageBookmark,
  ChatMapSettings,
} from "../shared/types";
import { markerVariant } from "./markerClassifier";
import { matchesKeybind } from "../shared/keybinds";

interface Props {
  msg: ChatMessageRecord;
  index: number;
  topPercent: number;
  settings: ChatMapSettings;
  active: boolean;
  expanded: boolean;
  streaming: boolean;
  unread: boolean;
  bookmark: MessageBookmark | undefined;
  onScrollTo: (msg: ChatMessageRecord) => void;
  onEditBookmark: (idx: number) => void;
  onHoverStart: (idx: number) => void;
  onHoverEnd: () => void;
  hoverIdx: number;
}

export function Marker({
  msg,
  index,
  topPercent,
  settings,
  active,
  streaming,
  unread,
  bookmark,
  onScrollTo,
  onEditBookmark,
  onHoverStart,
  onHoverEnd,
  hoverIdx,
}: Props) {
  const variant = markerVariant(msg);
  const isImportant = !!bookmark;

  // mod-click opens the bookmark editor; plain click scrolls to the
  // message. matched against the configured keybind so the modifier
  // combo can be changed in settings.
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (matchesKeybind(e, settings.keybinds.editBookmark, false)) {
        e.preventDefault();
        e.stopPropagation();
        onEditBookmark(hoverIdx);
        return;
      }
      onScrollTo(msg);
    },
    [msg, hoverIdx, settings.keybinds.editBookmark, onScrollTo, onEditBookmark]
  );

  const classes = [
    "marker",
    `marker--${variant}`,
    active ? "marker--active" : "",
    streaming ? "marker--streaming" : "",
    isImportant ? "marker--important" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // custom bookmark color overrides the role-based default
  const inlineStyle = bookmark?.color ? { background: bookmark.color } : undefined;

  return (
    <div
      className="marker-wrapper"
      style={{ top: `${topPercent}%` }}
      onMouseEnter={() => onHoverStart(hoverIdx)}
      onMouseLeave={onHoverEnd}
    >
      <button
        className={classes}
        style={inlineStyle}
        onClick={handleClick}
        aria-label={`message ${index + 1}${
          bookmark?.name ? `: ${bookmark.name}` : ""
        }`}
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
      {isImportant && <span className="marker-star" aria-hidden="true" />}
    </div>
  );
}
