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
  // chatgpt's internal message id (data-message-id on the inner author-role node).
  // populated for both api-loaded and dom-walked records when available — the
  // api returns this directly, so api-seeded records use it as their primary
  // re-resolve key. survives virtualization more reliably than conversation-turn-N
  // which can be reused/renumbered across edits.
  chatgptMsgId?: string;
  // turn order (chatgpt's conversation-turn-N). used for sorting and for
  // estimating scroll position when navigating to a virtualized marker.
  order?: number;
  // other chatgpt message ids that the api has collapsed into this record
  // (e.g. a short "I'll check..." preamble followed by the real answer is
  // rendered as two conversation-turn-N elements but is one logical reply).
  // dedup uses this so both dom turns adopt the same canonical record.
  absorbedMsgIds?: string[];
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
  chatgptMsgId?: string;
  order: number;
  absorbedMsgIds?: string[];
}

export interface ConvCache {
  markers: CachedMarker[];
  lastUpdated: number;
  // true once a full scan completed for this conversation
  fullyScanned: boolean;
  // true when the user dismissed the scan offer for this conversation
  offerDismissed: boolean;
}

export type AccentColor = "gray" | "blue" | "purple" | "green" | "orange" | "pink" | "sparkle";

// how to populate the rail on conversation open.
//   - "api":  fetch the conversation from chatgpt's own backend on load,
//             giving instant full coverage with zero scrolling
//   - "scan": rely on the dom + the manual scan offer for long chats
export type ChatLoadMode = "api" | "scan";

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
  // modifier-only binding: holding these while scrolling moves through
  // all visible markers (not just bookmarks). key is ignored.
  scrollNav: Keybind;
  // single-key bookmark toggle on the active marker. ignored while focus
  // is in a text input so it doesn't fire while typing in the chat box.
  quickBookmark: Keybind;
}

export interface ChatMapSettings {
  enabled: boolean;
  showUserMessages: boolean;
  showAssistantMessages: boolean;
  reducedMotion: boolean;
  accentColor: AccentColor;
  chatLoadMode: ChatLoadMode;
  keybinds: ChatMapKeybinds;
  // color used when the quick-bookmark keybind drops a no-name bookmark
  quickBookmarkColor: string;
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

