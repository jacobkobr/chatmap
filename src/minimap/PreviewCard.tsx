import type { ChatMessageRecord, MessageBookmark } from "../shared/types";
import { featureLabels } from "./markerClassifier";

interface Props {
  msg: ChatMessageRecord;
  index: number;
  total: number;
  bookmark?: MessageBookmark;
  onDeleteBookmark?: () => void;
}

const BADGE_ICONS: Record<string, string> = {
  code: "⌥",
  link: "↗",
  image: "▣",
  long: "≡",
};

export function PreviewCard({ msg, index, total, bookmark, onDeleteBookmark }: Props) {
  const badges = featureLabels(msg);
  const cardClass = bookmark ? "preview-card preview-card--bookmarked" : "preview-card";
  // only ChatGPT replies show a role label — user turns are obvious from
  // context and the redundant "you" was just noise in the preview.
  const showRoleLabel = msg.role === "assistant";

  const meta = (
    <div className="preview-header-right">
      <span className="preview-pos">
        {index + 1} / {total}
      </span>
      {bookmark && onDeleteBookmark && (
        <button
          type="button"
          className="preview-bookmark-remove"
          aria-label="remove bookmark"
          title="remove bookmark"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteBookmark();
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>
      )}
    </div>
  );

  const badgeRow = badges.length > 0 && (
    <span className="preview-badges">
      {badges.map((b) => (
        <span key={b} className="preview-badge" title={b}>
          {BADGE_ICONS[b] ?? b}
        </span>
      ))}
    </span>
  );

  return (
    <div className={cardClass}>
      {showRoleLabel ? (
        <div className="preview-header">
          <span className="preview-header-left">
            <span className={`preview-role preview-role--${msg.role}`}>
              ChatGPT
            </span>
            {badgeRow}
          </span>
          {meta}
        </div>
      ) : (
        // user previews skip the header row entirely — the role label was
        // just "You" which adds nothing. float the meta into the card's
        // top-right corner instead so the body content starts at the top.
        <div className="preview-meta-float">{meta}</div>
      )}

      {bookmark?.name && (
        <div className="preview-bookmark-name" style={{ color: bookmark.color }}>
          {bookmark.color && (
            <span
              className="preview-bookmark-dot"
              style={{ background: bookmark.color }}
              aria-hidden="true"
            />
          )}
          {bookmark.name}
        </div>
      )}

      {bookmark?.note && (
        <p className="preview-bookmark-note">{bookmark.note}</p>
      )}

      {/* user previews keep the badge row below since they have no
          header to dock it into. assistant previews show badges inline
          next to "ChatGPT" above. */}
      {!showRoleLabel && badgeRow}

      <p className="preview-text">{msg.textPreview}</p>
    </div>
  );
}
