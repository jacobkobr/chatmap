import type { BookmarkMap, MessageBookmark } from "../shared/types";
import { BOOKMARKS_STORAGE_KEY } from "../shared/constants";

// extract the chatgpt conversation id from the current url. used as part
// of the bookmark key so two different chats can have bookmarks on the
// same turn number without colliding. returns null on a fresh chat that
// hasn't been assigned an id yet.
export function getConversationId(): string | null {
  const m = location.pathname.match(/^\/c\/([^\/]+)/);
  return m ? m[1] : null;
}

// stable address for a bookmark. prefers the chatgpt msg uuid (canonical,
// returned by the api and survives any turn renumbering); falls back to
// the dom anchor (conversation-turn-N) when the msg uuid isn't known.
// returns null when convId and both anchors are missing — that's a brand
// new chat with no addressable turn yet.
export function bookmarkKey(
  convId: string | null,
  domAnchor: string | undefined,
  chatgptMsgId?: string
): string | null {
  if (!convId) return null;
  const anchor = chatgptMsgId || domAnchor;
  if (!anchor) return null;
  return `${convId}|${anchor}`;
}

// legacy lookup key for bookmarks that were saved before the msg-uuid
// preference landed. checked as a fallback in the rail's bookmark lookup
// so older marks keyed by conversation-turn-N still resolve.
export function legacyBookmarkKey(
  convId: string | null,
  domAnchor: string | undefined
): string | null {
  if (!convId || !domAnchor) return null;
  return `${convId}|${domAnchor}`;
}

export async function loadBookmarks(): Promise<BookmarkMap> {
  return new Promise((resolve) => {
    chrome.storage.local.get(BOOKMARKS_STORAGE_KEY, (result) => {
      resolve((result[BOOKMARKS_STORAGE_KEY] as BookmarkMap) ?? {});
    });
  });
}

export async function setBookmark(
  key: string,
  bookmark: MessageBookmark
): Promise<void> {
  const all = await loadBookmarks();
  all[key] = bookmark;
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [BOOKMARKS_STORAGE_KEY]: all }, () => resolve());
  });
}

export async function deleteBookmark(key: string): Promise<void> {
  const all = await loadBookmarks();
  if (!(key in all)) return;
  delete all[key];
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [BOOKMARKS_STORAGE_KEY]: all }, () => resolve());
  });
}

// subscribe to bookmark changes from any source (popup, other tabs, etc).
// returns an unsubscribe function.
export function onBookmarksChanged(cb: (map: BookmarkMap) => void): () => void {
  const handler = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string
  ) => {
    if (area !== "local") return;
    if (!(BOOKMARKS_STORAGE_KEY in changes)) return;
    cb((changes[BOOKMARKS_STORAGE_KEY].newValue as BookmarkMap) ?? {});
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
