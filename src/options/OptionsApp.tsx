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
    ["metaKey", "Meta"],
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

  return (
    <main className="options-root" data-accent={settings.accentColor}>


      <section className="options-card">
        <div className="section-title">General</div>

        <Toggle
          label="Enable ChatMap"
          checked={settings.enabled}
          onChange={(v) => update({ enabled: v })}
        />

        <Toggle
          label="Reduced motion"
          checked={settings.reducedMotion}
          onChange={(v) => update({ reducedMotion: v })}
        />
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

        <Select
          label="Accent color"
          value={settings.accentColor}
          options={[
            { value: "blue", label: "Aqua" },
            { value: "gray", label: "Gray" },
            { value: "purple", label: "Purple" },
            { value: "green", label: "Green" },
            { value: "orange", label: "Orange" },
            { value: "pink", label: "Pink" },
          ]}
          onChange={(v) => update({ accentColor: v })}
        />

        <Select
          label="Load history"
          value={settings.chatLoadMode}
          options={[
            { value: "api", label: "API (fast)" },
            { value: "scan", label: "Scan only" },
          ]}
          onChange={(v) => update({ chatLoadMode: v })}
        />
      </section>

      <section className="options-card">
        <div className="section-title">Shortcuts</div>

        <div className="kb-row">
          <div className="kb-row-label">
            Edit bookmark
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

        <button type="button" className="reset-btn" onClick={resetKeybinds}>
          Reset shortcuts
        </button>
      </section>
    </main>
  );
}

const rootEl = document.getElementById("root");

if (!rootEl) {
  throw new Error("ChatMap settings root element was not found.");
}

createRoot(rootEl).render(<OptionsApp />);