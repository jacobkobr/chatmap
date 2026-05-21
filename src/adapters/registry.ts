import type { ChatSiteAdapter } from "./types";

const adapters: ChatSiteAdapter[] = [];

export function registerAdapter(adapter: ChatSiteAdapter): void {
  adapters.push(adapter);
}

export function getActiveAdapter(): ChatSiteAdapter | null {
  return adapters.find((a) => a.matchesLocation(window.location)) ?? null;
}
