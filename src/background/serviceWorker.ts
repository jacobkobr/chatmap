// clicking the extension icon opens the settings/options page
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
