import type { ChatMessageRole, ChatMessageFeature } from "../shared/types";

export interface ChatSiteAdapter {
  id: string;
  displayName: string;
  matchesLocation(location: Location): boolean;
  getConversationRoot(): HTMLElement | null;
  getMessageElements(root: HTMLElement): HTMLElement[];
  getMessageRole(element: HTMLElement): ChatMessageRole;
  getMessageText(element: HTMLElement): string;
  getMessageFeatures(element: HTMLElement, text: string): ChatMessageFeature[];
}
