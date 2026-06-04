import { useEffect, useMemo, useState } from "react";
import { loadBookmarks } from "../storage/bookmarks";
import { loadAllCaches } from "../storage/markerCache";
import {
  downloadBlob,
  gatherChatsData,
  gatherExportData,
  openPrintForPdf,
  toHtml,
  toJson,
  toMarkdown,
  type ExportFormat,
  type ExportGroup,
  type ExportScope,
} from "./exporters";

interface Props {
  // when provided, overrides cached text for the currently-open chat with
  // full message text scraped from the live dom.
  liveText?: Record<string, Record<string, string>>;
  onClose: () => void;
}

// styles co-located so the dialog looks identical in both contexts (shadow
// dom on chatgpt.com, regular dom on the options page) without keeping two
// stylesheets in sync. accent-color uses currentColor where possible so it
// inherits whatever the host page is using.
const EXPORT_DIALOG_STYLES = `
.export-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 14px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif;
  color: #e8e8ea;
  /* shadow host runs pointer-events:none so the rail's empty corners don't
     eat page clicks. our overlay needs them back. */
  pointer-events: auto;
}
.export-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(8, 8, 10, 0.55);
  backdrop-filter: blur(2px);
}
.export-dialog {
  position: relative;
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background: #18181b;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}
.export-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.export-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.export-close {
  background: transparent;
  border: 0;
  color: inherit;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  opacity: 0.7;
}
.export-close:hover { opacity: 1; background: rgba(255,255,255,0.06); }
.export-body {
  padding: 12px 18px;
  overflow-y: auto;
  flex: 1;
}
.export-empty {
  color: #a1a1aa;
  text-align: center;
  margin: 30px 0;
}
.export-scope {
  display: flex;
  gap: 4px;
  background: rgba(255,255,255,0.04);
  padding: 4px;
  border-radius: 10px;
  margin-bottom: 12px;
}
.export-scope-opt {
  flex: 1;
  text-align: center;
  font-size: 12.5px;
  padding: 6px 10px;
  border-radius: 7px;
  cursor: pointer;
  user-select: none;
  color: #a1a1aa;
}
.export-scope-opt input { display: none; }
.export-scope-opt--on {
  background: rgba(255,255,255,0.1);
  color: #fafafa;
}
.export-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0 0 10px;
  font-size: 12px;
  color: #a1a1aa;
}
.export-toolbar-actions { display: flex; gap: 6px; }
.export-toolbar button {
  background: transparent;
  color: #d4d4d8;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
}
.export-toolbar button:hover { background: rgba(255,255,255,0.06); }
.export-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.export-group {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 8px 10px;
}
.export-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  cursor: pointer;
}
.export-group-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.export-group-count {
  font-size: 11px;
  color: #a1a1aa;
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
  padding: 1px 8px;
}
.export-bms {
  list-style: none;
  margin: 6px 0 0;
  padding: 0 0 0 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.export-bm label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #d4d4d8;
  cursor: pointer;
  padding: 2px 0;
}
.export-bm input[type="checkbox"] { flex-shrink: 0; }
.export-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid rgba(255,255,255,0.18);
}
.export-bm-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.export-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding: 12px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.export-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.export-format {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.export-format-opt {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  padding: 5px 11px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 999px;
  cursor: pointer;
  user-select: none;
}
.export-format-opt input { display: none; }
.export-format-opt--on {
  background: rgba(255,255,255,0.12);
  border-color: rgba(255,255,255,0.3);
}
.export-link-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #d4d4d8;
  cursor: pointer;
}
.export-pdf-warning {
  margin: 0;
  font-size: 12.5px;
  color: #fbbf24;
}
.export-go {
  align-self: flex-end;
  padding: 8px 18px;
  border-radius: 8px;
  border: 0;
  font-weight: 600;
  background: #fafafa;
  color: #18181b;
  cursor: pointer;
  font-size: 13.5px;
}
.export-go:hover { background: #ffffff; }
.export-go:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (prefers-color-scheme: light) {
  .export-overlay { color: #18181b; }
  .export-dialog { background: #ffffff; border-color: rgba(0,0,0,0.08); }
  .export-header { border-bottom-color: rgba(0,0,0,0.06); }
  .export-footer { border-top-color: rgba(0,0,0,0.06); }
  .export-close:hover { background: rgba(0,0,0,0.04); }
  .export-empty { color: #71717a; }
  .export-toolbar { color: #71717a; }
  .export-toolbar button { color: #18181b; border-color: rgba(0,0,0,0.12); }
  .export-toolbar button:hover { background: rgba(0,0,0,0.04); }
  .export-group { background: rgba(0,0,0,0.025); border-color: rgba(0,0,0,0.06); }
  .export-group-count { color: #71717a; background: rgba(0,0,0,0.06); }
  .export-bm label { color: #27272a; }
  .export-format-opt { border-color: rgba(0,0,0,0.12); }
  .export-format-opt--on { background: rgba(0,0,0,0.06); border-color: rgba(0,0,0,0.3); }
  .export-link-toggle { color: #27272a; }
  .export-go { background: #18181b; color: #fafafa; }
  .export-go:hover { background: #000000; }
  .export-scope { background: rgba(0,0,0,0.04); }
  .export-scope-opt { color: #71717a; }
  .export-scope-opt--on { background: rgba(0,0,0,0.08); color: #18181b; }
}
`;

