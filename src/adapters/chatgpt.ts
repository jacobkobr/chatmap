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
    // accept turns with an explicit author-role OR turns containing prose/
    // markdown content. instant-answer-mode assistant turns sometimes ship
    // without `data-message-author-role` on the response wrapper, so the
    // prose hooks are the only reliable signal that content exists.
    const byTurn = Array.from(
      root.querySelectorAll<HTMLElement>("[data-testid^='conversation-turn-']")
    )
      .filter((el) => !isExcluded(el))
      .filter((el) =>
        el.querySelector(
          "[data-message-author-role='user'], [data-message-author-role='assistant'], .markdown, [class*='markdown'], [class*='prose']"
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
    // direct attribute (fallback path — when getMessageElements returned
    // the author-role node itself)
    const direct = element.getAttribute("data-message-author-role");
    if (direct === "user") return "user";
    if (direct === "assistant") return "assistant";

    // scan ALL descendants with the attribute and prefer 'assistant'. some
    // chatgpt modes (instant answer) nest a user-role node inside the
    // assistant turn (likely the prompt echo / citation block), and the
    // previous first-match lookup mis-labeled the entire turn as user.
    const children = element.querySelectorAll<HTMLElement>("[data-message-author-role]");
    let hasUser = false;
    for (const c of children) {
      const r = c.getAttribute("data-message-author-role");
      if (r === "assistant") return "assistant";
      if (r === "user") hasUser = true;
    }

    // last-resort: if a prose/markdown body exists outside any user-role
    // descendant, it's an assistant response. covers turns where the role
    // attribute is absent entirely.
    const prose = element.querySelector<HTMLElement>(
      ".markdown, [class*='markdown'], [class*='prose']"
    );
    if (prose) {
      const userBody = element.querySelector<HTMLElement>("[data-message-author-role='user']");
      if (!userBody || !userBody.contains(prose)) return "assistant";
    }

    if (hasUser) return "user";
    return "unknown";
  },

  getMessageText(element: HTMLElement): string {
    // prefer prose / markdown container — clean assistant body, no role label
    const prose = element.querySelector<HTMLElement>(
      "[class*='prose'], .markdown, [class*='markdown']"
    );
    if (prose) return safeTextContent(prose);

    // user messages don't use prose; the author-role node itself holds the
    // message body without the "You said:" label that wraps it
    const authored = element.querySelector<HTMLElement>(
      "[data-message-author-role='user'], [data-message-author-role='assistant']"
    );
    if (authored) return safeTextContent(authored);

    return safeTextContent(element);
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
