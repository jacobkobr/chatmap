import type { BookmarkMap, ChatMapSettings } from "../shared/types";
import {
  bookmarkKey,
  legacyBookmarkKey,
  getConversationId,
  setBookmark,
  deleteBookmark,
  loadBookmarks,
  onBookmarksChanged,
} from "../storage/bookmarks";

// chatgpt renders a per-message action row (`.turn-action-controls`) that
// holds the native copy / like / share / regenerate buttons. we tag along
// at the end of that row with a bookmark star so the user can mark a
// message in-place, without rolling the cursor over to the minimap rail.

const ROW_SELECTOR = ".turn-action-controls";
const UNIT_KEY = "data-chatgpt-search-unit-key";
const BTN_FLAG = "data-chatmap-bookmark-btn";
const BTN_ATTR_SELECTOR = `[${BTN_FLAG}]`;

// mirrors chatgpt's own small action-row buttons so our star inherits
// their hover state, focus ring and hit area without us shipping any css.
// only the aria-label and inline svg colour differ. `shrink-0` is important
// on assistant rows — those use `flex-wrap` + `max-w-(--thread-content-max-width)`
// and third-party action-row extensions (Convert to PDF, etc.) fill the
// width, so without shrink-0 our star can collapse to 0 or wrap below.
const BTN_CLASS =
  "no-drag cursor-interaction items-center select-none shrink-0 " +
  "focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 " +
  "whitespace-nowrap flex border gap-1 rounded-full electron:rounded-md " +
  "text-tertiary not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover " +
  "border-transparent electron:p-1 flex items-center justify-center p-0.5";

// lucide `star` (MIT). inlined because the content script runs inside
// chatgpt's own dom — pulling react/an icon lib for one glyph would be
// overkill, and the svg classes chatgpt expects (`icon-xs`, etc.) already
// exist in its stylesheet; our raw svg just rides those.
function starSvg(filled: boolean, color: string): string {
  const fill = filled ? color : "none";
  const stroke = filled ? color : "currentColor";
  return (
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="${fill}" ` +
    `stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false">` +
    `<polygon points="12 2 15.09 8.26 22 9.27 16.18 14.14 17.82 21.02 12 17.77 6.18 21.02 7.82 14.14 2 9.27 8.91 8.26 12 2"/>` +
    `</svg>`
  );
}

interface Anchors {
  chatgptMsgId?: string;
  domAnchor?: string;
}

function anchorsFromWrapper(wrapper: HTMLElement): Anchors {
  const idsAttr = wrapper.getAttribute("data-chatgpt-search-message-ids");
  const firstId = idsAttr?.split(/\s+/).find((s) => s.length > 0);
  const dilInner = wrapper
    .querySelector<HTMLElement>("[data-dil-message-id]")
    ?.getAttribute("data-dil-message-id");
  return {
    chatgptMsgId: firstId ?? dilInner ?? undefined,
    domAnchor: wrapper.getAttribute(UNIT_KEY) ?? undefined,
  };
}

function anchorsFromLegacy(legacy: HTMLElement): Anchors {
  const inner = legacy
    .querySelector<HTMLElement>("[data-message-author-role]")
    ?.getAttribute("data-message-id");
  return {
    chatgptMsgId: inner ?? undefined,
    domAnchor: legacy.getAttribute("data-testid") ?? undefined,
  };
}

// walk from an action row to the wrapper that carries the message id. uses
// the same attribute order as the rail's `resolveTarget` so the two paths
// stay in sync — rail-dropped bookmarks and star-dropped bookmarks address
// the same storage key.
//
// chatgpt renders assistant action rows as a *sibling* of the message body
// (both children of a common turn container), so `row.closest(UNIT_KEY)`
// returns null for them. the fallback walks each ancestor's prior siblings
// looking for the nearest preceding search-unit wrapper — that's the
// message this row belongs to.
function resolveAnchors(row: HTMLElement): Anchors | null {
  // 1. ancestor (user action rows live inside the user message wrapper)
  const direct = row.closest<HTMLElement>(`[${UNIT_KEY}]`);
  if (direct) return anchorsFromWrapper(direct);

  // 2. preceding-sibling search (assistant rows: body + action row are
  //    sibling children of the same turn container; the body carries the
  //    search-unit-key, the action row doesn't).
  let node: Element | null = row;
  while (node && node.parentElement) {
    for (
      let sib: Element | null = node.previousElementSibling;
      sib;
      sib = sib.previousElementSibling
    ) {
      if (sib instanceof HTMLElement && sib.hasAttribute(UNIT_KEY)) {
        return anchorsFromWrapper(sib);
      }
      const nested = sib.querySelectorAll<HTMLElement>(`[${UNIT_KEY}]`);
      if (nested.length > 0) {
        return anchorsFromWrapper(nested[nested.length - 1]);
      }
    }
    node = node.parentElement;
  }

  // 3. legacy pre-rewrite dom
  const legacy = row.closest<HTMLElement>("[data-testid^='conversation-turn-']");
  if (legacy) return anchorsFromLegacy(legacy);

  return null;
}

