import { removeShadowHost } from "./shadowRoot";

// injects the highlight style sheet into host page once
let highlightStyleInjected = false;

export function injectHighlightStyle(): void {
  if (highlightStyleInjected) return;
  highlightStyleInjected = true;

  // we use a hard-coded string so no remote css is ever fetched
  const style = document.createElement("style");
  style.dataset.threadmap = "highlight";
  style.textContent = `.threadmap-highlight{outline:2px solid rgba(180,180,180,.45)!important;outline-offset:6px!important;border-radius:6px!important;transition:outline .4s ease!important;}`;
  document.head.appendChild(style);
}

export function teardown(): void {
  removeShadowHost();
  // remove highlight style
  document.querySelector("style[data-threadmap='highlight']")?.remove();
  // clean up data attributes we stamped on message elements
  document.querySelectorAll<HTMLElement>("[data-threadmap-id]").forEach((el) => {
    delete el.dataset.threadmapId;
  });
}
