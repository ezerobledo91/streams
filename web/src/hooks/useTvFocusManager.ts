import { useCallback, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = "[data-tv-focusable]";
const FOCUSED_CLASS = "tv-focused";

interface UseTvFocusOptions {
  /** Root container ref — navigation scoped to this element */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Group layout: "rail" = horizontal, "grid" = 2D, "list" = vertical */
  groupType?: "rail" | "grid" | "list";
  /** Called when Enter is pressed on the focused element */
  onSelect?: (element: HTMLElement, index: number) => void;
  /** Called when Escape/Back is pressed */
  onBack?: () => void;
  /** Enable/disable the hook */
  enabled?: boolean;
  /** Columns count for grid layout (auto-detected if omitted) */
  columns?: number;
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function clearFocusClass(container: HTMLElement | null) {
  if (!container) return;
  for (const el of container.querySelectorAll(`.${FOCUSED_CLASS}`)) {
    el.classList.remove(FOCUSED_CLASS);
  }
}

function setFocusOn(element: HTMLElement) {
  element.classList.add(FOCUSED_CLASS);
  element.focus({ preventScroll: false });
  element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

function detectColumns(elements: HTMLElement[]): number {
  if (elements.length < 2) return 1;
  const firstTop = elements[0].getBoundingClientRect().top;
  for (let i = 1; i < elements.length; i++) {
    if (Math.abs(elements[i].getBoundingClientRect().top - firstTop) > 10) {
      return i;
    }
  }
  return elements.length;
}

export function useTvFocusManager({
  containerRef,
  groupType = "grid",
  onSelect,
  onBack,
  enabled = true,
  columns
}: UseTvFocusOptions) {
  const currentIndexRef = useRef(-1);

  const moveFocus = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      const container = containerRef.current;
      if (!container) return;

      const elements = getFocusableElements(container);
      if (!elements.length) return;

      let idx = currentIndexRef.current;
      if (idx < 0 || idx >= elements.length) idx = 0;

      const cols = columns ?? (groupType === "grid" ? detectColumns(elements) : 1);
      let nextIdx = idx;

      if (groupType === "rail") {
        // Horizontal: left/right moves, up/down ignored (let parent handle)
        if (direction === "left") nextIdx = Math.max(0, idx - 1);
        else if (direction === "right") nextIdx = Math.min(elements.length - 1, idx + 1);
        else return; // up/down not handled in rail
      } else if (groupType === "list") {
        // Vertical: up/down moves, left/right ignored
        if (direction === "up") nextIdx = Math.max(0, idx - 1);
        else if (direction === "down") nextIdx = Math.min(elements.length - 1, idx + 1);
        else return;
      } else {
        // Grid: 2D navigation
        if (direction === "left") nextIdx = Math.max(0, idx - 1);
        else if (direction === "right") nextIdx = Math.min(elements.length - 1, idx + 1);
        else if (direction === "up") nextIdx = Math.max(0, idx - cols);
        else if (direction === "down") nextIdx = Math.min(elements.length - 1, idx + cols);
      }

      if (nextIdx !== idx || currentIndexRef.current < 0) {
        clearFocusClass(container);
        currentIndexRef.current = nextIdx;
        setFocusOn(elements[nextIdx]);
      }
    },
    [containerRef, groupType, columns]
  );

  const focusFirst = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const elements = getFocusableElements(container);
    if (!elements.length) return;
    clearFocusClass(container);
    currentIndexRef.current = 0;
    setFocusOn(elements[0]);
  }, [containerRef]);

  const focusIndex = useCallback(
    (index: number) => {
      const container = containerRef.current;
      if (!container) return;
      const elements = getFocusableElements(container);
      if (!elements.length) return;
      const safeIndex = Math.max(0, Math.min(elements.length - 1, index));
      clearFocusClass(container);
      currentIndexRef.current = safeIndex;
      setFocusOn(elements[safeIndex]);
    },
    [containerRef]
  );

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          moveFocus("up");
          break;
        case "ArrowDown":
          e.preventDefault();
          moveFocus("down");
          break;
        case "ArrowLeft":
          e.preventDefault();
          moveFocus("left");
          break;
        case "ArrowRight":
          e.preventDefault();
          moveFocus("right");
          break;
        case "Enter": {
          e.preventDefault();
          const elements = getFocusableElements(container);
          const idx = currentIndexRef.current;
          if (idx >= 0 && idx < elements.length) {
            onSelect?.(elements[idx], idx);
          }
          break;
        }
        case "Escape":
        case "Backspace":
          e.preventDefault();
          onBack?.();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, containerRef, moveFocus, onSelect, onBack]);

  // Clean up focus class on unmount
  useEffect(() => {
    return () => {
      clearFocusClass(containerRef.current);
      currentIndexRef.current = -1;
    };
  }, [containerRef]);

  return { moveFocus, focusFirst, focusIndex, currentIndex: currentIndexRef };
}
