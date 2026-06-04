import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadSettings, saveSettings } from "../storage/settings";
import type {
  Keybind,
  ChatMapKeybinds,
  ChatMapSettings,
  MarkerSize,
} from "../shared/types";
import { DEFAULT_KEYBINDS, DEFAULT_SETTINGS } from "../shared/constants";
import { formatKeybind } from "../shared/keybinds";
import { ExportDialog } from "../export/ExportDialog";
import "./options.css";

// canonical hex per named accent — mirrors the --accent values in options.css
// so the color picker reflects whichever palette is currently active.
const ACCENT_HEX: Record<string, string> = {
  blue: "#2596be",
  gray: "#a3a3a3",
  white: "#fafafa",
  purple: "#8b5cf6",
  green: "#22c55e",
  orange: "#f97316",
  pink: "#ec4899",
  sparkle: "#c084fc",
};

// convert "#rrggbb" → "r,g,b" for rgba() composition.
function hexToRgbTuple(hex: string): string {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `${r},${g},${b}`;
}

// approximate luminance — picks black or white foreground for contrast.
function pickFg(hex: string): string {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#0a0a0a" : "#ffffff";
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  function toggle() {
    onChange(!checked);
  }

  return (
    <div className="toggle-row" onClick={toggle}>
      <span className="toggle-label">{label}</span>

      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        className={`toggle-btn${checked ? " toggle-btn--on" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  );
}

function SizePicker({
  value,
  onChange,
}: {
  value: MarkerSize;
  onChange: (v: MarkerSize) => void;
}) {
  // mini rail preview — 4 alternating short/long bars stacked on a dark
  // strip, scaled per-option so the visual change tracks the actual rail.
  function Preview({ size }: { size: MarkerSize }) {
    const big = size === "large";
    return (
      <div className={`size-preview${big ? " size-preview--lg" : ""}`}>
        <div className="size-bar size-bar--short" />
        <div className="size-bar size-bar--long" />
        <div className="size-bar size-bar--short" />
        <div className="size-bar size-bar--long" />
      </div>
    );
  }
  return (
    <div className="size-picker">
      <div className="size-picker-label">Size</div>
      <div className="size-picker-row">
        {(["normal", "large"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`size-card${value === s ? " size-card--on" : ""}`}
            onClick={() => onChange(s)}
            aria-pressed={value === s}
          >
            <Preview size={s} />
            <span className="size-card-label">
              {s === "normal" ? "Normal" : "Large"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="select-row">
      <span className="select-label">{label}</span>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="select-input"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ModifierEditor({
  bind,
  onChange,
}: {
  bind: Keybind;
  onChange: (next: Keybind) => void;
}) {
  const mods = [
    ["altKey", "Alt"],
    ["shiftKey", "Shift"],
    ["ctrlKey", "Ctrl"],
    ["metaKey", "⌘"],
  ] as const;

  return (
    <div className="mod-group">
      {mods.map(([mod, label]) => {
        const on = bind[mod];

        return (
          <button
            key={mod}
            type="button"
            aria-pressed={on}
            className={`mod-chip${on ? " mod-chip--on" : ""}`}
            onClick={() => onChange({ ...bind, [mod]: !on })}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function KeyRecorder({
  bind,
  onChange,
}: {
  bind: Keybind;
  onChange: (next: Keybind) => void;
}) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;

    function onKey(e: KeyboardEvent) {
      if (["Alt", "Shift", "Control", "Meta"].includes(e.key)) return;

      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecording(false);
        return;
      }

      onChange({
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        key: e.key,
      });

      setRecording(false);
    }

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);

  return (
    <button
      type="button"
      className={`key-recorder${recording ? " key-recorder--active" : ""}`}
      onClick={() => setRecording((r) => !r)}
    >
      {recording ? "Press shortcut..." : formatKeybind(bind) || "Unset"}
    </button>
  );
}

function OptionsApp() {
  const [settings, setSettings] = useState<ChatMapSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [showExport, setShowExport] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveSettings(settings);
  }, [settings, loaded]);

  function update(patch: Partial<ChatMapSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }));
  }

  function updateBind<K extends keyof ChatMapKeybinds>(
    key: K,
    next: Keybind
  ) {
    setSettings((prev) => ({
      ...prev,
      keybinds: {
        ...prev.keybinds,
        [key]: next,
      },
    }));
  }

  function resetKeybinds() {
    setSettings((prev) => ({
      ...prev,
      keybinds: DEFAULT_KEYBINDS,
    }));
  }

  // re-arm the first-run walkthrough. settings sync to chrome.storage, which
  // the content script listens to, so any open chatgpt tab will surface the
  // tutorial card the next time react re-renders (effectively immediately).
  function restartTutorial() {
    setSettings((prev) => ({
      ...prev,
      tutorialState: "pending",
      tutorialStep: 0,
    }));
  }

  // picker shows the effective accent hex — custom value when in custom mode,
  // otherwise the named palette's hex so switching the dropdown updates the
  // swatch in lockstep.
  const pickerHex =
    settings.accentColor === "custom"
      ? settings.customAccentColor
      : ACCENT_HEX[settings.accentColor] ?? settings.customAccentColor;

  // when accent is custom, drive the options page's --accent vars inline since
  // options.css has no [data-accent="custom"] rule. without this, every
  // accent-tinted control on this page falls back to the :root default (aqua).
  const customStyle: React.CSSProperties =
    settings.accentColor === "custom"
      ? ({
          "--accent": settings.customAccentColor,
          "--accent-hover": settings.customAccentColor,
          "--accent-soft": `rgba(${hexToRgbTuple(settings.customAccentColor)},0.24)`,
          "--accent-fg": pickFg(settings.customAccentColor),
        } as React.CSSProperties)
      : {};

  return (
    <main
      className="options-root"
      data-accent={settings.accentColor}
      style={customStyle}
    >


      <section className="options-card">
        <div className="section-title">General</div>

        <Toggle
          label="Enable chatmap"
          checked={settings.enabled}
          onChange={(v) => update({ enabled: v })}
        />

        <Toggle
          label="Reduced motion"
          checked={settings.reducedMotion}
          onChange={(v) => update({ reducedMotion: v })}
        />

        <Toggle
          label="Highlight message on jump"
          checked={settings.navHighlight}
          onChange={(v) => update({ navHighlight: v })}
        />

        <Toggle
          label="Show only bookmarked messages"
          checked={settings.bookmarksOnly}
          onChange={(v) => update({ bookmarksOnly: v })}
        />

        <SizePicker
          value={settings.markerSize}
          onChange={(v) => update({ markerSize: v })}
        />

        <div className="options-button-row">
          <button
            type="button"
            className="reset-btn"
            onClick={restartTutorial}
          >
            Restart tutorial
          </button>
          <button
            type="button"
            className="reset-btn"
            onClick={() => setShowExport(true)}
          >
            Export bookmarks…
          </button>
        </div>
      </section>

      <section className="options-card">
        <div className="section-title">Markers</div>

        <Toggle
          label="User messages"
          checked={settings.showUserMessages}
          onChange={(v) => update({ showUserMessages: v })}
        />

        <Toggle
          label="ChatGPT responses"
          checked={settings.showAssistantMessages}
          onChange={(v) => update({ showAssistantMessages: v })}
        />
      </section>

      <section className="options-card">
        <div className="section-title">Appearance</div>

        <div className="accent-row">
          <Select
            label="Accent color"
            value={settings.accentColor}
            options={[
              { value: "blue", label: "Aqua" },
              { value: "gray", label: "Gray" },
              { value: "white", label: "White" },
              { value: "purple", label: "Purple" },
              { value: "green", label: "Green" },
              { value: "orange", label: "Orange" },
              { value: "pink", label: "Pink" },
              { value: "sparkle", label: "Sparkle" },
              { value: "custom", label: "Custom" },
            ]}
            onChange={(v) => update({ accentColor: v })}
          />
          <input
            type="color"
            className="kb-color-input"
            aria-label="Custom accent color"
            title="Custom accent color"
            value={pickerHex}
            onChange={(e) =>
              update({
                customAccentColor: e.target.value,
                accentColor: "custom",
              })
            }
          />
        </div>
      </section>

      <section className="options-card">
        <div className="section-title">Shortcuts</div>

        <div className="kb-row">
          <div className="kb-row-label">
            Add/Edit bookmark
            <span className="kb-row-hint">click a marker while holding</span>
          </div>
          <div className="kb-row-binding">
            <ModifierEditor
              bind={settings.keybinds.editBookmark}
              onChange={(next) => updateBind("editBookmark", next)}
            />
            <span className="kb-row-suffix">+ Click</span>
          </div>
        </div>

        <div className="kb-row">
          <div className="kb-row-label">
            Quick bookmark
            <span className="kb-row-hint">press to toggle on the active marker</span>
          </div>
          <div className="kb-row-binding">
            <KeyRecorder
              bind={settings.keybinds.quickBookmark}
              onChange={(next) => updateBind("quickBookmark", next)}
            />
            <input
              type="color"
              className="kb-color-input"
              aria-label="Quick bookmark color"
              title="Quick bookmark color"
              value={settings.quickBookmarkColor}
              onChange={(e) => update({ quickBookmarkColor: e.target.value })}
            />
          </div>
        </div>

        <div className="kb-row">
          <div className="kb-row-label">Next bookmark</div>
          <KeyRecorder
            bind={settings.keybinds.nextImportant}
            onChange={(next) => updateBind("nextImportant", next)}
          />
        </div>

        <div className="kb-row">
          <div className="kb-row-label">Previous bookmark</div>
          <KeyRecorder
            bind={settings.keybinds.prevImportant}
            onChange={(next) => updateBind("prevImportant", next)}
          />
        </div>

        <div className="kb-row">
          <div className="kb-row-label">
            Scroll between markers
            <span className="kb-row-hint">scroll the wheel while holding</span>
          </div>
          <div className="kb-row-binding">
            <ModifierEditor
              bind={settings.keybinds.scrollNav}
              onChange={(next) => updateBind("scrollNav", next)}
            />
            <span className="kb-row-suffix">+ Scroll</span>
          </div>
        </div>

        <div className="kb-row">
          <div className="kb-row-label">
            Toggle bookmarks-only view
            <span className="kb-row-hint">hide non-bookmarked markers</span>
          </div>
          <KeyRecorder
            bind={settings.keybinds.toggleBookmarksOnly}
            onChange={(next) => updateBind("toggleBookmarksOnly", next)}
          />
        </div>

        <div className="kb-row">
          <div className="kb-row-label">
            Export bookmarks/conversation
            <span className="kb-row-hint">open the export dialog</span>
          </div>
          <KeyRecorder
            bind={settings.keybinds.exportBookmarks}
            onChange={(next) => updateBind("exportBookmarks", next)}
          />
        </div>

        <button type="button" className="reset-btn" onClick={resetKeybinds}>
          Reset shortcuts
        </button>
      </section>
      {showExport && (
        <ExportDialog onClose={() => setShowExport(false)} />
      )}
    </main>
  );
}

const rootEl = document.getElementById("root");

if (!rootEl) {
  throw new Error("ChatMap settings root element was not found.");
}

createRoot(rootEl).render(<OptionsApp />);