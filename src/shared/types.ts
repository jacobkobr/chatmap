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
}

export interface ThreadMapSettings {
  enabled: boolean;
  showUserMessages: boolean;
  showAssistantMessages: boolean;
  showCodeMarkers: boolean;
  showLongAnswerMarkers: boolean;
  showLinkMarkers: boolean;
  showImageMarkers: boolean;
  markerDensity: "compact" | "normal" | "detailed";
  reducedMotion: boolean;
  accentColor: "neutral" | "blue-purple" | "chatgpt";
}

export interface ThreadMapBookmark {
  id: string;
  url: string;
  createdAt: number;
  messagePreview: string;
  role: ChatMessageRole;
  features: ChatMessageFeature[];
}
