import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type {
  ChatMessageRecord,
  MessageBookmark,
  ChatMapSettings,
} from "../shared/types";
import type { ChatSiteAdapter } from "../adapters/types";
import { useMessageIndex } from "./useMessageIndex";
import { Marker } from "./Marker";
import { PreviewCard } from "./PreviewCard";
import { BookmarkEditor } from "./BookmarkEditor";
import { useBookmarks } from "./useBookmarks";
import { isMarkerVisible } from "./markerClassifier";
import {
  bookmarkKey,
  getConversationId,
  setBookmark,
  deleteBookmark,
} from "../storage/bookmarks";
import { matchesKeybind } from "../shared/keybinds";
import { DESKTOP_MIN_WIDTH, HIGHLIGHT_DURATION_MS } from "../shared/constants";

interface Props {
  adapter: ChatSiteAdapter;
  settings: ChatMapSettings;
}

const TOP_GAP = 110; // px gap from viewport top after scroll

// find chatgpt's scroll container.
// current chatgpt uses [data-scroll-root] — confirmed via devtools (scrollHeight ~41k).
// fall back to largest-scroll-range ancestor for future dom changes.
function findScrollContainer(el: HTMLElement): HTMLElement | null {
  // current chatgpt dom
  const byAttr = document.querySelector<HTMLElement>("[data-scroll-root]");
  if (byAttr && byAttr.scrollHeight > byAttr.clientHeight + 4) return byAttr;

  // legacy: react-scroll-to-bottom first child
  const rtb = document.querySelector<HTMLElement>("[class*='react-scroll-to-bottom']");
  if (rtb) {
    for (const child of rtb.children) {
      if (child instanceof HTMLElement) {
        const s = getComputedStyle(child);
        if ((s.overflowY === "auto" || s.overflowY === "scroll") &&
            child.scrollHeight > child.clientHeight + 4) return child;
      }
    }
  }

  // fallback: collect all scrollable ancestors, pick the one with the largest range
  const candidates: HTMLElement[] = [];
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const s = getComputedStyle(node);
    if ((s.overflowY === "auto" || s.overflowY === "scroll") &&
        node.scrollHeight > node.clientHeight + 4) candidates.push(node);
    node = node.parentElement;
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    return candidates[0];
  }

  return null;
}

// compute the container scrollTop that places `el` at TOP_GAP from the container's top edge.
// uses rects relative to the container's current scroll position — accurate even when
// the offsetParent chain is broken by transforms/sticky/fixed ancestors.
function destScrollTop(el: HTMLElement, container: HTMLElement): number {
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  return container.scrollTop + (eRect.top - cRect.top) - TOP_GAP;
}

// rAF tween with per-frame target re-resolution and a follow-up correction
// phase. solves three problems chatgpt's lazy-loading conversation creates:
//
//   1. native scrollTo({behavior:"smooth"}) scales duration with distance —
//      a 10k px jump takes 5+ seconds and feels broken. we cap the tween at
//      a fixed duration regardless of distance.
//
//   2. lazy-load inserts content mid-flight and shifts the target. we
//      re-measure dest every frame, AND re-resolve the dom node every frame
//      (since react may rebuild the turn entirely, detaching the original
//      element). previous implementations bailed on detached elements; that
//      was the "click multiple times to get closer" bug.
//
//   3. lazy-load batches can arrive after the tween ends. a critically-
//      damped follow-up phase keeps gently snapping to dest for up to 1.5s
//      until we're stable for ~200ms, then exits.
//
// raw .scrollTop writes also tear the compositor (frame duplication bug),
// so every write goes through scrollTo({behavior:"instant"}).
const TWEEN_MS = 460;
const FOLLOWUP_MS = 1500;
const STABLE_FRAMES = 12;       // ~200ms at 60fps before we declare arrival
const CORRECTION_ALPHA = 0.28;  // fraction of remaining gap closed per frame
const ARRIVAL_TOLERANCE = 1.5;
const CANCEL_TOLERANCE = 3;     // px diff that distinguishes user scroll from our writes

