export const MINIMAP_HOST_ID = "chatmap-host";
export const PREVIEW_CHAR_LIMIT = 160;
export const LONG_ANSWER_THRESHOLD = 1500;
export const DEBOUNCE_MS = 250;
export const HIGHLIGHT_DURATION_MS = 1200;
export const MIN_RESPONSE_LENGTH = 12;   // skip ticks for very short messages
export const DESKTOP_MIN_WIDTH = 768;    // hide minimap on narrow viewports

export const DEFAULT_KEYBINDS = {
  editBookmark: {
    altKey: true,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
  },
  // WASD convention: w = up (previous, earlier in conv), s = down (next)
  nextImportant: {
    altKey: true,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    key: "s",
  },
  prevImportant: {
    altKey: true,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    key: "w",
  },
};

export const DEFAULT_SETTINGS = {
  enabled: true,
  showUserMessages: true,
  showAssistantMessages: true,
  reducedMotion: false,
  accentColor: "gray" as const,
  keybinds: DEFAULT_KEYBINDS,
};

export const BOOKMARKS_STORAGE_KEY = "chatmap-bookmarks";
export const MARKER_CACHE_STORAGE_KEY = "chatmap-marker-cache";
