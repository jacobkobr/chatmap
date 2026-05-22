import type { ChatMessageRecord, MessageBookmark } from "../shared/types";
import { featureLabels } from "./markerClassifier";

interface Props {
  msg: ChatMessageRecord;
  index: number;
  total: number;
  bookmark?: MessageBookmark;
}

const BADGE_ICONS: Record<string, string> = {
  code: "⌥",
  link: "↗",
  image: "▣",
  long: "≡",
};

export function PreviewCard({ msg, index, total, bookmark }: Props) {
  const roleLabel = msg.role === "user" ? "You" : "ChatGPT";
  const badges = featureLabels(msg);
  const cardClass = bookmark ? "preview-card preview-card--bookmarked" : "preview-card";

  return (
    <div className={cardClass}>
      <div className="preview-header">
        <span className={`preview-role preview-role--${msg.role}`}>
          {roleLabel}
        </span>
        <span className="preview-pos">
          {index + 1} / {total}
        </span>
      </div>

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

      {badges.length > 0 && (
        <div className="preview-badges">
          {badges.map((b) => (
            <span key={b} className="preview-badge" title={b}>
              {BADGE_ICONS[b] ?? b}
            </span>
          ))}
        </div>
      )}

      <p className="preview-text">{msg.textPreview}</p>
    </div>
  );
}
