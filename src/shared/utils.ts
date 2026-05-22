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
  return t;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
