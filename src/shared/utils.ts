export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function generateId(prefix = "msg"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// safe text extraction — never uses innerHTML
export function safeTextContent(el: HTMLElement): string {
  return el.textContent ?? "";
}

// strips chatgpt ui artifacts that leak into textContent:
//   - "You said:" / "ChatGPT said:" role labels
//   - "Thought for 1m 30s" / "Reasoned for ..." reasoning chips
//   - leading "1/2" message-pagination labels on regenerated answers
// runs in order so a prefix followed by a reasoning chip still cleans up.
export function cleanPreviewText(raw: string): string {
  let t = raw.replace(/ /g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(/^(?:ChatGPT|You|Assistant)\s+said:?\s*/i, "");
    t = t.replace(
      /^(?:Thought|Reasoned|Analyzed|Working|Thinking|Searching|Reading)\s+(?:for\s+)?[^\n]*?(?:\d+[smh]|\d+\s*(?:seconds?|minutes?|hours?))[^\n]*\n?/i,
      ""
    );
    t = t.replace(/^\d+\s*\/\s*\d+\s*/, "");
    t = t.trim();
    if (t === before) break;
  }
  return stripMarkdown(t).trim();
}

// strips markdown syntax that leaks through when the source is raw text
// (api-loaded messages). dom-walked text is already rendered to plain
// by the browser so these regexes are no-ops on that path.
function stripMarkdown(t: string): string {
  // images: ![alt](url) — drop entirely; alt text is usually noise
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // links: [text](url) → text
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // code fences (keep content, drop the fence line)
  t = t.replace(/```[^\n]*\n?/g, "");
  // inline code: `text`
  t = t.replace(/`([^`]+)`/g, "$1");
  // emphasis — longest delimiters first so ** isn't consumed by the * pass
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/__([^_]+)__/g, "$1");
  t = t.replace(/\*([^*\n]+)\*/g, "$1");
  t = t.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1");
  t = t.replace(/~~([^~]+)~~/g, "$1");
  // line-leading syntax: headings, blockquotes, list bullets
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/^>\s+/gm, "");
  t = t.replace(/^[-*+]\s+/gm, "");
  t = t.replace(/^\d+\.\s+/gm, "");
  return t;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
