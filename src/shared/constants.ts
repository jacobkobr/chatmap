export const MINIMAP_HOST_ID = "chatmap-host";
export const PREVIEW_CHAR_LIMIT = 160;
export const LONG_ANSWER_THRESHOLD = 1500;
export const DEBOUNCE_MS = 250;
export const HIGHLIGHT_DURATION_MS = 1500;
// only suppress totally empty assistant placeholders (rare — a brief moment
// while the stream is initializing). previously 12, which ate legitimate
// short replies in instant-answer mode ("hih", "ok", "yes") and made the
// rail look like it was missing every other assistant marker.
export const MIN_RESPONSE_LENGTH = 1;
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
  scrollNav: {
    altKey: true,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
  },
  quickBookmark: {
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    key: "b",
  },
  toggleBookmarksOnly: {
    altKey: true,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    key: "h",
  },
};

export const DEFAULT_SETTINGS = {
  enabled: true,
  showUserMessages: true,
  showAssistantMessages: true,
  reducedMotion: false,
  navHighlight: true,
  markerSize: "normal" as const,
  accentColor: "white" as const,
  chatLoadMode: "api" as const,
  keybinds: DEFAULT_KEYBINDS,
  quickBookmarkColor: "#ec4899",
  tutorialState: "pending" as const,
  tutorialStep: 0,
  bookmarksOnly: false,
};

export const BOOKMARKS_STORAGE_KEY = "chatmap-bookmarks";
export const MARKER_CACHE_STORAGE_KEY = "chatmap-marker-cache";
