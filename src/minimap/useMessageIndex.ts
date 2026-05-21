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
  const rootRect = root.getBoundingClientRect();
  const scrollTop = root.scrollTop;

  return elements.map((el, i) => {
    const rect = el.getBoundingClientRect();
    const text = adapter.getMessageText(el);

    // reuse existing id if we already tagged this element
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
      // position relative to root, accounting for scroll
      top: rect.top - rootRect.top + scrollTop,
      height: rect.height,
    };
  });
}

export function useMessageIndex(adapter: ChatSiteAdapter | null) {
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [scrollHeight, setScrollHeight] = useState(1);
  const rootRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(() => {
    if (!adapter) return;

    const root = adapter.getConversationRoot();
    if (!root) {
      setMessages([]);
      return;
    }

    rootRef.current = root;
    setScrollHeight(root.scrollHeight || 1);
    setMessages(buildRecords(adapter, root));
  }, [adapter]);

  const debouncedRefresh = useRef(debounce(refresh as () => void, DEBOUNCE_MS));

  useEffect(() => {
    debouncedRefresh.current = debounce(refresh as () => void, DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    if (!adapter) return;

    refresh();

    const observer = new MutationObserver(() => debouncedRefresh.current());
    const root = adapter.getConversationRoot();
    if (root) {
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    } else {
      // watch body until root appears
      observer.observe(document.body, { childList: true, subtree: false });
    }

    // re-index on scroll so position calculations stay fresh
    const onScroll = () => debouncedRefresh.current();
    window.addEventListener("scroll", onScroll, { passive: true });
    rootRef.current?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      rootRef.current?.removeEventListener("scroll", onScroll);
    };
  }, [adapter, refresh]);

  return { messages, scrollHeight, root: rootRef.current };
}
