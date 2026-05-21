import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadSettings, saveSettings } from "../storage/settings";
import type { ThreadMapSettings } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/constants";
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

function OptionsApp() {
  const [settings, setSettings] = useState<ThreadMapSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  function update(patch: Partial<ThreadMapSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }

  async function handleSave() {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="options-root">
      <header className="options-header">
        <h1>ThreadMap</h1>
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
        <Toggle
          label="show user messages"
          checked={settings.showUserMessages}
          onChange={(v) => update({ showUserMessages: v })}
        />
        <Toggle
          label="show assistant messages"
          checked={settings.showAssistantMessages}
          onChange={(v) => update({ showAssistantMessages: v })}
        />
        <Toggle
          label="code blocks"
          checked={settings.showCodeMarkers}
          onChange={(v) => update({ showCodeMarkers: v })}
        />
        <Toggle
          label="long answers"
          checked={settings.showLongAnswerMarkers}
          onChange={(v) => update({ showLongAnswerMarkers: v })}
        />
        <Toggle
          label="links / sources"
          checked={settings.showLinkMarkers}
          onChange={(v) => update({ showLinkMarkers: v })}
        />
        <Toggle
          label="images / attachments"
          checked={settings.showImageMarkers}
          onChange={(v) => update({ showImageMarkers: v })}
        />
      </section>

      <section className="options-section">
        <h2>appearance</h2>
        <Select
          label="marker density"
          value={settings.markerDensity}
          options={[
            { value: "compact", label: "compact" },
            { value: "normal", label: "normal" },
            { value: "detailed", label: "detailed" },
          ]}
          onChange={(v) => update({ markerDensity: v })}
        />
        <Select
          label="accent color"
          value={settings.accentColor}
          options={[
            { value: "neutral", label: "neutral (gray)" },
            { value: "blue-purple", label: "blue / purple" },
            { value: "chatgpt", label: "chatgpt green" },
          ]}
          onChange={(v) => update({ accentColor: v })}
        />
      </section>

      <div className="options-footer">
        <button className="save-btn" onClick={handleSave}>
          {saved ? "saved ✓" : "save settings"}
        </button>
      </div>
    </div>
  );
}

const root = document.getElementById("root")!;
createRoot(root).render(<OptionsApp />);
