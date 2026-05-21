import type { ChatSiteAdapter } from "./types";
import type { ChatMessageRole, ChatMessageFeature } from "../shared/types";
import { safeTextContent } from "../shared/utils";
import { LONG_ANSWER_THRESHOLD } from "../shared/constants";

// multiple selector strategies, tried in order — chatgpt renames classes frequently
const ROOT_SELECTORS = [
  "[data-testid='conversation-turn-list']",
  "main [class*='react-scroll-to-bottom']",
  "#thread-bottom",
  "main",
];

// message container selectors, tried in order
const MESSAGE_SELECTORS = [
  "[data-testid^='conversation-turn-']",
  "[data-message-author-role]",
  "article[data-scroll-anchor]",
];

// role attribute locations to try
function detectRole(el: HTMLElement): ChatMessageRole {
  const attr = el.getAttribute("data-message-author-role");
  if (attr === "user") return "user";
  if (attr === "assistant") return "assistant";

  // fallback: look for role attr on child
  const child = el.querySelector("[data-message-author-role]");
  if (child) {
    const r = child.getAttribute("data-message-author-role");
    if (r === "user") return "user";
    if (r === "assistant") return "assistant";
  }

  // fallback: testid contains "user" or "assistant"
  const testid = el.getAttribute("data-testid") ?? "";
  if (testid.includes("human")) return "user";
  if (testid.includes("assistant")) return "assistant";

  // last resort: structural — user messages typically have a shorter, non-prose container
  const text = safeTextContent(el);
  if (text.length < 600 && !el.querySelector("pre, code, ol, ul")) return "user";

  return "unknown";
}

// exclude elements that aren't real conversation messages
function isExcluded(el: HTMLElement): boolean {
  // sidebar history items
  if (el.closest("nav, aside, [data-testid='sidebar']")) return true;
  // modal / dialog
  if (el.closest("[role='dialog'], [role='alertdialog']")) return true;
  // composer / input area
  if (el.closest("form, [data-testid='composer']")) return true;
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
    return null;
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
    // prefer the prose content block if present
    const prose =
      element.querySelector<HTMLElement>("[class*='prose'], .markdown") ??
      element;
    return safeTextContent(prose);
  },

  getMessageFeatures(element: HTMLElement, text: string): ChatMessageFeature[] {
    const features: ChatMessageFeature[] = [];

    if (element.querySelector("pre, code")) features.push("code");
    if (element.querySelector("a[href]")) features.push("link");
    if (element.querySelector("img, picture, video")) features.push("image");
    if (element.querySelector("[data-testid*='source'], cite")) features.push("source");
    if (element.querySelector("svg[aria-label*='attachment'], [data-testid*='file']"))
      features.push("attachment");
    if (text.length > LONG_ANSWER_THRESHOLD) features.push("long-answer");

    return features;
  },
};

export default chatgptAdapter;
