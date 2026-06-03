import { useEffect, useRef, useState } from "react";

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
  scrollNavLabel: string;
  nextLabel: string;
  prevLabel: string;
  onAdvance: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

const TOTAL_STEPS = 3;
// how long the "completed" check stays visible before the next step opens.
// long enough to register, short enough not to drag the walkthrough.
const COMPLETE_DELAY_MS = 700;

export function Tutorial({
  step,
  bookmarkCount,
  quickBookmarkFireCount,
  modifierLabel,
  quickKeyLabel,
  scrollNavLabel,
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
  // brief "✓ got it" state between the user completing an action and the
  // tutorial advancing to the next step. resets on step change.
  const [justCompleted, setJustCompleted] = useState(false);

  // dragging — header acts as a handle. dragPos is null while the card sits
  // at its css default (bottom-right); becomes {left, top} as soon as the
  // user grabs and drags, so the position can be controlled in absolute
  // viewport coords from there on.
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(
    null
  );
  const [isDragging, setIsDragging] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ x: 0, y: 0, startLeft: 0, startTop: 0 });

  function onHeaderMouseDown(e: React.MouseEvent) {
    // only react to primary button; ignore right-clicks and aux clicks
    if (e.button !== 0) return;
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };
    setDragPos({ left: rect.left, top: rect.top });
    setIsDragging(true);
    e.preventDefault();
  }

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const w = cardRef.current?.offsetWidth ?? 320;
      const h = cardRef.current?.offsetHeight ?? 200;
      const maxLeft = Math.max(0, window.innerWidth - w);
      const maxTop = Math.max(0, window.innerHeight - h);
      setDragPos({
        left: Math.max(0, Math.min(maxLeft, dragStart.current.startLeft + dx)),
        top: Math.max(0, Math.min(maxTop, dragStart.current.startTop + dy)),
      });
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging]);

  useEffect(() => {
    bookmarkBaseline.current = bookmarkCount;
    quickBaseline.current = quickBookmarkFireCount;
    setJustCompleted(false);
    // intentionally depend only on `step` — we snapshot the others at this
    // moment and want them captured, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step === 0 && !justCompleted && bookmarkCount > bookmarkBaseline.current) {
      setJustCompleted(true);
    }
  }, [step, bookmarkCount, justCompleted]);

  useEffect(() => {
    if (
      step === 1 &&
      !justCompleted &&
      quickBookmarkFireCount > quickBaseline.current
    ) {
      setJustCompleted(true);
    }
  }, [step, quickBookmarkFireCount, justCompleted]);

  useEffect(() => {
    if (!justCompleted) return;
    const t = setTimeout(onAdvance, COMPLETE_DELAY_MS);
    return () => clearTimeout(t);
  }, [justCompleted, onAdvance]);

  if (step >= TOTAL_STEPS) return null;

  let title = "";
  let body: React.ReactNode = null;
  let primaryLabel = "Next";
  let onPrimary: () => void = onAdvance;

  if (step === 0) {
    title = "Welcome to chatmap";
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
          Hold <kbd>{scrollNavLabel}</kbd> and use the scroll wheel to step
          through every marker. Use <kbd>{prevLabel}</kbd> /{" "}
          <kbd>{nextLabel}</kbd> to jump between bookmarks. Hover any marker
          for a preview.
        </p>
        <p className="tutorial-hint">
          You can restart this walkthrough anytime from settings.
        </p>
      </>
    );
    primaryLabel = "Done";
    onPrimary = onComplete;
  }

  return (
    <div
      ref={cardRef}
      className={`tutorial-card${isDragging ? " tutorial-card--dragging" : ""}`}
      style={
        dragPos
          ? {
              left: dragPos.left,
              top: dragPos.top,
              right: "auto",
              bottom: "auto",
            }
          : undefined
      }
      role="dialog"
      aria-label="chatmap tutorial"
      aria-live="polite"
    >
      <div className="tutorial-header" onMouseDown={onHeaderMouseDown}>
        <span className="tutorial-title">{title}</span>
        <span className="tutorial-step">
          {step + 1} / {TOTAL_STEPS}
        </span>
      </div>
      <div className="tutorial-body">
        {justCompleted ? (
          <div className="tutorial-success">
            <span className="tutorial-check" aria-hidden="true">
              ✓
            </span>
            <span className="tutorial-success-label">Got it</span>
          </div>
        ) : (
          body
        )}
      </div>
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
          disabled={justCompleted}
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}
