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
  element: HTMLElement;
  textPreview: string;
  fullTextLength: number;
  features: ChatMessageFeature[];
  top: number;
  height: number;
  // adapter-supplied anchor used to re-resolve the dom node after virtualization
  // (chatgpt: conversation-turn-N data-testid). optional so other adapters can omit.
  domAnchor?: string;
}

export type AccentColor = "gray" | "blue" | "purple" | "green" | "orange" | "pink";

export interface ThreadMapSettings {
  enabled: boolean;
  showUserMessages: boolean;
  showAssistantMessages: boolean;
  reducedMotion: boolean;
  accentColor: AccentColor;
}

export interface ThreadMapBookmark {
  id: string;
  url: string;
  createdAt: number;
  messagePreview: string;
  role: ChatMessageRole;
  features: ChatMessageFeature[];
}
