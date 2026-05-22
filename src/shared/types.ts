export type ChatMessageRole = "user" | "assistant" | "system" | "unknown";

export type ChatMessageFeature =
  | "code"
  | "link"
  | "source"
  | "attachment"
  | "image"
  | "long-answer"
  | "heading";

export interface ChatMessageRecord {
  id: string;
  role: ChatMessageRole;
  // optional because cache-seeded records exist before the dom is hydrated.
  // resolveTarget falls back to data-chatmap-id / domAnchor lookups when undefined.
  element?: HTMLElement;
  textPreview: string;
  fullTextLength: number;
  features: ChatMessageFeature[];
  top: number;
  height: number;
  // adapter-supplied anchor used to re-resolve the dom node after virtualization
  // (chatgpt: conversation-turn-N data-testid). optional so other adapters can omit.
  domAnchor?: string;
  // turn order (chatgpt's conversation-turn-N). used for sorting and for
  // estimating scroll position when navigating to a virtualized marker.
  order?: number;
}

// minimal subset of ChatMessageRecord that survives serialization to
// chrome.storage.local. element, top, height are dom-bound so we drop them.
export interface CachedMarker {
  id: string;
  role: ChatMessageRole;
  textPreview: string;
  fullTextLength: number;
  features: ChatMessageFeature[];
  domAnchor: string;
  order: number;
}

export interface ConvCache {
  markers: CachedMarker[];
  lastUpdated: number;
  // true once a full scan completed for this conversation
  fullyScanned: boolean;
  // true when the user dismissed the scan offer for this conversation
  offerDismissed: boolean;
}

export type AccentColor = "gray" | "blue" | "purple" | "green" | "orange" | "pink";

// a configurable shortcut. clicks use the modifier set only (key omitted).
// keyboard shortcuts require a single character key. modifiers default to
// false so partial defaults expand cleanly.
export interface Keybind {
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  key?: string;
}

export interface ChatMapKeybinds {
  editBookmark: Keybind;
  nextImportant: Keybind;
  prevImportant: Keybind;
}

export interface ChatMapSettings {
  enabled: boolean;
  showUserMessages: boolean;
  showAssistantMessages: boolean;
  reducedMotion: boolean;
  accentColor: AccentColor;
  keybinds: ChatMapKeybinds;
}

// per-message annotation. keyed by `${convId}|${domAnchor}` in storage so
// the bookmark survives reloads of the same conversation. fields are all
// optional so an empty bookmark (e.g. color-only) is valid.
export interface MessageBookmark {
  color?: string;
  name?: string;
  note?: string;
  createdAt: number;
}

export type BookmarkMap = Record<string, MessageBookmark>;

