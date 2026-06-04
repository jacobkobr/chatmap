import type {
  BookmarkMap,
  CachedMarker,
  ConvCache,
  MessageBookmark,
} from "../shared/types";

export type ExportFormat = "markdown" | "html" | "json" | "pdf";
// "bookmarks" — only chats with bookmarks, only the bookmarked messages.
// "chats"     — every cached chat, every cached message. bookmarks attach
//               as metadata on the messages where present.
export type ExportScope = "bookmarks" | "chats";

export interface ExportOptions {
  format: ExportFormat;
  includeLink: boolean;
  // barebones strips titles, notes, colors, dates, conversation headers —
  // emits only "<role>: <text>" lines. designed for pasting raw context into
  // another chat without any export-format noise.
  barebones: boolean;
}

function roleLabel(role: string): string {
  if (role === "user") return "You";
  if (role === "assistant") return "ChatGPT";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// one bookmarked message, fully denormalized for export. textPreview comes
// from the cached marker; full body text isn't stored across sessions, so
// only the currently-open chat can supply more. when no cached marker is
// found at all we still emit the bookmark so the user can see what they
// saved even if the rest is lost (chat deleted, etc.).
export interface ExportBookmark {
  key: string;
  name: string;
  note: string;
  color: string;
  createdAt: number;
  role: string;
  text: string;
  // chatgpt's order index — used for stable sort within a conversation.
  order: number;
}

export interface ExportGroup {
  convId: string;
  // human-facing label for the group header. derived from first bookmark
  // name, then first cached marker preview, then the convId hash.
  label: string;
  link: string;
  bookmarks: ExportBookmark[];
}

// build the grouped, sorted export payload from raw storage shapes.
export function gatherExportData(
  bookmarks: BookmarkMap,
  caches: Record<string, ConvCache>,
  // optional override map: convId -> markerKey -> full text. populated by
  // the content script for the currently-open conversation, where the
  // live dom has the full message text the cache doesn't store.
  liveText?: Record<string, Record<string, string>>
): ExportGroup[] {
  // bucket bookmarks by convId. key shape is `${convId}|${anchor}`.
  const byConv = new Map<string, Array<[string, MessageBookmark]>>();
  for (const [k, bm] of Object.entries(bookmarks)) {
    const sep = k.indexOf("|");
    if (sep <= 0) continue;
    const convId = k.slice(0, sep);
    if (!byConv.has(convId)) byConv.set(convId, []);
    byConv.get(convId)!.push([k, bm]);
  }

  const groups: ExportGroup[] = [];
  for (const [convId, list] of byConv.entries()) {
    const cache = caches[convId];
    const markers = cache?.markers ?? [];
    const markerByAnchor = new Map<string, CachedMarker>();
    for (const m of markers) {
      if (m.domAnchor) markerByAnchor.set(m.domAnchor, m);
      if (m.chatgptMsgId) markerByAnchor.set(m.chatgptMsgId, m);
    }

    const items: ExportBookmark[] = list.map(([k, bm]) => {
      const anchor = k.slice(convId.length + 1);
      const marker = markerByAnchor.get(anchor);
      const live = liveText?.[convId]?.[k];
      return {
        key: k,
        name: bm.name ?? "",
        note: bm.note ?? "",
        color: bm.color ?? "",
        createdAt: bm.createdAt,
        role: marker?.role ?? "unknown",
        text: live || marker?.textPreview || "",
        order: marker?.order ?? 0,
      };
    });

    items.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);

    // pick a sensible label: first named bookmark, else first cached marker
    // preview, else a short slice of the conv id.
    let label = "";
    const firstNamed = items.find((i) => i.name);
    if (firstNamed) label = firstNamed.name;
    else if (markers[0]?.textPreview)
      label = markers[0].textPreview.slice(0, 60);
    else label = `conversation ${convId.slice(0, 8)}`;

    groups.push({
      convId,
      label,
      link: `https://chatgpt.com/c/${convId}`,
      bookmarks: items,
    });
  }

  // newest activity first so recent chats are at the top of the export.
  groups.sort((a, b) => {
    const aMax = a.bookmarks.reduce((m, x) => Math.max(m, x.createdAt), 0);
    const bMax = b.bookmarks.reduce((m, x) => Math.max(m, x.createdAt), 0);
    return bMax - aMax;
  });

  return groups;
}

