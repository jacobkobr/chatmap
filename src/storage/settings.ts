import type { ThreadMapSettings } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/constants";

const STORAGE_KEY = "threadmap_settings";

export async function loadSettings(): Promise<ThreadMapSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const saved = result[STORAGE_KEY] as Partial<ThreadMapSettings> | undefined;
      resolve({ ...DEFAULT_SETTINGS, ...saved });
    });
  });
}

export async function saveSettings(settings: ThreadMapSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: settings }, resolve);
  });
}

export function onSettingsChanged(
  callback: (settings: ThreadMapSettings) => void
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      const next = changes[STORAGE_KEY].newValue as Partial<ThreadMapSettings>;
      callback({ ...DEFAULT_SETTINGS, ...next });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
