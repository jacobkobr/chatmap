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

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
