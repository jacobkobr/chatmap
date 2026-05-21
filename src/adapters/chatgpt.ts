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
    // conversation-turn containers guarantee exactly one element per full turn —
    // this bundles text + images + tool calls into a single marker
    const byTurn = Array.from(
      root.querySelectorAll<HTMLElement>("[data-testid^='conversation-turn-']")
    ).filter((el) => !isExcluded(el));

    if (byTurn.length > 0) return keepOutermost(byTurn);

    // fallback: data-message-author-role (some chatgpt dom variations)
    const byRole = Array.from(
      root.querySelectorAll<HTMLElement>("[data-message-author-role]")
    ).filter((el) => !isExcluded(el));

    return byRole.length > 0 ? keepOutermost(byRole) : [];
  },

  getMessageRole(element: HTMLElement): ChatMessageRole {
    // direct attribute present (fallback path uses this)
    const direct = element.getAttribute("data-message-author-role");
    if (direct === "user") return "user";
    if (direct === "assistant") return "assistant";

    // look inside the turn container (primary path)
    const child = element.querySelector<HTMLElement>("[data-message-author-role]");
    if (child) {
      const cr = child.getAttribute("data-message-author-role");
      if (cr === "user") return "user";
      if (cr === "assistant") return "assistant";
    }

    // look up the tree (handles edge cases)
    const ancestor = element.closest<HTMLElement>("[data-message-author-role]");
    if (ancestor) {
      const ar = ancestor.getAttribute("data-message-author-role");
      if (ar === "user") return "user";
      if (ar === "assistant") return "assistant";
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
