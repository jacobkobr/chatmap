import { describe, it, expect } from "vitest";
import { markerVariant, featureLabels, isMarkerVisible } from "../minimap/markerClassifier";
import type { ChatMessageRecord, ThreadMapSettings } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/constants";

function makeMsg(overrides: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: "test-1",
    role: "assistant",
    element: document.createElement("div"),
    textPreview: "Hello, how can I help you today?",
    fullTextLength: 32,
    features: [],
    top: 0,
    height: 100,
    ...overrides,
  };
}

describe("markerVariant", () => {
  it("user messages get user variant", () => {
    expect(markerVariant(makeMsg({ role: "user" }))).toBe("user");
  });

  it("code feature takes priority over assistant", () => {
    expect(markerVariant(makeMsg({ features: ["code"] }))).toBe("code");
  });

  it("long-answer comes after code", () => {
    expect(markerVariant(makeMsg({ features: ["long-answer"] }))).toBe("long");
  });

  it("plain assistant defaults to assistant", () => {
    expect(markerVariant(makeMsg({}))).toBe("assistant");
  });
});

describe("featureLabels", () => {
  it("returns code label when feature present", () => {
    expect(featureLabels(makeMsg({ features: ["code"] }))).toContain("code");
  });

  it("returns link for source feature", () => {
    expect(featureLabels(makeMsg({ features: ["source"] }))).toContain("link");
  });

  it("returns image for attachment", () => {
    expect(featureLabels(makeMsg({ features: ["attachment"] }))).toContain("image");
  });

  it("returns empty for plain assistant", () => {
    expect(featureLabels(makeMsg({}))).toEqual([]);
  });
});

describe("isMarkerVisible", () => {
  const settings: ThreadMapSettings = { ...DEFAULT_SETTINGS };

  it("hides user messages when showUserMessages is false", () => {
    const s = { ...settings, showUserMessages: false };
    expect(isMarkerVisible(makeMsg({ role: "user" }), s)).toBe(false);
  });

  it("hides assistant messages when showAssistantMessages is false", () => {
    const s = { ...settings, showAssistantMessages: false };
    expect(isMarkerVisible(makeMsg({ role: "assistant" }), s)).toBe(false);
  });

  it("shows by default", () => {
    expect(isMarkerVisible(makeMsg({ role: "user" }), settings)).toBe(true);
    expect(isMarkerVisible(makeMsg({ role: "assistant" }), settings)).toBe(true);
  });
});
