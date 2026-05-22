import type { ChatMessageRecord, ThreadMapSettings } from "../shared/types";
import { MIN_RESPONSE_LENGTH } from "../shared/constants";

// determines whether a message should render a marker given current settings
export function isMarkerVisible(
  msg: ChatMessageRecord,
  settings: ThreadMapSettings
): boolean {
  // unknown role = tool call, system message, or unresolvable — never show
  if (msg.role === "unknown") return false;
  // gate out near-empty assistant responses (typing artifacts, etc.)
  if (msg.role === "assistant" && msg.fullTextLength < MIN_RESPONSE_LENGTH) return false;
  if (msg.role === "user" && !settings.showUserMessages) return false;
  if (msg.role === "assistant" && !settings.showAssistantMessages) return false;
  return true;
}

// maps features to badge labels shown in preview card
export function featureLabels(msg: ChatMessageRecord): string[] {
  const labels: string[] = [];
  if (msg.features.includes("code")) labels.push("code");
  if (msg.features.includes("link") || msg.features.includes("source")) labels.push("link");
  if (msg.features.includes("image") || msg.features.includes("attachment")) labels.push("image");
  if (msg.features.includes("long-answer")) labels.push("long");
  return labels;
}

// css class suffix for marker color based on role + features
export function markerVariant(msg: ChatMessageRecord): string {
  if (msg.role === "unknown") return "unknown";
  if (msg.role === "user") return "user";
  if (msg.features.includes("code")) return "code";
  if (msg.features.includes("long-answer")) return "long";
  if (msg.features.includes("link") || msg.features.includes("source")) return "link";
  return "assistant";
}
