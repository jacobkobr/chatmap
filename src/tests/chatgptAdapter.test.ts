import { describe, it, expect, beforeEach } from "vitest";
import chatgptAdapter from "../adapters/chatgpt";

describe("chatgptAdapter.matchesLocation", () => {
  function fakeLocation(hostname: string): Location {
    return { hostname } as Location;
  }

  it("matches chatgpt.com", () => {
    expect(chatgptAdapter.matchesLocation(fakeLocation("chatgpt.com"))).toBe(true);
  });

  it("matches chat.openai.com", () => {
    expect(chatgptAdapter.matchesLocation(fakeLocation("chat.openai.com"))).toBe(true);
  });

  it("does not match other domains", () => {
    expect(chatgptAdapter.matchesLocation(fakeLocation("example.com"))).toBe(false);
  });
});

describe("chatgptAdapter.getMessageFeatures", () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement("div");
  });

  it("detects code blocks", () => {
    el.innerHTML = "<pre><code>const x = 1;</code></pre>";
    expect(chatgptAdapter.getMessageFeatures(el, "")).toContain("code");
  });

  it("detects links", () => {
    el.innerHTML = '<a href="https://example.com">link</a>';
    expect(chatgptAdapter.getMessageFeatures(el, "")).toContain("link");
  });

  it("detects images", () => {
    el.innerHTML = "<img src='x.png' />";
    expect(chatgptAdapter.getMessageFeatures(el, "")).toContain("image");
  });

  it("detects long answers", () => {
    const longText = "a".repeat(2000);
    expect(chatgptAdapter.getMessageFeatures(el, longText)).toContain("long-answer");
  });

  it("returns empty for plain text", () => {
    expect(chatgptAdapter.getMessageFeatures(el, "short")).toEqual([]);
  });
});

describe("chatgptAdapter.getMessageRole", () => {
  it("reads data-message-author-role=user", () => {
    const el = document.createElement("div");
    el.setAttribute("data-message-author-role", "user");
    expect(chatgptAdapter.getMessageRole(el)).toBe("user");
  });

  it("reads data-message-author-role=assistant", () => {
    const el = document.createElement("div");
    el.setAttribute("data-message-author-role", "assistant");
    expect(chatgptAdapter.getMessageRole(el)).toBe("assistant");
  });

  it("falls back to child attribute", () => {
    const el = document.createElement("div");
    const child = document.createElement("span");
    child.setAttribute("data-message-author-role", "user");
    el.appendChild(child);
    expect(chatgptAdapter.getMessageRole(el)).toBe("user");
  });
});
