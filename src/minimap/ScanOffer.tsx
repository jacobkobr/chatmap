interface Props {
  scanning: boolean;
  progress: number; // 0..1
  onScan: () => void;
  onDismiss: () => void;
}

// presentational. all scan state is owned by Minimap so the popup never
// rewinds mid-scan when react re-renders for other reasons.
export function ScanOffer({ scanning, progress, onScan, onDismiss }: Props) {
  if (scanning) {
    return (
      <div className="scan-offer" role="status" aria-label="scan in progress">
        <div className="scan-offer-title">scanning…</div>
        <div className="scan-offer-desc">
          walking through the conversation to map every message.
        </div>
        <div className="scan-offer-progress">
          <div
            className="scan-offer-progress-bar"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="scan-offer" role="dialog" aria-label="scan conversation">
      <div className="scan-offer-title">map full conversation</div>
      <div className="scan-offer-desc">
        chatgpt only loads nearby messages, so the timeline starts incomplete.
        scan once to capture every marker — they stay cached on this device.
      </div>
      <div className="scan-offer-actions">
        <button
          type="button"
          className="scan-offer-btn-primary"
          onClick={onScan}
        >
          scan
        </button>
        <button
          type="button"
          className="scan-offer-btn-text"
          onClick={onDismiss}
        >
          not now
        </button>
      </div>
    </div>
  );
}
