import type { Keybind } from "./types";

// platform-appropriate label for the meta key (cmd vs win)
const META_LABEL =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Win";

// renders a binding like "Alt + Shift + W" or "Alt + Shift + Click"
export function formatKeybind(bind: Keybind, clickFallback = false): string {
  const parts: string[] = [];
  if (bind.ctrlKey) parts.push("Ctrl");
  if (bind.altKey) parts.push("Alt");
  if (bind.shiftKey) parts.push("Shift");
  if (bind.metaKey) parts.push(META_LABEL);
  if (bind.key) parts.push(bind.key.toUpperCase());
  else if (clickFallback) parts.push("Click");
  return parts.join(" + ");
}

// does a mouse or keyboard event match the binding? when matchKey is false,
// only modifiers are compared (used for click bindings).
export function matchesKeybind(
  e: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; key?: string },
  bind: Keybind,
  matchKey = true
): boolean {
  if (e.altKey !== bind.altKey) return false;
  if (e.shiftKey !== bind.shiftKey) return false;
  if (e.ctrlKey !== bind.ctrlKey) return false;
  if (e.metaKey !== bind.metaKey) return false;
  if (matchKey && bind.key) {
    if (!e.key) return false;
    if (e.key.toLowerCase() !== bind.key.toLowerCase()) return false;
  }
  return true;
}

// modifier-only? (used for click bindings where the action is a mouse click
// rather than a specific key press)
export function bindHasAnyModifier(bind: Keybind): boolean {
  return bind.altKey || bind.shiftKey || bind.ctrlKey || bind.metaKey;
}
