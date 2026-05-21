import { useState, useEffect, useCallback, useRef } from "react";
import type { ChatMessageRecord } from "../shared/types";
import type { ChatSiteAdapter } from "../adapters/types";
import { debounce, generateId, safeTextContent } from "../shared/utils";
import { PREVIEW_CHAR_LIMIT, DEBOUNCE_MS } from "../shared/constants";

function buildRecords(
  adapter: ChatSiteAdapter,
  root: HTMLElement
): ChatMessageRecord[] {
  const elements = adapter.getMessageElements(root);
  if (elements.length === 0) return [];

  const scrollEl = findScrollContainer(root);
  const scrollTop = scrollEl?.scrollTop ?? window.scrollY;
  const rootTop = scrollEl
    ? scrollEl.getBoundingClientRect().top
    : 0;
  return elements.map((el, i) => {
    const rect = el.getBoundingClientRect();
    const text = adapter.getMessageText(el);

    let id = el.dataset.threadmapId;
    if (!id) {
      id = generateId(`msg-${i}`);
      el.dataset.threadmapId = id;
    }

    return {
      id,
      role: adapter.getMessageRole(el),
      element: el,
      textPreview: safeTextContent(el).slice(0, PREVIEW_CHAR_LIMIT),
      fullTextLength: text.length,
      features: adapter.getMessageFeatures(el, text),
      top: rect.top - rootTop + scrollTop,
      height: rect.height,
    };
  });
}

// find the scrollable container for the conversation
function findScrollContainer(root: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = root;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    if (style.overflowY === "auto" || style.overflowY === "scroll") return el;
    el = el.parentElement;
  }
  // check if root itself scrolls
  if (root.scrollHeight > root.clientHeight) return root;
  return null;
}

export function useMessageIndex(adapter: ChatSiteAdapter | null) {
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [scrollHeight, setScrollHeight] = useState(1);
  const scrollElRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(() => {
    if (!adapter) return;

    const root = adapter.getConversationRoot();
    if (!root) {
      setMessages([]);
      return;
    }

    const records = buildRecords(adapter, root);
    const scrollEl = findScrollContainer(root);
    scrollElRef.current = scrollEl;

    const sh =
      scrollEl?.scrollHeight ??
      document.documentElement.scrollHeight ??
      1;

    setScrollHeight(sh || 1);
    setMessages(records);
  }, [adapter]);

  const debouncedRefresh = useRef(debounce(refresh as () => void, DEBOUNCE_MS));

  useEffect(() => {
    debouncedRefresh.current = debounce(refresh as () => void, DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    if (!adapter) return;

    refresh();

    // watch whole document subtree so we catch chatgpt's async message renders
    const observer = new MutationObserver(() => debouncedRefresh.current());
    observer.observe(document.body, { childList: true, subtree: true });

    const onScroll = () => debouncedRefresh.current();
    window.addEventListener("scroll", onScroll, { passive: true });

    // also watch the scroll container if found
    const watchScroll = () => {
      if (scrollElRef.current) {
        scrollElRef.current.addEventListener("scroll", onScroll, { passive: true });
      }
    };
    watchScroll();

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      scrollElRef.current?.removeEventListener("scroll", onScroll);
    };
  }, [adapter, refresh]);

  return { messages, scrollHeight };
}
