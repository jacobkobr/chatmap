import { removeShadowHost } from "./shadowRoot";

// injects the highlight style sheet into host page once
let highlightStyleInjected = false;

export function injectHighlightStyle(): void {
  if (highlightStyleInjected) return;
  highlightStyleInjected = true;

  // we use a hard-coded string so no remote css is ever fetched.
  // outer-glow halo: a soft aura radiates outward from the message edges
  // (positive blur, negative spread, no background fill). text sits inside
  // the aura untouched. driven by a css animation with asymmetric phases so
  // the fade-OUT runs noticeably slower than the fade-IN — the lingering
  // tail makes the highlight feel intentional rather than blinking off. when
  // the user jumps to a new marker, the prior element has its class yanked
  // and the animation halts — that's still a hard snap (no trail), which is
  // the trade-off we made for clean rapid jumps. color comes from a custom
  // property set on <html> based on settings.accentColor.
  const style = document.createElement("style");
  style.dataset.chatmap = "highlight";
  const halo = (r: number, g: number, b: number) =>
    `0 0 20px -4px rgba(${r},${g},${b},0.50),0 0 36px 0 rgba(${r},${g},${b},0.12)`;
  style.textContent =
    `html{--chatmap-halo:${halo(163, 163, 163)};}` +
    `html[data-chatmap-accent="gray"]{--chatmap-halo:${halo(163, 163, 163)};}` +
    `html[data-chatmap-accent="white"]{--chatmap-halo:${halo(250, 250, 250)};}` +
    `html[data-chatmap-accent="blue"]{--chatmap-halo:${halo(37, 150, 190)};}` +
    `html[data-chatmap-accent="purple"]{--chatmap-halo:${halo(139, 92, 246)};}` +
    `html[data-chatmap-accent="green"]{--chatmap-halo:${halo(34, 197, 94)};}` +
    `html[data-chatmap-accent="orange"]{--chatmap-halo:${halo(249, 115, 22)};}` +
    `html[data-chatmap-accent="pink"]{--chatmap-halo:${halo(236, 72, 153)};}` +
    `html[data-chatmap-accent="sparkle"]{--chatmap-halo:${halo(192, 132, 252)};}` +
    ".chatmap-highlight{" +
    "border-radius:10px!important;" +
    "animation:chatmap-halo 1500ms ease forwards!important;" +
    "}" +
    "@keyframes chatmap-halo{" +
    "0%{box-shadow:0 0 0 0 transparent,0 0 0 0 transparent;}" +
    "18%{box-shadow:var(--chatmap-halo);}" +
    "45%{box-shadow:var(--chatmap-halo);}" +
    "100%{box-shadow:0 0 0 0 transparent,0 0 0 0 transparent;}" +
    "}";
  document.head.appendChild(style);
}

export function teardown(): void {
  removeShadowHost();
  // remove highlight style
  document.querySelector("style[data-chatmap='highlight']")?.remove();
  // clean up data attributes we stamped on message elements
  document.querySelectorAll<HTMLElement>("[data-chatmap-id]").forEach((el) => {
    delete el.dataset.chatmapId;
  });
}