// full-chat export — every cached message from every cached conversation.
// bookmark metadata (color/name/note) attaches to messages that happen to
// have one. label prefers the first bookmark's name, then the first
// message's preview. textPreview is the only thing the cache stores, so
// non-open chats render at preview length; the open chat gets full text
// via liveText.
export function gatherChatsData(
  bookmarks: BookmarkMap,
  caches: Record<string, ConvCache>,
  liveText?: Record<string, Record<string, string>>
): ExportGroup[] {
  const groups: ExportGroup[] = [];

  for (const [convId, cache] of Object.entries(caches)) {
    const markers = cache?.markers ?? [];
    if (markers.length === 0) continue;

    const items: ExportBookmark[] = markers.map((m) => {
      const anchorKey = m.chatgptMsgId
        ? `${convId}|${m.chatgptMsgId}`
        : m.domAnchor
          ? `${convId}|${m.domAnchor}`
          : "";
      const legacyKey = m.domAnchor ? `${convId}|${m.domAnchor}` : "";
      const bm =
        (anchorKey && bookmarks[anchorKey]) ||
        (legacyKey && bookmarks[legacyKey]) ||
        undefined;
      const liveByKey = liveText?.[convId] ?? {};
      const live = liveByKey[anchorKey] || liveByKey[legacyKey] || "";
      return {
        key: anchorKey || `${convId}|order-${m.order}`,
        name: bm?.name ?? "",
        note: bm?.note ?? "",
        color: bm?.color ?? "",
        createdAt: bm?.createdAt ?? cache.lastUpdated ?? 0,
        role: m.role ?? "unknown",
        text: live || m.textPreview || "",
        order: m.order ?? 0,
      };
    });

    items.sort((a, b) => a.order - b.order);

    let label = "";
    const firstNamed = items.find((i) => i.name);
    if (firstNamed) label = firstNamed.name;
    else if (markers[0]?.textPreview)
      label = markers[0].textPreview.slice(0, 60);
    else label = `conversation ${convId.slice(0, 8)}`;

    groups.push({
      convId,
      label,
      link: `https://chatgpt.com/c/${convId}`,
      bookmarks: items,
    });
  }

  groups.sort((a, b) => (caches[b.convId]?.lastUpdated ?? 0) - (caches[a.convId]?.lastUpdated ?? 0));
  return groups;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// dom-derived text (via textContent) carries the layout's incidental newlines
// — sometimes 3-5 in a row between paragraphs, code blocks, lists. that
// renders as big visual gaps in the export. normalize: trim, collapse runs
// of blank lines to a single one, trim trailing space on each line.
function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

export function toMarkdown(
  groups: ExportGroup[],
  opts: ExportOptions
): string {
  if (opts.barebones) {
    const lines: string[] = [];
    for (const g of groups) {
      const items = g.bookmarks.filter((b) => b.text);
      if (items.length === 0) continue;
      if (opts.includeLink) {
        lines.push(g.link);
        lines.push("");
      }
      for (const b of items) {
        lines.push(`**${roleLabel(b.role)}:** ${cleanText(b.text)}`);
        lines.push("");
      }
    }
    return lines.join("\n").trimEnd() + "\n";
  }

  const lines: string[] = ["# Bookmarks export", ""];
  for (const g of groups) {
    lines.push(`## ${g.label}`);
    if (opts.includeLink) lines.push(`[Open conversation](${g.link})`);
    lines.push("");
    for (const b of g.bookmarks) {
      const title = b.name || `Bookmark (${b.role})`;
      lines.push(`### ${title}`);
      const meta: string[] = [];
      if (b.color) meta.push(`color: ${b.color}`);
      if (b.role) meta.push(`role: ${b.role}`);
      if (b.createdAt) meta.push(`saved: ${formatDate(b.createdAt)}`);
      if (meta.length) lines.push(`_${meta.join(" · ")}_`);
      if (b.note) {
        lines.push("");
        lines.push(`> ${cleanText(b.note).split("\n").join("\n> ")}`);
      }
      if (b.text) {
        lines.push("");
        lines.push(cleanText(b.text));
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function toJson(groups: ExportGroup[], opts: ExportOptions): string {
  if (opts.barebones) {
    if (opts.includeLink) {
      const conversations = groups
        .map((g) => ({
          link: g.link,
          messages: g.bookmarks
            .filter((b) => b.text)
            .map((b) => ({ role: b.role, text: cleanText(b.text) })),
        }))
        .filter((c) => c.messages.length > 0);
      return JSON.stringify({ conversations }, null, 2);
    }
    const messages: { role: string; text: string }[] = [];
    for (const g of groups) {
      for (const b of g.bookmarks) {
        if (!b.text) continue;
        messages.push({ role: b.role, text: cleanText(b.text) });
      }
    }
    return JSON.stringify({ messages }, null, 2);
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    conversations: groups.map((g) => ({
      convId: g.convId,
      label: g.label,
      link: opts.includeLink ? g.link : undefined,
      bookmarks: g.bookmarks.map((b) => ({
        name: b.name || undefined,
        note: b.note ? cleanText(b.note) : undefined,
        color: b.color || undefined,
        role: b.role,
        createdAt: b.createdAt,
        text: b.text ? cleanText(b.text) : undefined,
      })),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

// shared html body — also used as the print source for pdf export.
function renderHtmlBody(groups: ExportGroup[], opts: ExportOptions): string {
  if (opts.barebones) {
    const parts: string[] = [];
    for (const g of groups) {
      const items = g.bookmarks.filter((b) => b.text);
      if (items.length === 0) continue;
      if (opts.includeLink) {
        parts.push(
          `<p class="link"><a href="${escapeHtml(g.link)}">${escapeHtml(
            g.link
          )}</a></p>`
        );
      }
      for (const b of items) {
        const paragraphs = cleanText(b.text).split(/\n{2,}/);
        const body = paragraphs
          .map((p) => `<p class="body">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
          .join("");
        parts.push(
          `<article class="bm bm--barebones"><p class="role"><strong>${escapeHtml(
            roleLabel(b.role)
          )}:</strong></p>${body}</article>`
        );
      }
    }
    return parts.join("\n");
  }

  const parts: string[] = [];
  for (const g of groups) {
    parts.push(`<section class="conv">`);
    parts.push(`<h2>${escapeHtml(g.label)}</h2>`);
    if (opts.includeLink) {
      parts.push(
        `<p class="link"><a href="${escapeHtml(
          g.link
        )}">${escapeHtml(g.link)}</a></p>`
      );
    }
    for (const b of g.bookmarks) {
      const swatchStyle = b.color
        ? ` style="background:${escapeHtml(b.color)}"`
        : "";
      const title = b.name || `Bookmark (${b.role})`;
      parts.push(`<article class="bm">`);
      parts.push(
        `<h3><span class="swatch"${swatchStyle}></span>${escapeHtml(
          title
        )}</h3>`
      );
      const meta: string[] = [];
      if (b.role) meta.push(escapeHtml(b.role));
      if (b.createdAt) meta.push(formatDate(b.createdAt));
      if (meta.length)
        parts.push(`<p class="meta">${meta.join(" · ")}</p>`);
      if (b.note)
        parts.push(`<blockquote>${escapeHtml(cleanText(b.note))}</blockquote>`);
      if (b.text) {
        // split on blank lines so paragraph spacing is css-controlled (every
        // gap is identical) rather than dictated by however many newlines
        // chatgpt's dom happens to emit. single newlines inside a paragraph
        // become <br>.
        const paragraphs = cleanText(b.text).split(/\n{2,}/);
        for (const p of paragraphs) {
          const safe = escapeHtml(p).replace(/\n/g, "<br>");
          parts.push(`<p class="body">${safe}</p>`);
        }
      }
      parts.push(`</article>`);
    }
    parts.push(`</section>`);
  }
  return parts.join("\n");
}

const HTML_STYLES = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  font: 15px/1.55 -apple-system, "Segoe UI", system-ui, sans-serif;
  max-width: 760px;
  margin: 40px auto;
  padding: 0 24px;
  color: #1f2937;
  background: #fafafa;
}
h1 { font-size: 24px; margin: 0 0 20px; }
h2 {
  font-size: 18px;
  margin: 24px 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #d4d4d8;
}
h3 {
  font-size: 15px;
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
p { margin: 0; }
p + p { margin-top: 8px; }
.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #a3a3a3;
  flex-shrink: 0;
}
.meta {
  font-size: 11px;
  color: #6b7280;
  margin: 0 0 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.link {
  margin: 0 0 12px;
}
.link a {
  color: #2563eb;
  font-size: 13px;
  word-break: break-all;
}
blockquote {
  margin: 6px 0;
  padding: 6px 12px;
  border-left: 3px solid #9ca3af;
  color: #374151;
  background: #f3f4f6;
  border-radius: 0 6px 6px 0;
}
.body {
  white-space: pre-wrap;
  word-wrap: break-word;
}
.conv { margin-bottom: 20px; }
.bm {
  margin: 0;
  padding: 10px 0;
  border-top: 1px solid #e4e4e7;
}
.bm:first-of-type { border-top: 0; }
.bm--barebones { padding: 8px 0; }
.bm--barebones .role { margin: 0 0 4px; font-size: 13px; color: #6b7280; }
.bm--barebones + .bm--barebones { border-top: 1px solid #e4e4e7; }
@media print {
  body { background: white; max-width: none; margin: 0; padding: 24px; }
  h2 { page-break-after: avoid; }
  .bm { page-break-inside: avoid; }
}
`;

export function toHtml(groups: ExportGroup[], opts: ExportOptions): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<title>Bookmarks export</title>` +
    `<style>${HTML_STYLES}</style></head><body>` +
    `<h1>Bookmarks export</h1>` +
    renderHtmlBody(groups, opts) +
    `</body></html>`
  );
}

// triggers a real download via an object url.
export function downloadBlob(filename: string, mime: string, data: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // a small delay before revoking so the browser actually starts the
  // download — revoking too early can cancel it in some chromium builds.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// pdf path: open a new tab with the styled html, wait for layout, then fire
// the native print dialog. user picks "Save as PDF" — a real pdf with no
// extra deps. returns false when the popup was blocked so the caller can
// surface a hint.
export function openPrintForPdf(html: string): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  // small delay lets fonts/layout settle before the print preview pops.
  w.addEventListener("load", () => {
    setTimeout(() => w.print(), 150);
  });
  return true;
}
