import type { CachedMarker, ConvCache } from "../shared/types";
import { MARKER_CACHE_STORAGE_KEY } from "../shared/constants";

type CacheMap = Record<string, ConvCache>;

// load the cache entry for a single conversation. returns null when nothing
// has been stored for it yet — caller treats that as a fresh chat.
export async function loadCache(convId: string): Promise<ConvCache | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(MARKER_CACHE_STORAGE_KEY, (result) => {
      const all = (result[MARKER_CACHE_STORAGE_KEY] as CacheMap) ?? {};
      resolve(all[convId] ?? null);
    });
  });
}

// merge-patch a conversation's cache entry. always bumps lastUpdated. unset
// fields fall back to defaults so a partial patch never wipes existing data.
export async function saveCache(
  convId: string,
  patch: Partial<ConvCache>
): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(MARKER_CACHE_STORAGE_KEY, (result) => {
      const all = (result[MARKER_CACHE_STORAGE_KEY] as CacheMap) ?? {};
      const prev = all[convId] ?? {
        markers: [],
        lastUpdated: 0,
        fullyScanned: false,
        offerDismissed: false,
      };
      all[convId] = {
        ...prev,
        ...patch,
        lastUpdated: Date.now(),
      };
      chrome.storage.local.set({ [MARKER_CACHE_STORAGE_KEY]: all }, () =>
        resolve()
      );
    });
  });
}

// convenience: project a list of records into the storage shape. records
// need either a domAnchor (conversation-turn-N) or a chatgptMsgId so they
// can be re-resolved when the dom mounts later — drop ones with neither.
export function projectMarkers(
  records: {
    id: string;
    role: CachedMarker["role"];
    textPreview: string;
    fullTextLength: number;
    features: CachedMarker["features"];
    domAnchor?: string;
    chatgptMsgId?: string;
    order?: number;
  }[]
): CachedMarker[] {
  return records
    .filter((r) => !!r.domAnchor || !!r.chatgptMsgId)
    .map((r) => ({
      id: r.id,
      role: r.role,
      textPreview: r.textPreview,
      fullTextLength: r.fullTextLength,
      features: r.features,
      domAnchor: r.domAnchor ?? "",
      chatgptMsgId: r.chatgptMsgId,
      order: r.order ?? 0,
    }));
}
