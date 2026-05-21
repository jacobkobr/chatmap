// minimal service worker — no remote calls, just keeps the extension alive
chrome.runtime.onInstalled.addListener(() => {
  // nothing to do on install for MVP
});
