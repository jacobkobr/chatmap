import { createRoot } from "react-dom/client";
import { getActiveAdapter, registerAdapter } from "../adapters/registry";
import chatgptAdapter from "../adapters/chatgpt";
import { createShadowHost } from "./shadowRoot";
import { injectHighlightStyle, teardown } from "./cleanup";
import { watchNavigation } from "./navigation";
import { loadSettings, onSettingsChanged } from "../storage/settings";
import { Minimap } from "../minimap/Minimap";
import type { ThreadMapSettings } from "../shared/types";
import { MINIMAP_HOST_ID, DEFAULT_SETTINGS } from "../shared/constants";

registerAdapter(chatgptAdapter);

let reactRoot: ReturnType<typeof createRoot> | null = null;
let stopWatchingSettings: (() => void) | null = null;
let stopWatchingNav: (() => void) | null = null;

function render(settings: ThreadMapSettings) {
  const adapter = getActiveAdapter();
  if (!adapter || !reactRoot) return;
  reactRoot.render(<Minimap adapter={adapter} settings={settings} />);
}

function unmount() {
  reactRoot?.unmount();
  reactRoot = null;
  teardown();
}

async function remount() {
  unmount();
  await new Promise((r) => setTimeout(r, 400));
  await mount();
}

function mountSync(settings: ThreadMapSettings) {
  const adapter = getActiveAdapter();
  if (!adapter) return;
  if (document.getElementById(MINIMAP_HOST_ID)) return;

  injectHighlightStyle();

  const { host, shadow } = createShadowHost(settings.accentColor);
  document.body.appendChild(host);

  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  reactRoot = createRoot(mountPoint);
  render(settings);
}

async function mount() {
  const adapter = getActiveAdapter();
  if (!adapter) return;

  // render immediately with defaults so there's no wait on storage
  mountSync(DEFAULT_SETTINGS);

  // then update with persisted settings
  try {
    const settings = await loadSettings();
    if (!settings.enabled) {
      unmount();
      return;
    }
    const host = document.getElementById(MINIMAP_HOST_ID);
    host?.setAttribute("data-accent", settings.accentColor);
    render(settings);
  } catch (_) {
    // storage read failed — defaults are already rendered, keep them
  }
}

async function init() {
  try {
    await mount();
  } catch (err) {
    console.error("[threadmap] mount failed:", err);
    return;
  }

  stopWatchingSettings = onSettingsChanged((settings) => {
    if (!settings.enabled) {
      unmount();
      return;
    }
    if (!document.getElementById(MINIMAP_HOST_ID)) {
      mountSync(settings);
      return;
    }
    const host = document.getElementById(MINIMAP_HOST_ID);
    host?.setAttribute("data-accent", settings.accentColor);
    render(settings);
  });

  stopWatchingNav = watchNavigation(remount);
}

init();

window.addEventListener("pagehide", () => {
  stopWatchingSettings?.();
  stopWatchingNav?.();
  unmount();
});
