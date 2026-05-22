import type { ChatSiteAdapter } from "./types";
import type { ChatMessageRole, ChatMessageFeature } from "../shared/types";
import { safeTextContent } from "../shared/utils";
import { LONG_ANSWER_THRESHOLD } from "../shared/constants";

function isExcluded(el: HTMLElement): boolean {
  if (el.closest("nav")) return true;
  if (el.closest("[role='dialog'], [role='alertdialog']")) return true;
  if (el.closest("#prompt-textarea, [data-testid='composer-background']")) return true;
  return false;
}

// outermost wins — drop any el that is inside another el in the same list
function keepOutermost(els: HTMLElement[]): HTMLElement[] {
  return els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
}

const chatgptAdapter: ChatSiteAdapter = {
  id: "chatgpt",
  displayName: "ChatGPT",

  matchesLocation(location: Location): boolean {
    return (
      location.hostname === "chatgpt.com" ||
      location.hostname === "chat.openai.com"
    );
  },

  getConversationRoot(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>("main [class*='react-scroll-to-bottom']") ??
      document.querySelector<HTMLElement>("main") ??
      document.body
    );
  },

  getMessageElements(root: HTMLElement): HTMLElement[] {
    // conversation-turn-N containers bundle the full turn (text + attachments + images).
    // filter to only turns that actually contain a user or assistant message —
    // this removes tool-call turns, system turns, and empty thinking containers.
    const byTurn = Array.from(
      root.querySelectorAll<HTMLElement>("[data-testid^='conversation-turn-']")
    )
      .filter((el) => !isExcluded(el))
      .filter((el) =>
        el.querySelector(
          "[data-message-author-role='user'], [data-message-author-role='assistant']"
        )
      );

    if (byTurn.length > 0) return keepOutermost(byTurn);

    // fallback: data-message-author-role directly (older/alternate chatgpt builds)
    const byRole = Array.from(
      root.querySelectorAll<HTMLElement>("[data-message-author-role='user'], [data-message-author-role='assistant']")
    ).filter((el) => !isExcluded(el));

    return byRole.length > 0 ? keepOutermost(byRole) : [];
  },

  getMessageRole(element: HTMLElement): ChatMessageRole {
    // direct attribute (fallback path)
    const direct = element.getAttribute("data-message-author-role");
    if (direct === "user") return "user";
    if (direct === "assistant") return "assistant";

    // first child with the attribute (conversation-turn path)
    const child = element.querySelector<HTMLElement>("[data-message-author-role]");
    if (child) {
      const cr = child.getAttribute("data-message-author-role");
      if (cr === "user") return "user";
      if (cr === "assistant") return "assistant";
    }

    return "unknown";
  },

  getMessageText(element: HTMLElement): string {
    const prose =
      element.querySelector<HTMLElement>(
        "[class*='prose'], .markdown, [class*='markdown']"
      ) ?? element;
    return safeTextContent(prose);
  },

  getMessageFeatures(element: HTMLElement, text: string): ChatMessageFeature[] {
    const features: ChatMessageFeature[] = [];
    if (element.querySelector("pre, code")) features.push("code");
    if (element.querySelector("a[href]")) features.push("link");
    if (element.querySelector("img, picture, video")) features.push("image");
    if (element.querySelector("[data-testid*='source'], cite, [class*='source']"))
      features.push("source");
    if (element.querySelector("svg[aria-label*='attachment'], [data-testid*='file']"))
      features.push("attachment");
    if (text.length > LONG_ANSWER_THRESHOLD) features.push("long-answer");
    return features;
  },
};

export default chatgptAdapter;
