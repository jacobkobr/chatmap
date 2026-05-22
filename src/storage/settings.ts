import type { ChatMapSettings } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/constants";

const STORAGE_KEY = "chatmap_settings";

// merges stored settings over defaults, preserving any keybinds the user
// hasn't customized (so adding a new default keybind doesn't get blown
// away by older stored settings that lack it).
function mergeSettings(saved: Partial<ChatMapSettings> | undefined): ChatMapSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    keybinds: {
      ...DEFAULT_SETTINGS.keybinds,
      ...(saved?.keybinds ?? {}),
    },
  };
}

export async function loadSettings(): Promise<ChatMapSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const saved = result[STORAGE_KEY] as Partial<ChatMapSettings> | undefined;
      resolve(mergeSettings(saved));
    });
  });
}

export async function saveSettings(settings: ChatMapSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: settings }, resolve);
  });
}

export function onSettingsChanged(
  callback: (settings: ChatMapSettings) => void
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      const next = changes[STORAGE_KEY].newValue as Partial<ChatMapSettings>;
      callback(mergeSettings(next));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
