import { useEffect, useRef, useState } from "react";
import type { ChatMessageRecord, MessageBookmark } from "../shared/types";

interface Props {
  msg: ChatMessageRecord;
  existing: MessageBookmark | undefined;
  topPercent: number;
  onSave: (patch: MessageBookmark) => void;
  onDelete: () => void;
  onClose: () => void;
}

const NAME_MAX = 48;
const NOTE_MAX = 400;
const NO_COLOR_HUE = -1;

// converts hue (0-360) to a saturated marker color. matches the palette
// vibe used by accent colors so custom-colored markers feel native.
function hueToColor(hue: number): string {
  return `hsl(${hue}, 72%, 60%)`;
}

// extracts hue from a stored "hsl(H, S%, L%)" string. returns -1 (no color)
// when the stored value isn't in our format.
function colorToHue(color: string | undefined): number {
  if (!color) return NO_COLOR_HUE;
  const m = color.match(/^hsl\(\s*(-?\d+(?:\.\d+)?)/i);
  if (!m) return NO_COLOR_HUE;
  return Math.max(0, Math.min(360, parseFloat(m[1])));
}

export function BookmarkEditor({
  msg,
  existing,
  topPercent,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [hue, setHue] = useState<number>(colorToHue(existing?.color));
  const [name, setName] = useState(existing?.name ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const rootRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // close on escape, outside click.
  // shadow dom: events bubbling out of the shadow root retarget to the
  // shadow host, so e.target lies about which element was clicked. use
  // composedPath() to see the real chain including elements inside the
  // shadow root — otherwise every click inside the editor looked like
  // an outside click and closed the panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    function onDown(e: MouseEvent) {
      const root = rootRef.current;
      if (!root) return;
      const path = e.composedPath();
      if (!path.includes(root)) onClose();
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    firstFieldRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose]);

  function handleSave() {
    const patch: MessageBookmark = {
      createdAt: existing?.createdAt ?? Date.now(),
    };
    if (hue >= 0) patch.color = hueToColor(hue);
    const trimmedName = name.trim();
    if (trimmedName) patch.name = trimmedName.slice(0, NAME_MAX);
    const trimmedNote = note.trim();
    if (trimmedNote) patch.note = trimmedNote.slice(0, NOTE_MAX);
    onSave(patch);
  }

  const roleLabel = msg.role === "user" ? "You" : "ChatGPT";
  const previewColor = hue >= 0 ? hueToColor(hue) : "#94a3b8";

  return (
    <div
      ref={rootRef}
      className="bookmark-editor"
      style={{ top: `${topPercent}%` }}
      role="dialog"
      aria-label="edit bookmark"
    >
      <div className="be-header">
        <span className="be-role">{roleLabel}</span>
        <button className="be-close" onClick={onClose} aria-label="close">
          ✕
        </button>
      </div>

      <label className="be-field">
        <span className="be-label">name</span>
        <input
          ref={firstFieldRef}
          type="text"
          className="be-input"
          value={name}
          maxLength={NAME_MAX}
          placeholder="optional label"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="be-field">
        <span className="be-label">note</span>
        <textarea
          className="be-textarea"
          value={note}
          maxLength={NOTE_MAX}
          rows={3}
          placeholder="optional details"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <div className="be-field">
        <div className="be-color-row">
          <span className="be-label">color</span>
          <span className="be-swatch" style={{ background: previewColor }} />
          {hue >= 0 && (
            <button
              className="be-clear-color"
              onClick={() => setHue(NO_COLOR_HUE)}
              type="button"
            >
              clear
            </button>
          )}
        </div>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={hue < 0 ? 0 : hue}
          className="be-hue"
          onChange={(e) => setHue(parseInt(e.target.value))}
          onMouseDown={() => hue < 0 && setHue(0)}
        />
      </div>

      <div className="be-actions">
        {existing && (
          <button className="be-btn be-btn--danger" onClick={onDelete}>
            delete
          </button>
        )}
        <button className="be-btn be-btn--primary" onClick={handleSave}>
          save
        </button>
      </div>
    </div>
  );
}
