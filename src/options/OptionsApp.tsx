import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadSettings, saveSettings } from "../storage/settings";
import type { Keybind, ChatMapKeybinds, ChatMapSettings } from "../shared/types";
import { DEFAULT_KEYBINDS, DEFAULT_SETTINGS } from "../shared/constants";
import { formatKeybind } from "../shared/keybinds";
import "./options.css";

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-label">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        className={`toggle-btn${checked ? " toggle-btn--on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-thumb" />
      </button>
    </label>
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

// modifier checkbox group. used for click-action bindings where no key is
// needed (just a modifier combo paired with a mouse click).
function ModifierEditor({
  bind,
  onChange,
}: {
  bind: Keybind;
  onChange: (next: Keybind) => void;
}) {
  return (
    <div className="mod-group">
      {(["altKey", "shiftKey", "ctrlKey", "metaKey"] as const).map((mod) => {
        const label =
          mod === "altKey"
            ? "Alt"
            : mod === "shiftKey"
            ? "Shift"
            : mod === "ctrlKey"
            ? "Ctrl"
            : "Meta";
        const on = bind[mod];
        return (
          <button
            key={mod}
            type="button"
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

// records the next keydown into a binding. shows "press keys…" while
// active, the formatted binding otherwise.
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
      // skip pure-modifier presses; wait for the real key
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
      {recording ? "press key combo…" : formatKeybind(bind) || "(unset)"}
    </button>
  );
}

function OptionsApp() {
  const [settings, setSettings] = useState<ChatMapSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

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
      keybinds: { ...prev.keybinds, [key]: next },
    }));
  }

  function resetKeybinds() {
    setSettings((prev) => ({ ...prev, keybinds: DEFAULT_KEYBINDS }));
  }

  return (
    <div className="options-root">
      <header className="options-header">
        <h1>ChatMap</h1>
        <p>minimap settings</p>
      </header>

      <section className="options-section">
        <h2>general</h2>
        <Toggle
          label="enabled"
          checked={settings.enabled}
          onChange={(v) => update({ enabled: v })}
        />
        <Toggle
          label="reduced motion"
          checked={settings.reducedMotion}
          onChange={(v) => update({ reducedMotion: v })}
        />
      </section>

      <section className="options-section">
        <h2>markers</h2>
        <p className="section-hint">
          one marker per message. images, code, links, and attachments show up
          as badges inside the hover preview — not as separate ticks.
        </p>
        <Toggle
          label="show your messages"
          checked={settings.showUserMessages}
          onChange={(v) => update({ showUserMessages: v })}
        />
        <Toggle
          label="show chatgpt responses"
          checked={settings.showAssistantMessages}
          onChange={(v) => update({ showAssistantMessages: v })}
        />
      </section>

      <section className="options-section">
        <h2>appearance</h2>
        <Select
          label="accent color"
          value={settings.accentColor}
          options={[
            { value: "gray", label: "gray (default)" },
            { value: "blue", label: "blue" },
            { value: "purple", label: "purple" },
            { value: "green", label: "green" },
            { value: "orange", label: "orange" },
            { value: "pink", label: "pink" },
          ]}
          onChange={(v) => update({ accentColor: v })}
        />
      </section>

      <section className="options-section">
        <h2>keybinds</h2>
        <p className="section-hint">
          mod-click a marker to edit its color, name, and note. use the
          next/prev shortcuts to jump between bookmarked messages.
        </p>

        <div className="kb-row">
          <div className="kb-row-label">edit bookmark (modifiers + click)</div>
          <ModifierEditor
            bind={settings.keybinds.editBookmark}
            onChange={(next) => updateBind("editBookmark", next)}
          />
        </div>

        <div className="kb-row">
          <div className="kb-row-label">next bookmark</div>
          <KeyRecorder
            bind={settings.keybinds.nextImportant}
            onChange={(next) => updateBind("nextImportant", next)}
          />
        </div>

        <div className="kb-row">
          <div className="kb-row-label">previous bookmark</div>
          <KeyRecorder
            bind={settings.keybinds.prevImportant}
            onChange={(next) => updateBind("prevImportant", next)}
          />
        </div>

        <button className="reset-btn" onClick={resetKeybinds}>
          reset to defaults
        </button>
      </section>

      <div className="options-footer">
        <span className="footer-hint">changes save automatically</span>
      </div>
    </div>
  );
}

const root = document.getElementById("root")!;
createRoot(root).render(<OptionsApp />);
