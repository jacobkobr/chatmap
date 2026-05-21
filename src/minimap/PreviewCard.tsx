import type { ChatMessageRecord } from "../shared/types";
import { featureLabels } from "./markerClassifier";

interface Props {
  msg: ChatMessageRecord;
  index: number;
  total: number;
}

const BADGE_ICONS: Record<string, string> = {
  code: "⌥",
  link: "↗",
  image: "▣",
  long: "≡",
};

export function PreviewCard({ msg, index, total }: Props) {
  const roleLabel = msg.role === "user" ? "You" : "ChatGPT";
  const badges = featureLabels(msg);

  return (
    <div className="preview-card">
      <div className="preview-header">
        <span className={`preview-role preview-role--${msg.role}`}>
          {roleLabel}
        </span>
        <span className="preview-pos">
          {index + 1} / {total}
        </span>
      </div>

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
