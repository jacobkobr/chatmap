import { createRoot } from "react-dom/client";
import { getActiveAdapter, registerAdapter } from "../adapters/registry";
import chatgptAdapter from "../adapters/chatgpt";
import { createShadowHost } from "./shadowRoot";
import { injectHighlightStyle, teardown } from "./cleanup";
import { watchNavigation } from "./navigation";
import { loadSettings, onSettingsChanged } from "../storage/settings";
import { Minimap } from "../minimap/Minimap";
import type { ChatMapSettings } from "../shared/types";
import { MINIMAP_HOST_ID, DEFAULT_SETTINGS } from "../shared/constants";
import { isExtensionAlive } from "../shared/extensionContext";

registerAdapter(chatgptAdapter);

let reactRoot: ReturnType<typeof createRoot> | null = null;
let stopWatchingSettings: (() => void) | null = null;
let stopWatchingNav: (() => void) | null = null;
let contextWatch: ReturnType<typeof setInterval> | null = null;

function render(settings: ChatMapSettings) {
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

function mountSync(settings: ChatMapSettings) {
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
    console.error("[chatmap] mount failed:", err);
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

  // a reloaded/updated extension leaves this content script as a zombie:
  // chrome.* throws "Extension context invalidated", so the rail looks alive
  // but nothing persists (bookmarks silently fail to save). detect it, tear
  // down the dead ui, and tell the user the one thing that fixes it.
  contextWatch = setInterval(() => {
    if (!isExtensionAlive()) handleContextDeath();
  }, 2000);
}

function handleContextDeath() {
  if (contextWatch) {
    clearInterval(contextWatch);
    contextWatch = null;
  }
  // listeners live on the now-dead chrome.storage; removing them can throw.
  try {
    stopWatchingSettings?.();
  } catch (_) {
    /* context already gone */
  }
  try {
    stopWatchingNav?.();
  } catch (_) {
    /* context already gone */
  }
  unmount();
  showReloadNotice();
}

function showReloadNotice(): void {
  const NOTICE_ID = "chatmap-reload-notice";
  if (document.getElementById(NOTICE_ID)) return;
  const el = document.createElement("div");
  el.id = NOTICE_ID;
  el.textContent = "chatmap updated — click to reload this page";
  el.style.cssText =
    "position:fixed;bottom:16px;right:16px;z-index:2147483647;" +
    "background:#1e1e22;color:#e8e8ea;font:13px/1.4 system-ui,sans-serif;" +
    "padding:10px 14px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);" +
    "cursor:pointer;user-select:none;";
  el.addEventListener("click", () => location.reload());
  document.body.appendChild(el);
}

init();

window.addEventListener("pagehide", () => {
  if (contextWatch) clearInterval(contextWatch);
  stopWatchingSettings?.();
  stopWatchingNav?.();
  unmount();
});
