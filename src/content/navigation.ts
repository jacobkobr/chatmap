// detects SPA route changes so we can refresh the minimap between chats

type RouteChangeCallback = () => void;

export function watchNavigation(onChange: RouteChangeCallback): () => void {
  let currentUrl = location.href;

  // chatgpt uses pushState for navigation
  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);

  history.pushState = (...args) => {
    originalPush(...args);
    handleChange();
  };

  history.replaceState = (...args) => {
    originalReplace(...args);
    handleChange();
  };

  window.addEventListener("popstate", handleChange);

  function handleChange() {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      onChange();
    }
  }

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener("popstate", handleChange);
  };
}
