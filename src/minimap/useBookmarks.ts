import { useEffect, useState } from "react";
import type { BookmarkMap } from "../shared/types";
import { loadBookmarks, onBookmarksChanged } from "../storage/bookmarks";

// reactive bookmark map. updates whenever bookmarks change in this tab or
// any other tab (chrome.storage.onChanged fires across tabs).
export function useBookmarks(): BookmarkMap {
  const [map, setMap] = useState<BookmarkMap>({});

  useEffect(() => {
    loadBookmarks().then(setMap);
    return onBookmarksChanged(setMap);
  }, []);

  return map;
}
