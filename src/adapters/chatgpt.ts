import type { ChatSiteAdapter } from "./types";
import type { ChatMessageRole, ChatMessageFeature } from "../shared/types";
import { safeTextContent } from "../shared/utils";
import { LONG_ANSWER_THRESHOLD } from "../shared/constants";

const ROOT_SELECTORS = [
  "main [class*='react-scroll-to-bottom']",
  "[data-testid='conversation-turn-list']",
  "main",
];

const MESSAGE_SELECTORS = [
  "article[data-testid^='conversation-turn-']",
  "[data-testid^='conversation-turn-']",
  "article[data-scroll-anchor]",
  "article",
];

function detectRole(el: HTMLElement): ChatMessageRole {
  // direct attribute on element
  const direct = el.getAttribute("data-message-author-role");
  if (direct === "user") return "user";
  if (direct === "assistant") return "assistant";

  // search all descendants — chatgpt puts this on a child div inside the article
  const child = el.querySelector("[data-message-author-role]");
  if (child) {
    const r = child.getAttribute("data-message-author-role");
    if (r === "user") return "user";
    if (r === "assistant") return "assistant";
  }

  // testid fallback (chatgpt has used 'human' for user turns)
  const testid = el.getAttribute("data-testid") ?? "";
  if (testid.includes("human")) return "user";
  if (testid.includes("assistant")) return "assistant";

  // don't guess — unknown is better than wrong
  return "unknown";
}

function isExcluded(el: HTMLElement): boolean {
  // sidebar nav — never real messages
  if (el.closest("nav")) return true;
  // modals
  if (el.closest("[role='dialog'], [role='alertdialog']")) return true;
  // the text input widget specifically — NOT all forms (chatgpt wraps page in form)
  if (el.closest("#prompt-textarea, [data-testid='composer-background']")) return true;
  return false;
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
    for (const sel of ROOT_SELECTORS) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) return el;
    }
    return document.body;
  },

  getMessageElements(root: HTMLElement): HTMLElement[] {
    for (const sel of MESSAGE_SELECTORS) {
      const raw = Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(
        (el) => !isExcluded(el)
      );
      if (raw.length === 0) continue;
      // keep only outermost matches — drop any element that is inside another
      const deduped = raw.filter(
        (el) => !raw.some((other) => other !== el && other.contains(el))
      );
      return deduped;
    }
    return [];
  },

  getMessageRole(element: HTMLElement): ChatMessageRole {
    return detectRole(element);
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
    if (
      element.querySelector(
        "svg[aria-label*='attachment'], [data-testid*='file']"
      )
    )
      features.push("attachment");
    if (text.length > LONG_ANSWER_THRESHOLD) features.push("long-answer");
    return features;
  },
};

export default chatgptAdapter;
