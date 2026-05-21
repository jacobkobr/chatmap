import type { ChatSiteAdapter } from "./types";
import type { ChatMessageRole, ChatMessageFeature } from "../shared/types";
import { safeTextContent } from "../shared/utils";
import { LONG_ANSWER_THRESHOLD } from "../shared/constants";

// tried in order — chatgpt renames classes frequently
const ROOT_SELECTORS = [
  "main [class*='react-scroll-to-bottom']",
  "[data-testid='conversation-turn-list']",
  "main",
];

// message selectors tried in order
const MESSAGE_SELECTORS = [
  "article[data-testid^='conversation-turn-']",
  "[data-testid^='conversation-turn-']",
  "article[data-scroll-anchor]",
  // broad fallback — any article not in nav/sidebar
  "article",
];

function detectRole(el: HTMLElement): ChatMessageRole {
  const direct = el.getAttribute("data-message-author-role");
  if (direct === "user") return "user";
  if (direct === "assistant") return "assistant";

  const child = el.querySelector("[data-message-author-role]");
  if (child) {
    const r = child.getAttribute("data-message-author-role");
    if (r === "user") return "user";
    if (r === "assistant") return "assistant";
  }

  const testid = el.getAttribute("data-testid") ?? "";
  if (testid.includes("human") || testid.includes("user")) return "user";
  if (testid.includes("assistant")) return "assistant";

  // structural heuristic
  const text = safeTextContent(el);
  if (text.length < 500 && !el.querySelector("pre, code, ol, ul, table")) return "user";

  return "unknown";
}

function isExcluded(el: HTMLElement): boolean {
  // sidebar/nav — never conversation messages
  if (el.closest("nav")) return true;
  // modals
  if (el.closest("[role='dialog'], [role='alertdialog']")) return true;
  // the text input area (not all forms — chatgpt wraps the whole page in a form)
  if (el.closest("#prompt-textarea, [data-testid='composer-background'], [contenteditable='true']")) return true;
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
    // always return body as last resort so observer works
    return document.body;
  },

  getMessageElements(root: HTMLElement): HTMLElement[] {
    for (const sel of MESSAGE_SELECTORS) {
      const els = Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(
        (el) => !isExcluded(el)
      );
      if (els.length > 0) return els;
    }
    return [];
  },

  getMessageRole(element: HTMLElement): ChatMessageRole {
    return detectRole(element);
  },

  getMessageText(element: HTMLElement): string {
    const prose =
      element.querySelector<HTMLElement>("[class*='prose'], .markdown, [class*='markdown']") ??
      element;
    return safeTextContent(prose);
  },

  getMessageFeatures(element: HTMLElement, text: string): ChatMessageFeature[] {
    const features: ChatMessageFeature[] = [];
    if (element.querySelector("pre, code")) features.push("code");
    if (element.querySelector("a[href]")) features.push("link");
    if (element.querySelector("img, picture, video")) features.push("image");
    if (element.querySelector("[data-testid*='source'], cite, [class*='source']")) features.push("source");
    if (element.querySelector("svg[aria-label*='attachment'], [data-testid*='file']")) features.push("attachment");
    if (text.length > LONG_ANSWER_THRESHOLD) features.push("long-answer");
    return features;
  },
};

export default chatgptAdapter;
