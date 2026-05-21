import { MINIMAP_HOST_ID } from "../shared/constants";
// css is imported as a string via ?inline query so it can be injected into shadow dom
import minimapCss from "../styles/minimap.css?inline";

export function createShadowHost(accentColor: string): {
  host: HTMLElement;
  shadow: ShadowRoot;
} {
  const host = document.createElement("div");
  host.id = MINIMAP_HOST_ID;
  host.setAttribute("data-accent", accentColor);
  // remove from normal document flow, pointer-events managed by rail css
  host.style.cssText = "position:fixed;top:0;right:0;width:0;height:0;z-index:2147483647;pointer-events:none;";

  const shadow = host.attachShadow({ mode: "closed" });

  // inject styles into shadow root
  const style = document.createElement("style");
  style.textContent = minimapCss;
  shadow.appendChild(style);

  return { host, shadow };
}

export function removeShadowHost(): void {
  document.getElementById(MINIMAP_HOST_ID)?.remove();
}
