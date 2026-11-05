import { describe, it, expect } from "vitest";
import {
  getConversationId,
  bookmarkKey,
  legacyBookmarkKey,
} from "../storage/bookmarks";

const CONV = "68f1a2b3-4c5d-6e7f-8a9b-0c1d2e3f4a5b";

function at(path: string) {
  history.replaceState(null, "", path);
}

describe("getConversationId", () => {
  it("reads a plain conversation url", () => {
    at(`/c/${CONV}`);
    expect(getConversationId()).toBe(CONV);
  });

  it("reads a conversation nested in a project", () => {
    at(`/g/g-p-6708aa1f2c3d4e5f/c/${CONV}`);
    expect(getConversationId()).toBe(CONV);
  });

  it("reads a conversation nested in a custom gpt", () => {
    at(`/g/g-2fkFE8rbu/c/${CONV}`);
    expect(getConversationId()).toBe(CONV);
  });

  it("ignores query and hash", () => {
    at(`/c/${CONV}?model=gpt-5#top`);
    expect(getConversationId()).toBe(CONV);
  });

  it("returns null on a new chat with no id", () => {
    at("/");
    expect(getConversationId()).toBeNull();
  });

  it("returns null on a project overview page", () => {
    at("/g/g-p-6708aa1f2c3d4e5f/project");
    expect(getConversationId()).toBeNull();
  });

  it("does not match /c/ deeper in the path", () => {
    at("/some/other/c/thing");
    expect(getConversationId()).toBeNull();
  });

  // the same chat keeps its key when moved into a project, so bookmarks
  // saved before the move still resolve after it.
  it("yields the same id inside and outside a project", () => {
    at(`/c/${CONV}`);
    const plain = getConversationId();
    at(`/g/g-p-6708aa1f2c3d4e5f/c/${CONV}`);
    expect(getConversationId()).toBe(plain);
  });
});

describe("bookmarkKey", () => {
  it("prefers the chatgpt msg uuid over the dom anchor", () => {
    expect(bookmarkKey(CONV, "fallback-turn-4:2:assistant", "msg-uuid")).toBe(
      `${CONV}|msg-uuid`
    );
  });

  it("falls back to the dom anchor", () => {
    expect(bookmarkKey(CONV, "fallback-turn-4:2:assistant")).toBe(
      `${CONV}|fallback-turn-4:2:assistant`
    );
  });

  it("returns null without a conversation id", () => {
    expect(bookmarkKey(null, "fallback-turn-4:2:assistant", "msg-uuid")).toBeNull();
  });

  it("returns null without any anchor", () => {
    expect(bookmarkKey(CONV, undefined)).toBeNull();
  });
});

describe("legacyBookmarkKey", () => {
  it("keys on the dom anchor alone", () => {
    expect(legacyBookmarkKey(CONV, "conversation-turn-4")).toBe(
      `${CONV}|conversation-turn-4`
    );
  });

  it("returns null without a conversation id", () => {
    expect(legacyBookmarkKey(null, "conversation-turn-4")).toBeNull();
  });
});
