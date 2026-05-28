import { MINIMAP_HOST_ID } from "../shared/constants";
// css is imported as a string via ?inline query so it can be injected into shadow dom
import minimapCss from "../styles/minimap.css?inline";

export function createShadowHost(
  accentColor: string,
  markerSize: string = "normal"
): {
  host: HTMLElement;
  shadow: ShadowRoot;
} {
  const host = document.createElement("div");
  host.id = MINIMAP_HOST_ID;
  host.setAttribute("data-accent", accentColor);
  host.setAttribute("data-size", markerSize);
  // remove from normal document flow, pointer-events managed by rail css
  host.style.cssText = "position:fixed;top:0;right:0;width:0;height:0;z-index:2147483647;pointer-events:none;";

  // open mode — closed mode breaks composedPath() for listeners attached
  // on document, which the bookmark editor relies on to distinguish
  // inside-the-popover clicks from outside-click-to-close. open mode
  // still gives us full style isolation; the only thing it allows is
  // external scripts reading host.shadowRoot, which has no security
  // value here (we don't render anything sensitive inside).
  const shadow = host.attachShadow({ mode: "open" });

  // inject styles into shadow root
  const style = document.createElement("style");
  style.textContent = minimapCss;
  shadow.appendChild(style);

  return { host, shadow };
}

export function removeShadowHost(): void {
  document.getElementById(MINIMAP_HOST_ID)?.remove();
}
