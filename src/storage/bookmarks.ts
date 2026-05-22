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

// stable address for a bookmark: conv id + the adapter's dom anchor
// (chatgpt: conversation-turn-N). returns null if either is missing.
export function bookmarkKey(
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
