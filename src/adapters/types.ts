import type { ChatMessageRole, ChatMessageFeature } from "../shared/types";

// minimal message record returned by an adapter's api loader. order is the
// position in the linear conversation thread (1-indexed to match chatgpt's
// conversation-turn-N convention).
export interface ApiMessage {
  id: string;                // chatgpt's internal message uuid
  role: ChatMessageRole;
  text: string;
  features: ChatMessageFeature[];
  order: number;
}

export interface ChatSiteAdapter {
  id: string;
  displayName: string;
  matchesLocation(location: Location): boolean;
  getConversationRoot(): HTMLElement | null;
  getMessageElements(root: HTMLElement): HTMLElement[];
  getMessageRole(element: HTMLElement): ChatMessageRole;
  getMessageText(element: HTMLElement): string;
  getMessageFeatures(element: HTMLElement, text: string): ChatMessageFeature[];
  // optional: fetch the full conversation from the site's own backend so
  // the rail can populate without scrolling. throws on auth/network failure.
  loadConversation?(convId: string): Promise<ApiMessage[]>;
}
