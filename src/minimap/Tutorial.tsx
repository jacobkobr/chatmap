import { useEffect, useRef } from "react";

interface Props {
  step: number;
  bookmarkCount: number;
  // monotonic counter that bumps every time the quick-bookmark keybind fires.
  // step 2 watches this so we can tell a 'B'-triggered bookmark apart from
  // one added via the editor (both grow bookmarkCount).
  quickBookmarkFireCount: number;
  // labels for the keybinds the tutorial demonstrates, so renaming a default
  // in settings flows through to the body copy.
  modifierLabel: string;
  quickKeyLabel: string;
  nextLabel: string;
  prevLabel: string;
  onAdvance: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

const TOTAL_STEPS = 3;

export function Tutorial({
  step,
  bookmarkCount,
  quickBookmarkFireCount,
  modifierLabel,
  quickKeyLabel,
  nextLabel,
  prevLabel,
  onAdvance,
  onSkip,
  onComplete,
}: Props) {
  // baselines so a previously-existing bookmark or earlier keypress doesn't
  // auto-advance the moment the step opens. reset whenever step changes.
  const bookmarkBaseline = useRef(bookmarkCount);
  const quickBaseline = useRef(quickBookmarkFireCount);

  useEffect(() => {
    bookmarkBaseline.current = bookmarkCount;
    quickBaseline.current = quickBookmarkFireCount;
    // intentionally depend only on `step` — we snapshot the others at this
    // moment and want them captured, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step === 0 && bookmarkCount > bookmarkBaseline.current) onAdvance();
  }, [step, bookmarkCount, onAdvance]);

  useEffect(() => {
    if (step === 1 && quickBookmarkFireCount > quickBaseline.current)
      onAdvance();
  }, [step, quickBookmarkFireCount, onAdvance]);

  if (step >= TOTAL_STEPS) return null;

  let title = "";
  let body: React.ReactNode = null;
  let primaryLabel = "Next";
  let onPrimary: () => void = onAdvance;

  if (step === 0) {
    title = "Welcome to ChatMap";
    body = (
      <>
        <p>
          The bar on the right is a minimap of this conversation. Each tick is
          a message.
        </p>
        <p>
          <strong>Try it:</strong> hold <kbd>{modifierLabel}</kbd> and click any
          marker to bookmark that message.
        </p>
      </>
    );
  } else if (step === 1) {
    title = "Quick bookmark";
    body = (
      <>
        <p>
          You can also drop a bookmark on the currently active marker with a
          single key.
        </p>
        <p>
          <strong>Try it:</strong> press <kbd>{quickKeyLabel}</kbd>.
        </p>
      </>
    );
  } else {
    title = "You're set";
    body = (
      <>
        <p>
          Scroll the page normally — the rail highlights the message you're
          currently reading.
        </p>
        <p>
          Jump between bookmarks with <kbd>{prevLabel}</kbd> and{" "}
          <kbd>{nextLabel}</kbd>. Hover any marker for a preview.
        </p>
      </>
    );
    primaryLabel = "Done";
    onPrimary = onComplete;
  }

  return (
    <div
      className="tutorial-card"
      role="dialog"
      aria-label="ChatMap tutorial"
      aria-live="polite"
    >
      <div className="tutorial-header">
        <span className="tutorial-title">{title}</span>
        <span className="tutorial-step">
          {step + 1} / {TOTAL_STEPS}
        </span>
      </div>
      <div className="tutorial-body">{body}</div>
      <div className="tutorial-actions">
        <button
          type="button"
          className="tutorial-btn tutorial-btn--ghost"
          onClick={onSkip}
        >
          Skip tutorial
        </button>
        <button
          type="button"
          className="tutorial-btn tutorial-btn--primary"
          onClick={onPrimary}
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}
