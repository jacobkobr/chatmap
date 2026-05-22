import { useState, useEffect, useCallback, useRef } from "react";
import type { ChatMessageRecord, ConvCache } from "../shared/types";
import type { ChatSiteAdapter } from "../adapters/types";
import { debounce, generateId, cleanPreviewText } from "../shared/utils";
import { PREVIEW_CHAR_LIMIT, DEBOUNCE_MS } from "../shared/constants";
import { getConversationId } from "../storage/bookmarks";
import { loadCache, saveCache, projectMarkers } from "../storage/markerCache";

function buildRecords(
  adapter: ChatSiteAdapter,
  root: HTMLElement
): ChatMessageRecord[] {
  const elements = adapter.getMessageElements(root);
  if (elements.length === 0) return [];

  return elements.map((el, i) => {
    const text = adapter.getMessageText(el);

    // stable id per element — stamped once, survives re-renders
    let id = el.dataset.chatmapId;
    if (!id) {
      id = generateId(`msg-${i}`);
      el.dataset.chatmapId = id;
    }

    // sort key — turn number from data-testid, or fallback to discovery order
    if (!el.dataset.chatmapOrder) {
      const m = el.getAttribute("data-testid")?.match(/(\d+)$/);
      el.dataset.chatmapOrder = m ? m[1] : String(Date.now() + i);
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
    const orderStr = el.dataset.chatmapOrder;
    const order = orderStr ? parseInt(orderStr) : undefined;
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
      order,
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
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [cacheState, setCacheState] = useState<ConvCache | null>(null);
  const suppressUntilRef = useRef(0);
  const messagesRef = useRef<ChatMessageRecord[]>([]);
  // convId captured at mount — minimap is remounted on navigation so this
  // is stable for the lifetime of the hook.
  const convIdRef = useRef<string | null>(null);

  // accumulated record map — messages are added as chatgpt lazy-loads earlier
  // history but never removed within the same conversation. seeded from
  // chrome.storage.local cache on mount so the rail shows full history
  // immediately on refresh / chat reopen.
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

    // detect navigation to a new conversation via the url conv id. anchor
    // overlap is unreliable because chatgpt's `conversation-turn-N` collides
    // across chats (chat A's turn-3 has the same data-testid as chat B's
    // turn-3), so we need the canonical url-based signal.
    const currentConvId = getConversationId();
    if (currentConvId !== convIdRef.current) {
      convIdRef.current = currentConvId;
      accumulatedRef.current.clear();
      setUnreadIds(new Set());
      setCacheLoaded(false);
      setCacheState(null);
      messagesRef.current = [];
      setMessages([]);

      if (currentConvId) {
        loadCache(currentConvId).then((cache) => {
          // user may have navigated away again before this resolved
          if (convIdRef.current !== currentConvId) return;
          if (cache && cache.markers.length > 0) {
            // dedup by domAnchor in case live records already landed
            const existingAnchors = new Set<string>();
            for (const r of accumulatedRef.current.values()) {
              if (r.domAnchor) existingAnchors.add(r.domAnchor);
            }
            for (const cm of cache.markers) {
              if (existingAnchors.has(cm.domAnchor)) continue;
              if (accumulatedRef.current.has(cm.id)) continue;
              accumulatedRef.current.set(cm.id, {
                id: cm.id,
                role: cm.role,
                textPreview: cm.textPreview,
                fullTextLength: cm.fullTextLength,
                features: cm.features,
                top: 0,
                height: 0,
                domAnchor: cm.domAnchor,
                order: cm.order,
              });
            }
            const seeded = Array.from(accumulatedRef.current.values()).sort(
              (a, b) => (a.order ?? 999999) - (b.order ?? 999999)
            );
            messagesRef.current = seeded;
            setMessages(seeded);
          }
          setCacheState(cache);
          setCacheLoaded(true);
        });
      } else {
        setCacheLoaded(true);
      }
    }

    const records = buildRecords(adapter, root);

    // re-key any accumulated record whose dom node was rebuilt — react may
    // drop our stamped dataset attributes, which would produce a duplicate
    // marker. dedup by stable dom anchor (chatgpt conversation-turn-N).
    // also handles cache-seeded records: they have no live element yet, so
    // when the dom mounts the matching turn we want the fresh record to
    // adopt the cached id and replace the stub.
    if (records.length > 0) {
      const anchorToExistingId = new Map<string, string>();
      for (const [id, r] of accumulatedRef.current) {
        if (r.domAnchor) anchorToExistingId.set(r.domAnchor, id);
      }
      for (const fresh of records) {
        if (!fresh.domAnchor || !fresh.element) continue;
        const existingId = anchorToExistingId.get(fresh.domAnchor);
        if (existingId && existingId !== fresh.id) {
          // re-stamp the live element with the original id so future scans match
          fresh.element.dataset.chatmapId = existingId;
          accumulatedRef.current.delete(existingId);
          fresh.id = existingId;
        }
      }
    }

    // update accumulated with latest data for currently rendered elements
    records.forEach((r) => accumulatedRef.current.set(r.id, r));

    // write back to cache (debounced). only stores records with a domAnchor
    // because cached-only stubs need a stable address to re-resolve later.
    if (convIdRef.current) {
      debouncedSaveRef.current();
    }

    // sort by turn order so history is always oldest-first. prefer the live
    // element's dataset (most authoritative) and fall back to the record's
    // own `order` field (set on cache-seeded stubs that lack an element).
    const sorted = Array.from(accumulatedRef.current.values()).sort((a, b) => {
      const ao =
        a.element?.dataset.chatmapOrder !== undefined
          ? parseInt(a.element.dataset.chatmapOrder)
          : a.order ?? 999999;
      const bo =
        b.element?.dataset.chatmapOrder !== undefined
          ? parseInt(b.element.dataset.chatmapOrder)
          : b.order ?? 999999;
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

  // debounced cache save. runs ~800ms after the last refresh so we batch
  // bursty mutation observer events into one storage write per stream of
  // user scrolling.
  const debouncedSaveRef = useRef(
    debounce(() => {
      const convId = convIdRef.current;
      if (!convId) return;
      const markers = projectMarkers(
        Array.from(accumulatedRef.current.values())
      );
      if (markers.length === 0) return;
      saveCache(convId, { markers });
    }, 800)
  );

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

  // persist flag changes (fully scanned, offer dismissed) and reflect them
  // locally so the caller can re-render without an extra round trip.
  const markFullyScanned = useCallback(async () => {
    const convId = convIdRef.current;
    if (!convId) return;
    await saveCache(convId, { fullyScanned: true });
    setCacheState((prev) =>
      prev
        ? { ...prev, fullyScanned: true }
        : {
            markers: [],
            lastUpdated: Date.now(),
            fullyScanned: true,
            offerDismissed: false,
          }
    );
  }, []);

  const markOfferDismissed = useCallback(async () => {
    const convId = convIdRef.current;
    if (!convId) return;
    await saveCache(convId, { offerDismissed: true });
    setCacheState((prev) =>
      prev
        ? { ...prev, offerDismissed: true }
        : {
            markers: [],
            lastUpdated: Date.now(),
            fullyScanned: false,
            offerDismissed: true,
          }
    );
  }, []);

  return {
    messages,
    scrollHeight,
    isStreaming,
    unreadIds,
    markRead,
    suppressRefresh,
    cacheLoaded,
    cacheState,
    markFullyScanned,
    markOfferDismissed,
  };
}
