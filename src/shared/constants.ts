export const MINIMAP_HOST_ID = "threadmap-host";
export const PREVIEW_CHAR_LIMIT = 160;
export const LONG_ANSWER_THRESHOLD = 1500;
export const DEBOUNCE_MS = 250;
export const HIGHLIGHT_DURATION_MS = 1200;
export const MIN_RESPONSE_LENGTH = 12;   // skip ticks for very short messages
export const DESKTOP_MIN_WIDTH = 768;    // hide minimap on narrow viewports

export const DEFAULT_SETTINGS = {
  enabled: true,
  showUserMessages: true,
  showAssistantMessages: true,
  showCodeMarkers: true,
  showLongAnswerMarkers: true,
  showLinkMarkers: true,
  showImageMarkers: true,
  markerDensity: "normal" as const,
  reducedMotion: false,
  accentColor: "neutral" as const,
};