function tweenContainerToMessage(
  container: HTMLElement,
  msg: ChatMessageRecord,
  reduced: boolean
) {
  const initial = resolveTarget(msg);
  if (!initial) return;

  const initialDest = Math.max(0, destScrollTop(initial, container));
  const initialDelta = Math.abs(container.scrollTop - initialDest);

  if (reduced || initialDelta < 8) {
    container.scrollTo({ top: initialDest, behavior: "instant" as ScrollBehavior });
    return;
  }

  const startScrollTop = container.scrollTop;
  const startTime = performance.now();
  let lastWritten = startScrollTop;
  let cancelled = false;
  let stableFrames = 0;
  let cachedTarget: HTMLElement | null = initial;

  const resolveCached = (): HTMLElement | null => {
    if (cachedTarget && document.contains(cachedTarget)) return cachedTarget;
    cachedTarget = resolveTarget(msg);
    return cachedTarget;
  };

  const onUserScroll = () => {
    if (Math.abs(container.scrollTop - lastWritten) > CANCEL_TOLERANCE) {
      cancelled = true;
    }
  };
  container.addEventListener("scroll", onUserScroll, { passive: true });
  const cleanup = () => container.removeEventListener("scroll", onUserScroll);

  const ease = (t: number) => 1 - Math.pow(1 - t, 3);

  const tick = (now: number) => {
    if (cancelled) { cleanup(); return; }

    const elapsed = now - startTime;
    const inTween = elapsed < TWEEN_MS;
    const inFollowup = elapsed < TWEEN_MS + FOLLOWUP_MS;

    const target = resolveCached();
    if (!target) {
      if (!inFollowup) { cleanup(); return; }
      requestAnimationFrame(tick);
      return;
    }

    const dest = Math.max(0, destScrollTop(target, container));
    let next: number;

    if (inTween) {
      const t = elapsed / TWEEN_MS;
      next = Math.round(startScrollTop + (dest - startScrollTop) * ease(t));
    } else if (inFollowup) {
      const delta = dest - container.scrollTop;
      if (Math.abs(delta) < ARRIVAL_TOLERANCE) {
        stableFrames++;
        if (stableFrames >= STABLE_FRAMES) { cleanup(); return; }
        requestAnimationFrame(tick);
        return;
      }
      stableFrames = 0;
      next = Math.round(container.scrollTop + delta * CORRECTION_ALPHA);
    } else {
      lastWritten = dest;
      container.scrollTo({ top: dest, behavior: "instant" as ScrollBehavior });
      cleanup();
      return;
    }

    lastWritten = next;
    container.scrollTo({ top: next, behavior: "instant" as ScrollBehavior });
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

// resolve the freshest live dom node for a message. tries (in order):
//   1. the stored element, if still attached
//   2. our stamped data-chatmap-id (cheap, may be stripped by react re-renders)
//   3. the adapter-supplied dom anchor (chatgpt's conversation-turn-N data-testid)
// returns null if nothing resolves — caller should bail rather than scroll wrong.
function resolveTarget(msg: ChatMessageRecord): HTMLElement | null {
  if (document.contains(msg.element)) return msg.element;

  const byId = document.querySelector<HTMLElement>(
    `[data-chatmap-id="${msg.id}"]`
  );
  if (byId) return byId;

  if (msg.domAnchor) {
    // escape attribute value just in case future anchors contain quotes
    const safe = msg.domAnchor.replace(/"/g, '\\"');
    const byAnchor = document.querySelector<HTMLElement>(
      `[data-testid="${safe}"]`
    );
    if (byAnchor) return byAnchor;
  }

  return null;
}

function scrollToMessage(msg: ChatMessageRecord, reduced: boolean) {
  const target = resolveTarget(msg);
  if (!target) return;

  const container = findScrollContainer(target);
  if (container) {
    tweenContainerToMessage(container, msg, reduced);
  } else {
    const eRect = target.getBoundingClientRect();
    window.scrollTo({
      top: Math.max(0, window.scrollY + eRect.top - TOP_GAP),
      behavior: reduced ? "instant" : "smooth",
    });
  }
}

// 14px per message, 80px min, 88% viewport max
function railHeight(count: number): number {
  const raw = Math.max(count, 6) * 14;
  return Math.min(raw, Math.round(window.innerHeight * 0.88));
}

export function Minimap({ adapter, settings }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const [editorIdx, setEditorIdx] = useState(-1);
  const [isDesktop, setIsDesktop] = useState(
    () => window.innerWidth >= DESKTOP_MIN_WIDTH
  );
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // last bookmark idx visited via keybind nav. lets us advance/retreat in
  // rail order even when the visible-extent active tracker has drifted to
  // a neighboring message (e.g. a long assistant turn right after a short
  // user turn). cleared on regular marker click so manual navigation
  // resets the anchor.
  const lastNavIdxRef = useRef<number | null>(null);
  const { messages, isStreaming, unreadIds, markRead, suppressRefresh } =
    useMessageIndex(adapter);
  const bookmarks = useBookmarks();
  const convId = useMemo(() => getConversationId(), [messages.length]);

  const visible = useMemo(
    () => messages.filter((m) => isMarkerVisible(m, settings)),
    [messages, settings]
  );

  // resolve a bookmark for a message (or undefined). cheap to call from
  // the render loop since the lookup is O(1).
  const bookmarkFor = useCallback(
    (msg: ChatMessageRecord): MessageBookmark | undefined => {
      const k = bookmarkKey(convId, msg.domAnchor);
      return k ? bookmarks[k] : undefined;
    },
    [bookmarks, convId]
  );

  // keep transient indices in range when the visible set shrinks
  useEffect(() => {
    if (hoverIdx >= visible.length) setHoverIdx(-1);
    if (editorIdx >= visible.length) setEditorIdx(-1);
  }, [visible.length, hoverIdx, editorIdx]);

  // desktop-only: hide minimap on narrow viewports
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= DESKTOP_MIN_WIDTH);
    window.addEventListener("resize", check, { passive: true });
    return () => window.removeEventListener("resize", check);
  }, []);

  // active tick tracks the message the user is actually looking at.
  // for each visible message, compute how much of it is on screen
  // (rect clamped to the viewport). the one with the greatest visible
  // extent wins — a long assistant turn dominating the viewport, a
  // short msg fully in view, etc. ties (within 1px) break toward the
  // lower message, which naturally lands on the bottom message when
  // several short ones all sit at the end of the conversation. no
  // bandaid edge cases — the same rule applies everywhere.
  useEffect(() => {
    if (visible.length === 0) {
      setActiveIdx(-1);
      return;
    }

    const firstLive = resolveTarget(visible[0]);
    const container = firstLive ? findScrollContainer(firstLive) : null;
    const scrollTarget: HTMLElement | Window = container ?? window;

    // score = visible extent + a large boost if the message's top edge
    // is sitting at the scroll-target reading position (TOP_GAP). that
    // way a message just scrolled to via click or keybind wins the
    // highlight even if the assistant turn right below it covers more
    // viewport area. for normal mid-conversation scrolling, no message
    // happens to sit exactly at TOP_GAP, so visible extent decides
    // unchanged.
    const READING_BOOST_WINDOW = 14; // px tolerance around TOP_GAP
    const READING_BOOST = 1e6;       // wins any reasonable extent comparison

    let raf = 0;
    const compute = () => {
      raf = 0;
      const vh = window.innerHeight;
      let active = -1;
      let bestScore = -1;
      let bestBottom = -Infinity;

      for (let i = 0; i < visible.length; i++) {
        const el = resolveTarget(visible[i]);
        if (!el || !document.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < vh) markRead(visible[i].id);

        const visTop = Math.max(0, r.top);
        const visBot = Math.min(vh, r.bottom);
        const extent = visBot - visTop;
        if (extent <= 0) continue;

        const atReadingLine =
          r.top > TOP_GAP - READING_BOOST_WINDOW &&
          r.top < TOP_GAP + READING_BOOST_WINDOW;
        const score = extent + (atReadingLine ? READING_BOOST : 0);

        const better =
          score > bestScore + 1 ||
          (Math.abs(score - bestScore) <= 1 && visBot > bestBottom);
        if (better) {
          bestScore = score;
          bestBottom = visBot;
          active = i;
        }
      }

      setActiveIdx(active);
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };

    compute();
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      scrollTarget.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [visible, markRead]);

  // raw scroll + highlight without any nav-state side effects. used by
  // both the regular marker click path and the keybind jump path.
  const performNavigate = useCallback(
    (msg: ChatMessageRecord) => {
      suppressRefresh(900);
      const target = resolveTarget(msg);
      if (!target) return;
      scrollToMessage(msg, settings.reducedMotion);
      target.classList.add("chatmap-highlight");
      setTimeout(
        () => target.classList.remove("chatmap-highlight"),
        HIGHLIGHT_DURATION_MS
      );
    },
    [suppressRefresh, settings.reducedMotion]
  );

  // marker click — same scroll but resets the keybind-nav anchor so the
  // next w/s starts from wherever the user actually clicked.
  const handleScrollTo = useCallback(
    (msg: ChatMessageRecord) => {
      lastNavIdxRef.current = null;
      performNavigate(msg);
    },
    [performNavigate]
  );

  // open the bookmark editor for a marker. invoked from Marker on
  // modifier-click (matched against settings.keybinds.editBookmark).
  const handleEditBookmark = useCallback((idx: number) => {
    setHoverIdx(-1);
    setEditorIdx(idx);
  }, []);

  // persist bookmark changes. drops the bookmark entirely if no fields
  // (color/name/note) were provided — empty bookmark = remove.
  const handleSaveBookmark = useCallback(
    async (msg: ChatMessageRecord, patch: MessageBookmark) => {
      const k = bookmarkKey(convId, msg.domAnchor);
      if (!k) {
        setEditorIdx(-1);
        return;
      }
      if (!patch.color && !patch.name && !patch.note) {
        await deleteBookmark(k);
      } else {
        await setBookmark(k, patch);
      }
      setEditorIdx(-1);
    },
    [convId]
  );

  const handleDeleteBookmark = useCallback(
    async (msg: ChatMessageRecord) => {
      const k = bookmarkKey(convId, msg.domAnchor);
      if (k) await deleteBookmark(k);
      setEditorIdx(-1);
    },
    [convId]
  );

  // alt+shift+w / alt+shift+s (or whatever the user configured) — jump
  // to the next or previous bookmarked message in rail order.
  //
  // anchor preference:
  //   1. lastNavIdxRef — the last bookmark we keybind-nav'd to. lets
  //      W/W/W cycle in order even when the visible-extent active tracker
  //      drifts to the message AFTER a short bookmark (which would
  //      otherwise cause a strict `>` lookup to skip the next bookmark
  //      because activeIdx already equals it).
  //   2. activeIdx — fresh start, no keybind yet.
  useEffect(() => {
    const { nextImportant, prevImportant } = settings.keybinds;

    const sorted = visible
      .map((msg, i) => (bookmarkFor(msg) ? i : -1))
      .filter((i) => i !== -1);

    if (sorted.length === 0) return;

    function jump(dir: 1 | -1) {
      // slot = position in `sorted` of the bookmark the user is "at"
      let slot: number;
      const lastIdx = lastNavIdxRef.current;
      if (lastIdx !== null && sorted.includes(lastIdx)) {
        slot = sorted.indexOf(lastIdx);
      } else {
        const anchor = activeIdx >= 0 ? activeIdx : -1;
        slot = -1;
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i] <= anchor) slot = i;
          else break;
        }
      }

      let nextSlot: number;
      if (dir > 0) {
        nextSlot = slot + 1 >= sorted.length ? 0 : slot + 1;
      } else {
        nextSlot = slot <= 0 ? sorted.length - 1 : slot - 1;
      }

      const targetIdx = sorted[nextSlot];
      lastNavIdxRef.current = targetIdx;
      if (visible[targetIdx]) performNavigate(visible[targetIdx]);
    }

    function onKey(e: KeyboardEvent) {
      // ignore when typing in an input/textarea — don't steal user keystrokes
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      if (matchesKeybind(e, nextImportant)) {
        e.preventDefault();
        jump(1);
      } else if (matchesKeybind(e, prevImportant)) {
        e.preventDefault();
        jump(-1);
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, activeIdx, bookmarkFor, settings.keybinds, performNavigate]);

  if (!isDesktop) return null;

  function expand() {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    setExpanded(true);
  }

  function scheduleCollapse() {
    collapseTimer.current = setTimeout(() => setExpanded(false), 300);
  }

  // marker hover handlers — one preview at rail level, snaps text but
  // glides between marker positions
  function handleHoverStart(idx: number) {
    if (previewCloseTimer.current) clearTimeout(previewCloseTimer.current);
    setHoverIdx(idx);
  }

  function handleHoverEnd() {
    // tiny grace so moving across the gap between markers doesn't flicker
    previewCloseTimer.current = setTimeout(() => setHoverIdx(-1), 120);
  }

  function keepPreviewOpen() {
    if (previewCloseTimer.current) clearTimeout(previewCloseTimer.current);
  }

  function goUp() {
    const prev = activeIdx <= 0 ? visible.length - 1 : activeIdx - 1;
    if (visible[prev]) handleScrollTo(visible[prev]);
  }

  function goDown() {
    const next =
      activeIdx < 0 || activeIdx >= visible.length - 1 ? 0 : activeIdx + 1;
    if (visible[next]) handleScrollTo(visible[next]);
  }

  const height = railHeight(visible.length);
  const lastAssistantIdx = (() => {
    for (let i = visible.length - 1; i >= 0; i--) {
      if (visible[i].role === "assistant") return i;
    }
    return -1;
  })();

  return (
    <div
      className={`rail${expanded ? " rail--expanded" : ""}`}
      style={{ height: `${height}px` }}
      onMouseEnter={expand}
      onMouseLeave={scheduleCollapse}
      aria-label="conversation minimap"
      role="navigation"
    >
      <button
        className={`rail-arrow${expanded ? " rail-arrow--visible" : ""}`}
        onClick={goUp}
        aria-label="previous message"
      >
        ▲
      </button>

      <div className="rail-track">
        {visible.map((msg, i) => {
          const topPercent =
            visible.length <= 1
              ? 50
              : (i / (visible.length - 1)) * 92 + 4;
          const globalIdx = messages.indexOf(msg);
          const isActive = i === activeIdx;
          const isStreamingTick =
            isStreaming && i === lastAssistantIdx && msg.role === "assistant";

          return (
            <Marker
              key={msg.id}
              msg={msg}
              index={globalIdx}
              topPercent={topPercent}
              settings={settings}
              active={isActive}
              expanded={expanded}
              streaming={isStreamingTick}
              unread={unreadIds.has(msg.id)}
              bookmark={bookmarkFor(msg)}
              onScrollTo={handleScrollTo}
              onEditBookmark={handleEditBookmark}
              onHoverStart={handleHoverStart}
              onHoverEnd={handleHoverEnd}
              hoverIdx={i}
            />
          );
        })}

        {hoverIdx !== -1 && visible[hoverIdx] && editorIdx === -1 && (
          <div
            className="rail-preview"
            style={{
              top: `${
                visible.length <= 1
                  ? 50
                  : (hoverIdx / (visible.length - 1)) * 92 + 4
              }%`,
            }}
            onMouseEnter={keepPreviewOpen}
            onMouseLeave={handleHoverEnd}
          >
            <PreviewCard
              msg={visible[hoverIdx]}
              index={messages.indexOf(visible[hoverIdx])}
              total={messages.length}
              bookmark={bookmarkFor(visible[hoverIdx])}
            />
          </div>
        )}

        {editorIdx !== -1 && visible[editorIdx] && (
          <BookmarkEditor
            msg={visible[editorIdx]}
            existing={bookmarkFor(visible[editorIdx])}
            topPercent={
              visible.length <= 1
                ? 50
                : (editorIdx / (visible.length - 1)) * 92 + 4
            }
            onSave={(patch) => handleSaveBookmark(visible[editorIdx], patch)}
            onDelete={() => handleDeleteBookmark(visible[editorIdx])}
            onClose={() => setEditorIdx(-1)}
          />
        )}
      </div>

      <button
        className={`rail-arrow${expanded ? " rail-arrow--visible" : ""}`}
        onClick={goDown}
        aria-label="next message"
      >
        ▼
      </button>
    </div>
  );
}
