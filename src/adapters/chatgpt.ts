import type { ChatSiteAdapter, ApiMessage } from "./types";
import type { ChatMessageRole, ChatMessageFeature } from "../shared/types";
import { safeTextContent } from "../shared/utils";
import { LONG_ANSWER_THRESHOLD } from "../shared/constants";

// lightweight feature detection over plain text. live dom-walked records
// use richer element-based heuristics; for api-loaded records we only have
// the parts text, so we infer code/link from markdown signals.
function detectFeaturesFromText(text: string): ChatMessageFeature[] {
  const features: ChatMessageFeature[] = [];
  if (/```/.test(text)) features.push("code");
  if (/\bhttps?:\/\/\S+/i.test(text)) features.push("link");
  if (text.length > LONG_ANSWER_THRESHOLD) features.push("long-answer");
  return features;
}

// fetch the conversation tree from chatgpt's own backend. uses the page's
// existing auth session (cookie + bearer token from /api/auth/session) —
// no user setup required. returns messages in linear order following the
// current_node parent chain, which matches what chatgpt displays after
// edits/regenerations.
async function loadConversationFromApi(convId: string): Promise<ApiMessage[]> {
  const sessionRes = await fetch("/api/auth/session", { credentials: "same-origin" });
  if (!sessionRes.ok) throw new Error(`session ${sessionRes.status}`);
  const session = await sessionRes.json();
  const token = session?.accessToken;
  if (!token) throw new Error("no access token");

  const convRes = await fetch(`/backend-api/conversation/${convId}`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "same-origin",
  });
  if (!convRes.ok) throw new Error(`conversation ${convRes.status}`);
  const data = await convRes.json();

  const mapping = data?.mapping;
  if (!mapping || typeof mapping !== "object") {
    throw new Error("conversation missing mapping");
  }

  // walk current_node back to root via parent pointers so we get the active
  // branch of the tree (chatgpt stores edits as siblings). then reverse for
  // chronological order.
  const chain: string[] = [];
  let cursor: string | null | undefined = data.current_node;
  const seen = new Set<string>();
  while (cursor && mapping[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    cursor = mapping[cursor].parent ?? null;
  }
  chain.reverse();

  const messages: ApiMessage[] = [];
  let order = 1;
  for (const nodeId of chain) {
    const node = mapping[nodeId];
    const msg = node?.message;
    if (!msg) continue;
    const role = msg.author?.role;
    if (role !== "user" && role !== "assistant") continue;

    // skip internal-only assistant payloads (thoughts, reasoning_recap,
    // model_editable_context, code, etc.) — these are part of the chain but
    // never rendered as visible turns. only `text` and `multimodal_text`
    // produce dom turns the user sees.
    const contentType = msg.content?.content_type;
    if (contentType !== "text" && contentType !== "multimodal_text") continue;

    const parts: unknown[] = msg.content?.parts ?? [];
    const stringText = parts
      .filter((p): p is string => typeof p === "string")
      .join("\n")
      .trim();
    const hasImage = parts.some(
      (p) =>
        p && typeof p === "object" && (p as { content_type?: string }).content_type === "image_asset_pointer"
    );

    let text = stringText;
    if (text.length === 0) {
      // image-only user uploads (no caption) and similar attachment-only
      // messages still render as visible turns. give them a placeholder so
      // they aren't dropped — without this the live dom walk treats them as
      // orphan messages and assigns generated ids that diverge from the api
      // order, shifting subsequent markers.
      if (hasImage) text = "[image]";
      else if (parts.length > 0) text = "[attachment]";
      else continue;
    }

    const features = detectFeaturesFromText(text);
    if (hasImage && !features.includes("image")) features.push("image");

    messages.push({
      id: nodeId,
      role,
      text,
      features,
      order: order++,
    });
  }

  // collapse consecutive same-role assistant messages into one logical reply.
  // chatgpt's "search" / "research" flows produce a brief preamble bubble,
  // then tool nodes, then the real answer — each visible bubble is its own
  // mapping node with content_type='text', so without merging the rail
  // shows two markers for one perceptual response. tool / reasoning nodes
  // between them are already filtered out by the content_type check above,
  // so any same-role pair we see here is a candidate. user-side same-role
  // pairs are not merged (each user message is its own intent).
  const merged: ApiMessage[] = [];
  for (const m of messages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === "assistant" && m.role === "assistant") {
      prev.text = `${prev.text}\n\n${m.text}`;
      const absorbed = prev.absorbedMsgIds ?? [];
      absorbed.push(m.id);
      prev.absorbedMsgIds = absorbed;
      for (const f of m.features) {
        if (!prev.features.includes(f)) prev.features.push(f);
      }
      continue;
    }
    merged.push(m);
  }

  // re-number order so it remains dense (1..N) after the collapse.
  merged.forEach((m, i) => {
    m.order = i + 1;
  });

  return merged;
}

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

  loadConversation: loadConversationFromApi,
};

export default chatgptAdapter;
