import { useEffect, useRef, useState, type ReactNode } from "react";

const STORAGE_KEY = "markdown:editor-width";
const DEFAULT_WIDTH = 1100;
const MIN_WIDTH = 360;
const MAX_WIDTH = 2400;

function initialWidth() {
  try {
    const width = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(width) && width >= MIN_WIDTH) {
      return Math.min(width, MAX_WIDTH);
    }
  } catch {
    // Resizing still works when storage is unavailable.
  }
  return DEFAULT_WIDTH;
}

export function ResizableEditor({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(initialWidth);
  const [availableWidth, setAvailableWidth] = useState(MAX_WIDTH);
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const maxWidth = Math.min(MAX_WIDTH, availableWidth);
  const minWidth = Math.min(MIN_WIDTH, maxWidth);
  const visibleWidth = Math.min(width, maxWidth);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      setAvailableWidth(container.clientWidth);
    });
    setAvailableWidth(container.clientWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      // Width is still retained for the current session.
    }
  }, [width]);

  useEffect(() => {
    if (!resizing) return;
    document.body.classList.add("editor-resizing");
    return () => document.body.classList.remove("editor-resizing");
  }, [resizing]);

  const resize = (next: number) => {
    setWidth(Math.max(minWidth, Math.min(maxWidth, next)));
  };

  return (
    <div className="editor-width-container" ref={containerRef}>
      <div className="editor-width-frame" style={{ width: visibleWidth }}>
        {children}
        {(["left", "right"] as const).map((edge) => {
          const direction = edge === "right" ? 1 : -1;
          return (
            <div
              key={edge}
              className={`editor-resize-handle ${edge}${resizing ? " resizing" : ""}`}
              role="separator"
              aria-label={`Resize editor from ${edge} edge`}
              aria-orientation="vertical"
              aria-valuemin={Math.round(minWidth)}
              aria-valuemax={Math.round(maxWidth)}
              aria-valuenow={Math.round(visibleWidth)}
              aria-valuetext={`${Math.round(visibleWidth)} pixels wide`}
              tabIndex={0}
              title="Drag to resize editor. Double-click to reset."
              onPointerDown={(event) => {
                if (!event.isPrimary || event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = {
                  pointerId: event.pointerId,
                  x: event.clientX,
                  width: visibleWidth,
                };
                setResizing(true);
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                resize(drag.width + direction * (event.clientX - drag.x) * 2);
              }}
              onPointerUp={(event) => {
                if (dragRef.current?.pointerId !== event.pointerId) return;
                dragRef.current = null;
                setResizing(false);
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                dragRef.current = null;
                setResizing(false);
              }}
              onLostPointerCapture={() => {
                dragRef.current = null;
                setResizing(false);
              }}
              onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 100 : 20;
                switch (event.key) {
                  case "ArrowLeft": resize(visibleWidth - direction * step); break;
                  case "ArrowRight": resize(visibleWidth + direction * step); break;
                  case "Home": resize(minWidth); break;
                  case "End": resize(maxWidth); break;
                  default: return;
                }
                event.preventDefault();
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
