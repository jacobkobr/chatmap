import { useState, useEffect, useCallback, useRef } from "react";
import type { ChatMessageRecord } from "../shared/types";
import type { ChatSiteAdapter } from "../adapters/types";
import { debounce, generateId, cleanPreviewText } from "../shared/utils";
import { PREVIEW_CHAR_LIMIT, DEBOUNCE_MS } from "../shared/constants";

function buildRecords(
  adapter: ChatSiteAdapter,
  root: HTMLElement
): ChatMessageRecord[] {
  const elements = adapter.getMessageElements(root);
  if (elements.length === 0) return [];

  return elements.map((el, i) => {
    const text = adapter.getMessageText(el);

    // stable id per element — stamped once, survives re-renders
    let id = el.dataset.threadmapId;
    if (!id) {
      id = generateId(`msg-${i}`);
      el.dataset.threadmapId = id;
    }

    // sort key — turn number from data-testid, or fallback to discovery order
    if (!el.dataset.threadmapOrder) {
      const m = el.getAttribute("data-testid")?.match(/(\d+)$/);
      el.dataset.threadmapOrder = m ? m[1] : String(Date.now() + i);
    }

    // canonical dom anchor — survives react re-renders that drop our stamped
    // dataset attributes. chatgpt uses conversation-turn-N which is stable
    // across virtualization and rebuilds.
    const domAnchor = el.getAttribute("data-testid") ?? undefined;

    // use adapter.getMessageText (targets prose/markdown container) for the
    // preview so we skip the surrounding role labels and reasoning chips,
    // then run a regex pass for anything that still leaks through.
    const preview = cleanPreviewText(text).slice(0, PREVIEW_CHAR_LIMIT);

    const rect = el.getBoundingClientRect();
    return {
      id,
      role: adapter.getMessageRole(el),
      element: el,
      textPreview: preview,
      fullTextLength: text.length,
      features: adapter.getMessageFeatures(el, text),
      top: rect.top + window.scrollY,
      height: rect.height,
      domAnchor,
    };
  });
}

function isStreamingNow(): boolean {
  return !!(
    document.querySelector('[data-testid="stop-button"]') ||
    document.querySelector('[class*="result-streaming"]') ||
    document.querySelector('button[aria-label*="Stop"]')
  );
}

function isNearBottom(): boolean {
  // check the main inner scroll container chatgpt uses
  const inner = document.querySelector<HTMLElement>("main [class*='react-scroll-to-bottom'] > div > div");
  if (inner) return inner.scrollHeight - inner.scrollTop - inner.clientHeight < 300;
  return document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 300;
}

export function useMessageIndex(adapter: ChatSiteAdapter | null) {
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [scrollHeight, setScrollHeight] = useState(1);
  const [isStreaming, setIsStreaming] = useState(false);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const suppressUntilRef = useRef(0);
  const messagesRef = useRef<ChatMessageRecord[]>([]);

  // accumulated record map — messages are added as chatgpt lazy-loads earlier
  // history but never removed within the same conversation.
  const accumulatedRef = useRef<Map<string, ChatMessageRecord>>(new Map());

  const suppressRefresh = useCallback((ms: number) => {
    suppressUntilRef.current = Date.now() + ms;
  }, []);

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

    // detect navigation to a new conversation — if none of the fresh records
    // match anything accumulated (by id OR by stable dom anchor), the user
    // switched chats, so clear the cache.
    if (accumulatedRef.current.size > 0 && records.length > 0) {
      const accAnchors = new Set(
        Array.from(accumulatedRef.current.values())
          .map((r) => r.domAnchor)
          .filter(Boolean) as string[]
      );
      const hasOverlap = records.some(
        (r) =>
          accumulatedRef.current.has(r.id) ||
          (r.domAnchor && accAnchors.has(r.domAnchor))
      );
      if (!hasOverlap) {
        accumulatedRef.current.clear();
        setUnreadIds(new Set());
      }
    }

    // re-key any accumulated record whose dom node was rebuilt — react may
    // drop our stamped dataset attributes, which would produce a duplicate
    // marker. dedup by stable dom anchor (chatgpt conversation-turn-N).
    if (records.length > 0) {
      const anchorToExistingId = new Map<string, string>();
      for (const [id, r] of accumulatedRef.current) {
        if (r.domAnchor) anchorToExistingId.set(r.domAnchor, id);
      }
      for (const fresh of records) {
        if (!fresh.domAnchor) continue;
        const existingId = anchorToExistingId.get(fresh.domAnchor);
        if (existingId && existingId !== fresh.id) {
          // re-stamp the live element with the original id so future scans match
          fresh.element.dataset.threadmapId = existingId;
          accumulatedRef.current.delete(existingId);
          fresh.id = existingId;
        }
      }
    }

    // update accumulated with latest data for currently rendered elements
    records.forEach((r) => accumulatedRef.current.set(r.id, r));

    // sort by turn order so history is always oldest-first
    const sorted = Array.from(accumulatedRef.current.values()).sort((a, b) => {
      const ao = parseInt(a.element.dataset.threadmapOrder ?? "999999");
      const bo = parseInt(b.element.dataset.threadmapOrder ?? "999999");
      return ao - bo;
    });

    // mark new messages unread if user isn't at the bottom
    const prevIds = new Set(messagesRef.current.map((m) => m.id));
    const appeared = sorted.filter((r) => !prevIds.has(r.id));
    if (appeared.length > 0 && !isNearBottom()) {
      setUnreadIds((prev) => {
        const next = new Set(prev);
        appeared.forEach((r) => next.add(r.id));
        return next;
      });
    }

    setScrollHeight(root.scrollHeight || 1);
    messagesRef.current = sorted;
    setMessages(sorted);
    setIsStreaming(isStreamingNow());
  }, [adapter]);

  const debouncedRefresh = useRef(debounce(refresh as () => void, DEBOUNCE_MS));

  useEffect(() => {
    debouncedRefresh.current = debounce(refresh as () => void, DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    if (!adapter) return;

    refresh();

    const observer = new MutationObserver(() => {
      if (Date.now() < suppressUntilRef.current) return;
      debouncedRefresh.current();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [adapter, refresh]);

  return { messages, scrollHeight, isStreaming, unreadIds, markRead, suppressRefresh };
}