export interface BookmarkButtonsHandle {
  stop: () => void;
  updateSettings: (s: ChatMapSettings) => void;
}

export function startBookmarkButtons(
  initial: ChatMapSettings
): BookmarkButtonsHandle {
  let settings = initial;
  let bookmarks: BookmarkMap = {};

  const lookup = (
    anchors: Anchors
  ): { marked: boolean; color: string } => {
    const convId = getConversationId();
    const k = bookmarkKey(convId, anchors.domAnchor, anchors.chatgptMsgId);
    const legacy = legacyBookmarkKey(convId, anchors.domAnchor);
    const bm =
      (k && bookmarks[k]) || (legacy && bookmarks[legacy]) || undefined;
    if (bm) {
      return { marked: true, color: bm.color ?? settings.quickBookmarkColor };
    }
    return { marked: false, color: settings.quickBookmarkColor };
  };

  const renderButton = (btn: HTMLButtonElement) => {
    const raw = btn.dataset.chatmapAnchors;
    if (!raw) return;
    const anchors = JSON.parse(raw) as Anchors;
    const { marked, color } = lookup(anchors);
    btn.innerHTML = starSvg(marked, color);
    btn.setAttribute("aria-pressed", marked ? "true" : "false");
    btn.title = marked
      ? "Remove bookmark (chatmap)"
      : "Bookmark message (chatmap)";
  };

  const refreshAll = () => {
    document
      .querySelectorAll<HTMLButtonElement>(BTN_ATTR_SELECTOR)
      .forEach(renderButton);
  };

  const onToggle = async (btn: HTMLButtonElement) => {
    const raw = btn.dataset.chatmapAnchors;
    if (!raw) return;
    const anchors = JSON.parse(raw) as Anchors;
    const convId = getConversationId();
    const k = bookmarkKey(convId, anchors.domAnchor, anchors.chatgptMsgId);
    const legacy = legacyBookmarkKey(convId, anchors.domAnchor);
    if (!k) return;
    const existing =
      bookmarks[k] ?? (legacy ? bookmarks[legacy] : undefined);
    try {
      if (existing) {
        await deleteBookmark(k);
        if (legacy && legacy !== k) await deleteBookmark(legacy);
      } else {
        await setBookmark(k, {
          color: settings.quickBookmarkColor,
          createdAt: Date.now(),
        });
      }
    } catch (_) {
      // extension context invalidated — the rail polls the same signal and
      // surfaces the reload notice, so no need to double-warn here.
    }
  };

  const makeButton = (row: HTMLElement): HTMLButtonElement | null => {
    const anchors = resolveAnchors(row);
    if (!anchors || (!anchors.chatgptMsgId && !anchors.domAnchor)) return null;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.setAttribute(BTN_FLAG, "true");
    btn.setAttribute("aria-label", "Bookmark message");
    btn.dataset.chatmapAnchors = JSON.stringify(anchors);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void onToggle(btn);
    });
    renderButton(btn);
    return btn;
  };

  const inject = () => {
    document.querySelectorAll<HTMLElement>(ROW_SELECTOR).forEach((row) => {
      if (row.querySelector(BTN_ATTR_SELECTOR)) return;
      const btn = makeButton(row);
      if (!btn) return;
      row.appendChild(btn);
    });
  };

  // chatgpt's streaming + virtualization fires a lot of mutations per
  // second; coalesce into one inject pass per frame so we never ship a
  // visible flicker and never queue dozens of selector walks.
  let rafPending = false;
  const schedule = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      inject();
    });
  };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true, subtree: true });

  const unsubBookmarks = onBookmarksChanged((map) => {
    bookmarks = map;
    refreshAll();
  });

  loadBookmarks().then((map) => {
    bookmarks = map;
    inject();
    refreshAll();
  });

  inject();

  return {
    stop: () => {
      mo.disconnect();
      try {
        unsubBookmarks();
      } catch (_) {
        /* storage listener was already torn down */
      }
      document
        .querySelectorAll(BTN_ATTR_SELECTOR)
        .forEach((el) => el.remove());
    },
    updateSettings: (s) => {
      settings = s;
      refreshAll();
    },
  };
}
