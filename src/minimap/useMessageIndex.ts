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
  const rootTop = scrollEl ? scrollEl.getBoundingClientRect().top : 0;

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

function findScrollContainer(root: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = root;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    if (style.overflowY === "auto" || style.overflowY === "scroll") return el;
    el = el.parentElement;
  }
  if (root.scrollHeight > root.clientHeight) return root;
  return null;
}

function isStreamingNow(): boolean {
  return !!(
    document.querySelector('[data-testid="stop-button"]') ||
    document.querySelector('[class*="result-streaming"]') ||
    document.querySelector('button[aria-label*="Stop"]')
  );
}

function isNearBottom(): boolean {
  const sh = document.documentElement.scrollHeight;
  const sy = window.scrollY;
  const ih = window.innerHeight;
  // also check inner scroll containers
  const innerSh = document.querySelector("main")?.scrollHeight ?? sh;
  const innerSy = document.querySelector("main")?.scrollTop ?? 0;
  const innerCheck = innerSh - innerSy - ih < 300;
  return (sh - sy - ih < 300) || innerCheck;
}

export function useMessageIndex(adapter: ChatSiteAdapter | null) {
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [scrollHeight, setScrollHeight] = useState(1);
  const [isStreaming, setIsStreaming] = useState(false);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const scrollElRef = useRef<HTMLElement | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());

  const markRead = useCallback((id: string) => {
    setUnreadIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

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

    // detect newly appeared messages and mark unread if user isn't at bottom
    const newIds = new Set(records.map((r) => r.id));
    const appeared: string[] = [];
    newIds.forEach((id) => {
      if (!prevIdsRef.current.has(id)) appeared.push(id);
    });
    prevIdsRef.current = newIds;

    if (appeared.length > 0 && !isNearBottom()) {
      setUnreadIds((prev) => {
        const next = new Set(prev);
        appeared.forEach((id) => next.add(id));
        return next;
      });
    }

    setMessages(records);
    setIsStreaming(isStreamingNow());
  }, [adapter]);

  const debouncedRefresh = useRef(debounce(refresh as () => void, DEBOUNCE_MS));

  useEffect(() => {
    debouncedRefresh.current = debounce(refresh as () => void, DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    if (!adapter) return;

    refresh();

    const observer = new MutationObserver(() => debouncedRefresh.current());
    observer.observe(document.body, { childList: true, subtree: true });

    const onScroll = () => debouncedRefresh.current();
    window.addEventListener("scroll", onScroll, { passive: true });

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

  return { messages, scrollHeight, isStreaming, unreadIds, markRead };
}
