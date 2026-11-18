/**
 * Game controller support (8BitDo, Xbox, PlayStation, ...).
 *
 * Two sources are merged:
 *  - the browser Gamepad API (desktop browsers, Chrome on Android)
 *  - events forwarded by the Android app (MainActivity.java), because the
 *    in-app WebView doesn't reliably expose the Gamepad API
 *
 * Buttons are named by POSITION, Xbox style: "a" = bottom face button,
 * "b" = right, "x" = left, "y" = top. (On an 8BitDo with Nintendo labels the
 * bottom button is printed "B"; set `swapConfirmCancel` if you prefer the
 * right-hand button to confirm.)
 */
export type PadButton =
  | "a" | "b" | "x" | "y"
  | "l1" | "r1" | "select" | "start"
  | "up" | "down" | "left" | "right";

export interface PadState {
  buttons: Set<PadButton>;
  /** Left stick, -1..1. */
  x: number;
  y: number;
}

// Standard Gamepad API button indices.
const STANDARD: [number, PadButton][] = [
  [0, "a"], [1, "b"], [2, "x"], [3, "y"], [4, "l1"], [5, "r1"],
  [8, "select"], [9, "start"], [12, "up"], [13, "down"], [14, "left"], [15, "right"],
];

/** Controller preferences. */
export const padSettings = {
  /** false: bottom button confirms, right button cancels (Xbox style). true: the reverse (Nintendo style). */
  swapConfirmCancel: new URLSearchParams(location.search).has("nintendo"),
};

const STICK_DEADZONE = 0.25;
const HAT_THRESHOLD = 0.5;

interface NativeBridge {
  button(name: PadButton, down: boolean): void;
  axes(x: number, y: number, hatX: number, hatY: number): void;
}

declare global {
  interface Window {
    __nativeGamepad?: NativeBridge;
  }
}

export class Gamepads {
  private native = { buttons: new Set<PadButton>(), x: 0, y: 0, hatX: 0, hatY: 0 };

  constructor() {
    window.__nativeGamepad = {
      button: (name, down) => {
        if (down) this.native.buttons.add(name);
        else this.native.buttons.delete(name);
      },
      axes: (x, y, hatX, hatY) => Object.assign(this.native, { x, y, hatX, hatY }),
    };
    window.addEventListener("blur", () => this.native.buttons.clear());
  }

  /** Current combined state of every connected controller. */
  poll(): PadState {
    const buttons = new Set(this.native.buttons);
    let x = this.native.x, y = this.native.y;
    if (this.native.hatX <= -HAT_THRESHOLD) buttons.add("left");
    if (this.native.hatX >= HAT_THRESHOLD) buttons.add("right");
    if (this.native.hatY <= -HAT_THRESHOLD) buttons.add("up");
    if (this.native.hatY >= HAT_THRESHOLD) buttons.add("down");

    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      for (const [i, name] of STANDARD) if (gp.buttons[i]?.pressed) buttons.add(name);
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > Math.hypot(x, y)) {
        x = ax;
        y = ay;
      }
    }

    const len = Math.hypot(x, y);
    if (len < STICK_DEADZONE) {
      x = 0;
      y = 0;
    } else if (len > 1) {
      x /= len;
      y /= len;
    }
    return { buttons, x, y };
  }
}
