import { createRoot } from "react-dom/client";
import { getActiveAdapter, registerAdapter } from "../adapters/registry";
import chatgptAdapter from "../adapters/chatgpt";
import { createShadowHost } from "./shadowRoot";
import { injectHighlightStyle, teardown } from "./cleanup";
import { watchNavigation } from "./navigation";
import { loadSettings, onSettingsChanged } from "../storage/settings";
import { Minimap } from "../minimap/Minimap";
import type { ThreadMapSettings } from "../shared/types";
import { MINIMAP_HOST_ID } from "../shared/constants";

registerAdapter(chatgptAdapter);

let reactRoot: ReturnType<typeof createRoot> | null = null;
let stopWatchingSettings: (() => void) | null = null;
let stopWatchingNav: (() => void) | null = null;

async function mount() {
  const adapter = getActiveAdapter();
  if (!adapter) return;

  const settings = await loadSettings();

  if (!settings.enabled) return;

  injectHighlightStyle();

  // skip if already mounted
  if (document.getElementById(MINIMAP_HOST_ID)) return;

  const { host, shadow } = createShadowHost(settings.accentColor);
  document.body.appendChild(host);

  // react renders inside shadow dom
  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  reactRoot = createRoot(mountPoint);
  render(settings);
}

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
  // small delay so chatgpt finishes its own DOM cleanup on navigation
  await new Promise((r) => setTimeout(r, 400));
  await mount();
}

async function init() {
  await mount();

  stopWatchingSettings = onSettingsChanged((settings) => {
    if (!settings.enabled) {
      unmount();
      return;
    }
    if (!document.getElementById(MINIMAP_HOST_ID)) {
      mount();
      return;
    }
    // update accent attribute on host element
    const host = document.getElementById(MINIMAP_HOST_ID);
    host?.setAttribute("data-accent", settings.accentColor);
    render(settings);
  });

  stopWatchingNav = watchNavigation(remount);
}

init();

// cleanup if extension is reloaded / tab navigates away
window.addEventListener("pagehide", () => {
  stopWatchingSettings?.();
  stopWatchingNav?.();
  unmount();
});
