import { useEffect } from "react";

interface UseTvKeyboardOptions {
  onChannelUp: () => void;
  onChannelDown: () => void;
  onSelect: () => void;
  onBack: () => void;
  onToggleFullscreen: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  onPageUp?: () => void;
  onPageDown?: () => void;
  enabled?: boolean;
}

export function useTvKeyboard({
  onChannelUp,
  onChannelDown,
  onSelect,
  onBack,
  onToggleFullscreen,
  onLeft,
  onRight,
  onPageUp,
  onPageDown,
  enabled = true
}: UseTvKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case "ArrowUp":
        case "ChannelUp":
          e.preventDefault();
          onChannelUp();
          break;
        case "ArrowDown":
        case "ChannelDown":
          e.preventDefault();
          onChannelDown();
          break;
        case "ArrowLeft":
          if (onLeft) {
            e.preventDefault();
            onLeft();
          }
          break;
        case "ArrowRight":
          if (onRight) {
            e.preventDefault();
            onRight();
          }
          break;
        case "PageUp":
          if (onPageUp) {
            e.preventDefault();
            onPageUp();
          }
          break;
        case "PageDown":
          if (onPageDown) {
            e.preventDefault();
            onPageDown();
          }
          break;
        case "Enter":
          e.preventDefault();
          onSelect();
          break;
        case "Escape":
        case "Backspace":
          e.preventDefault();
          onBack();
          break;
        case "f":
        case "F":
          e.preventDefault();
          onToggleFullscreen();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onChannelUp, onChannelDown, onSelect, onBack, onToggleFullscreen, onLeft, onRight, onPageUp, onPageDown]);
}