export function ExportDialog({ liveText, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<ExportGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [scope, setScope] = useState<ExportScope>("bookmarks");
  const [includeLink, setIncludeLink] = useState(true);
  // default to barebones (just role + text). user opts into the rich format
  // with titles, notes, colors, dates, conv headers via the toggle below.
  const [barebones, setBarebones] = useState(true);
  const [pdfWarning, setPdfWarning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [bookmarks, caches] = await Promise.all([
        loadBookmarks(),
        loadAllCaches(),
      ]);
      if (cancelled) return;
      const data =
        scope === "chats"
          ? gatherChatsData(bookmarks, caches, liveText)
          : gatherExportData(bookmarks, caches, liveText);
      setGroups(data);
      // default to all-selected so the common case ("export everything") is
      // one click. user can deselect to narrow it down.
      const allKeys = new Set<string>();
      for (const g of data) for (const b of g.bookmarks) allKeys.add(b.key);
      setSelected(allKeys);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [liveText, scope]);

  const totalCount = useMemo(
    () => groups.reduce((n, g) => n + g.bookmarks.length, 0),
    [groups]
  );

  // close on escape so the keyboard-driven user can dismiss without reaching
  // for the mouse. handles focus-in-input the standard way: escape always
  // closes, even from inside the dialog's own controls.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggleOne(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleConv(g: ExportGroup) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = g.bookmarks.every((b) => next.has(b.key));
      if (allOn) for (const b of g.bookmarks) next.delete(b.key);
      else for (const b of g.bookmarks) next.add(b.key);
      return next;
    });
  }

  function selectAll() {
    const next = new Set<string>();
    for (const g of groups) for (const b of g.bookmarks) next.add(b.key);
    setSelected(next);
  }

  function selectNone() {
    setSelected(new Set());
  }

  function filtered(): ExportGroup[] {
    return groups
      .map((g) => ({
        ...g,
        bookmarks: g.bookmarks.filter((b) => selected.has(b.key)),
      }))
      .filter((g) => g.bookmarks.length > 0);
  }

  function doExport() {
    setPdfWarning(false);
    const data = filtered();
    if (data.length === 0) return;
    const opts = { format, includeLink, barebones };
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "json") {
      downloadBlob(
        `chatmap-bookmarks-${stamp}.json`,
        "application/json",
        toJson(data, opts)
      );
    } else if (format === "html") {
      downloadBlob(
        `chatmap-bookmarks-${stamp}.html`,
        "text/html;charset=utf-8",
        toHtml(data, opts)
      );
    } else if (format === "pdf") {
      const ok = openPrintForPdf(toHtml(data, opts));
      if (!ok) {
        setPdfWarning(true);
        return;
      }
    } else {
      downloadBlob(
        `chatmap-bookmarks-${stamp}.md`,
        "text/markdown;charset=utf-8",
        toMarkdown(data, opts)
      );
    }
    onClose();
  }

  const selectedCount = selected.size;

  return (
    <div className="export-overlay" role="dialog" aria-label="Export bookmarks">
      <style>{EXPORT_DIALOG_STYLES}</style>
      <div
        className="export-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <div className="export-dialog">
        <header className="export-header">
          <h2>Export bookmarks</h2>
          <button
            type="button"
            className="export-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="export-body">
          <div className="export-scope" role="radiogroup" aria-label="Scope">
            {(
              [
                ["bookmarks", "Bookmarks only"],
                ["chats", "Full conversations"],
              ] as const
            ).map(([v, label]) => (
              <label
                key={v}
                className={`export-scope-opt${scope === v ? " export-scope-opt--on" : ""}`}
              >
                <input
                  type="radio"
                  name="export-scope"
                  value={v}
                  checked={scope === v}
                  onChange={() => setScope(v)}
                />
                {label}
              </label>
            ))}
          </div>
          {loading ? (
            <p className="export-empty">Loading…</p>
          ) : totalCount === 0 ? (
            <p className="export-empty">
              {scope === "bookmarks"
                ? "No bookmarks yet. Add a few from any conversation first."
                : "No cached conversations yet. Open a chat to populate the cache."}
            </p>
          ) : (
            <>
              <div className="export-toolbar">
                <span className="export-count">
                  {selectedCount} of {totalCount} selected
                </span>
                <div className="export-toolbar-actions">
                  <button type="button" onClick={selectAll}>
                    All
                  </button>
                  <button type="button" onClick={selectNone}>
                    None
                  </button>
                </div>
              </div>

              <div className="export-list">
                {groups.map((g) => {
                  const allOn = g.bookmarks.every((b) =>
                    selected.has(b.key)
                  );
                  const someOn = g.bookmarks.some((b) =>
                    selected.has(b.key)
                  );
                  return (
                    <section key={g.convId} className="export-group">
                      <label className="export-group-head">
                        <input
                          type="checkbox"
                          checked={allOn}
                          ref={(el) => {
                            if (el) el.indeterminate = !allOn && someOn;
                          }}
                          onChange={() => toggleConv(g)}
                        />
                        <span className="export-group-label">{g.label}</span>
                        <span className="export-group-count">
                          {g.bookmarks.length}
                        </span>
                      </label>
                      <ul className="export-bms">
                        {g.bookmarks.map((b) => (
                          <li key={b.key} className="export-bm">
                            <label>
                              <input
                                type="checkbox"
                                checked={selected.has(b.key)}
                                onChange={() => toggleOne(b.key)}
                              />
                              {b.color ? (
                                <span
                                  className="export-swatch"
                                  style={{ background: b.color }}
                                  aria-hidden="true"
                                />
                              ) : null}
                              <span className="export-bm-title">
                                {b.name ||
                                  b.text.slice(0, 60) ||
                                  `Bookmark (${b.role})`}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <footer className="export-footer">
          <div className="export-options">
            <div className="export-format" role="radiogroup" aria-label="Format">
              {(
                [
                  ["markdown", "Markdown"],
                  ["pdf", "PDF"],
                  ["html", "HTML"],
                  ["json", "JSON"],
                ] as const
              ).map(([v, label]) => (
                <label
                  key={v}
                  className={`export-format-opt${format === v ? " export-format-opt--on" : ""}`}
                >
                  <input
                    type="radio"
                    name="export-format"
                    value={v}
                    checked={format === v}
                    onChange={() => setFormat(v)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <label className="export-link-toggle">
              <input
                type="checkbox"
                checked={!barebones}
                onChange={(e) => setBarebones(!e.target.checked)}
              />
              Include titles, notes & dates
            </label>
            <label className="export-link-toggle">
              <input
                type="checkbox"
                checked={includeLink}
                onChange={(e) => setIncludeLink(e.target.checked)}
              />
              Include link to conversation
            </label>
          </div>

          {pdfWarning && (
            <p className="export-pdf-warning">
              The PDF preview opens in a new tab — allow popups for
              chatgpt.com, then try again.
            </p>
          )}

          <button
            type="button"
            className="export-go"
            disabled={selectedCount === 0 || loading}
            onClick={doExport}
          >
            Export {selectedCount > 0 ? `${selectedCount}` : ""}
          </button>
        </footer>
      </div>
    </div>
  );
}
