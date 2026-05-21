import type { ThreadMapBookmark } from "../shared/types";

const STORAGE_KEY = "threadmap_bookmarks";

export async function loadBookmarks(): Promise<ThreadMapBookmark[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      resolve((result[STORAGE_KEY] as ThreadMapBookmark[]) ?? []);
    });
  });
}

export async function saveBookmark(bookmark: ThreadMapBookmark): Promise<void> {
  const existing = await loadBookmarks();
  await new Promise<void>((resolve) => {
    chrome.storage.local.set(
      { [STORAGE_KEY]: [...existing, bookmark] },
      resolve
    );
  });
}

export async function removeBookmark(id: string): Promise<void> {
  const existing = await loadBookmarks();
  await new Promise<void>((resolve) => {
    chrome.storage.local.set(
      { [STORAGE_KEY]: existing.filter((b) => b.id !== id) },
      resolve
    );
  });
}
