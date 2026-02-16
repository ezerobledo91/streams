import { useEffect, useRef } from "react";

/**
 * Maps Gamepad API inputs (Smart TV remotes, controllers) to synthetic keyboard events.
 * Standard mapping: https://w3c.github.io/gamepad/#remapping
 */
export function useGamepad(enabled = true) {
  const rafRef = useRef(0);
  const prevButtonsRef = useRef<Record<number, boolean[]>>({});

  useEffect(() => {
    if (!enabled || typeof navigator.getGamepads !== "function") return;

    const BUTTON_MAP: Record<number, string> = {
      0: "Enter",       // A / X — select
      1: "Escape",      // B / Circle — back
      12: "ArrowUp",    // D-pad up
      13: "ArrowDown",  // D-pad down
      14: "ArrowLeft",  // D-pad left
      15: "ArrowRight", // D-pad right
      4: "PageUp",      // L bumper
      5: "PageDown",    // R bumper
      9: "f"            // Start — fullscreen toggle
    };

    function dispatchKey(key: string) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }

    function poll() {
      const gamepads = navigator.getGamepads();
      for (let gi = 0; gi < gamepads.length; gi++) {
        const gp = gamepads[gi];
        if (!gp) continue;

        const prev = prevButtonsRef.current[gi] || [];
        const current = gp.buttons.map((b) => b.pressed);

        for (const [btnIdx, key] of Object.entries(BUTTON_MAP)) {
          const idx = Number(btnIdx);
          if (current[idx] && !prev[idx]) {
            dispatchKey(key);
          }
        }

        // Axes (analog stick) — threshold 0.5
        const axisX = gp.axes[0] ?? 0;
        const axisY = gp.axes[1] ?? 0;
        const prevAxes = (prevButtonsRef.current as unknown as Record<string, number[]>)[`axes_${gi}`] || [0, 0];

        if (axisX < -0.5 && prevAxes[0] >= -0.5) dispatchKey("ArrowLeft");
        if (axisX > 0.5 && prevAxes[0] <= 0.5) dispatchKey("ArrowRight");
        if (axisY < -0.5 && prevAxes[1] >= -0.5) dispatchKey("ArrowUp");
        if (axisY > 0.5 && prevAxes[1] <= 0.5) dispatchKey("ArrowDown");

        prevButtonsRef.current[gi] = current;
        (prevButtonsRef.current as unknown as Record<string, number[]>)[`axes_${gi}`] = [axisX, axisY];
      }

      rafRef.current = requestAnimationFrame(poll);
    }

    rafRef.current = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled]);
}
