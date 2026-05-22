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
  // gate auto-save on initial load so we don't overwrite stored settings
  // with defaults on the first render
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  // auto-save on every change — popup closes on outside click, so a
  // separate save button is friction. content script picks up changes
  // immediately via the storage.onChanged listener.
  useEffect(() => {
    if (!loaded) return;
    saveSettings(settings);
  }, [settings, loaded]);

  function update(patch: Partial<ThreadMapSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }));
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

      <div className="options-footer">
        <span className="footer-hint">changes save automatically</span>
      </div>
    </div>
  );
}

const root = document.getElementById("root")!;
createRoot(root).render(<OptionsApp />);
