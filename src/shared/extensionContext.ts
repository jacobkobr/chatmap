// chrome invalidates a content script's extension context when the extension
// is reloaded or updated while the tab stays open. the script keeps running as
// a zombie and every chrome.* call throws "Extension context invalidated", so
// reads spam errors and writes (e.g. saving a bookmark) fail silently. callers
// use this to bail out cleanly instead.
export function isExtensionAlive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}
