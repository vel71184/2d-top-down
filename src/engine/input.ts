import type { Display } from "./display";

export type Action = "confirm" | "cancel" | "menu";

const KEY_ACTIONS: Record<string, Action> = {
  Space: "confirm",
  Enter: "confirm",
  KeyZ: "confirm",
  KeyE: "confirm",
  Escape: "cancel",
  KeyX: "cancel",
  Backspace: "cancel",
  KeyM: "menu",
  Tab: "menu",
};

const KEY_DIRS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};

interface TouchButton {
  action: Action;
  label: string;
  /** Position relative to the bottom-right corner, in virtual pixels. */
  dx: number;
  dy: number;
  r: number;
}

const BUTTONS: TouchButton[] = [
  { action: "confirm", label: "A", dx: 34, dy: 46, r: 17 },
  { action: "cancel", label: "B", dx: 74, dy: 28, r: 14 },
  { action: "menu", label: "☰", dx: 24, dy: 200, r: 11 },
];

const STICK_RADIUS = 28;
const STICK_DEADZONE = 0.18;

/**
 * Unified input: keyboard for desktop testing, a floating virtual joystick
 * (left half of the screen) and on-screen buttons for touch devices.
 */
export class Input {
  private keysDown = new Set<string>();
  private held = new Set<Action>();
  private pressedThisFrame = new Set<Action>();
  private queued = new Set<Action>();

  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickPos = { x: 0, y: 0 };
  private buttonPointers = new Map<number, Action>();

  /** Touch controls are drawn once a touch has been seen. */
  touchMode = false;

  constructor(private display: Display, target: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (KEY_DIRS[e.code] || KEY_ACTIONS[e.code]) e.preventDefault();
      if (e.repeat) return;
      this.keysDown.add(e.code);
      const a = KEY_ACTIONS[e.code];
      if (a) this.queued.add(a);
    });
    window.addEventListener("keyup", (e) => this.keysDown.delete(e.code));
    window.addEventListener("blur", () => this.reset());
    document.addEventListener("visibilitychange", () => this.reset());

    target.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    target.addEventListener("pointermove", (e) => this.onPointerMove(e));
    target.addEventListener("pointerup", (e) => this.onPointerUp(e));
    target.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    target.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Call once at the start of each fixed update step. */
  update(): void {
    this.pressedThisFrame = this.queued;
    this.queued = new Set();
  }

  /** True only on the update step the action was pressed. */
  pressed(action: Action): boolean {
    return this.pressedThisFrame.has(action);
  }

  isHeld(action: Action): boolean {
    if (this.held.has(action)) return true;
    for (const [code, a] of Object.entries(KEY_ACTIONS)) if (a === action && this.keysDown.has(code)) return true;
    return false;
  }

  /** Movement vector with length 0..1 (analog on the joystick). */
  move(): { x: number; y: number } {
    if (this.stickPointer !== null) {
      const dx = (this.stickPos.x - this.stickOrigin.x) / STICK_RADIUS;
      const dy = (this.stickPos.y - this.stickOrigin.y) / STICK_RADIUS;
      const len = Math.hypot(dx, dy);
      if (len < STICK_DEADZONE) return { x: 0, y: 0 };
      const m = Math.min(1, len);
      return { x: (dx / len) * m, y: (dy / len) * m };
    }
    let x = 0, y = 0;
    for (const code of this.keysDown) {
      const d = KEY_DIRS[code];
      if (d) { x += d[0]; y += d[1]; }
    }
    x = Math.sign(x);
    y = Math.sign(y);
    const len = Math.hypot(x, y);
    return len ? { x: x / len, y: y / len } : { x: 0, y: 0 };
  }

  reset(): void {
    this.keysDown.clear();
    this.held.clear();
    this.stickPointer = null;
    this.buttonPointers.clear();
  }

  private buttonCenter(b: TouchButton): { x: number; y: number } {
    return { x: this.display.width - b.dx, y: this.display.height - b.dy };
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType === "touch") this.touchMode = true;
    if (e.pointerType === "mouse" && !this.touchMode) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = this.display.toVirtual(e.clientX, e.clientY);
    for (const b of BUTTONS) {
      const c = this.buttonCenter(b);
      if (Math.hypot(p.x - c.x, p.y - c.y) <= b.r + 6) {
        this.buttonPointers.set(e.pointerId, b.action);
        this.held.add(b.action);
        this.queued.add(b.action);
        return;
      }
    }
    if (p.x < this.display.width * 0.55 && this.stickPointer === null) {
      this.stickPointer = e.pointerId;
      this.stickOrigin = p;
      this.stickPos = p;
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickPointer) return;
    const p = this.display.toVirtual(e.clientX, e.clientY);
    // Let the joystick base follow the finger if dragged far, so it never "runs out".
    const dx = p.x - this.stickOrigin.x, dy = p.y - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    const max = STICK_RADIUS * 1.6;
    if (len > max) {
      this.stickOrigin.x = p.x - (dx / len) * max;
      this.stickOrigin.y = p.y - (dy / len) * max;
    }
    this.stickPos = p;
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerId === this.stickPointer) this.stickPointer = null;
    const a = this.buttonPointers.get(e.pointerId);
    if (a) {
      this.buttonPointers.delete(e.pointerId);
      if (![...this.buttonPointers.values()].includes(a)) this.held.delete(a);
    }
  }

  /** Draws touch controls on the UI layer (virtual coordinates). */
  render(ctx: CanvasRenderingContext2D): void {
    if (!this.touchMode) return;
    ctx.save();
    if (this.stickPointer !== null) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(this.stickOrigin.x, this.stickOrigin.y, STICK_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      const m = this.move();
      ctx.beginPath();
      ctx.arc(this.stickOrigin.x + m.x * STICK_RADIUS, this.stickOrigin.y + m.y * STICK_RADIUS, 12, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Hint where the joystick lives.
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(52, this.display.height - 52, STICK_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const b of BUTTONS) {
      const c = this.buttonCenter(b);
      const down = this.held.has(b.action);
      ctx.globalAlpha = down ? 0.65 : 0.38;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(c.x, c.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#1c1a24";
      ctx.font = `bold ${Math.round(b.r * 0.9)}px sans-serif`;
      ctx.fillText(b.label, c.x, c.y + 1);
    }
    ctx.restore();
  }
}
