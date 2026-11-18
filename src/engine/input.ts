import type { Display } from "./display";
import { Gamepads, padSettings, type PadButton, type PadState } from "./gamepad";

export type Action = "confirm" | "cancel" | "menu";
export type NavDir = "up" | "down" | "left" | "right";

const NAV_REPEAT_DELAY = 0.35;
const NAV_REPEAT_RATE = 0.11;
const STEP = 1 / 60;

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

const PAD_DIRS: PadButton[] = ["up", "down", "left", "right"];

function padAction(b: PadButton): Action | null {
  const swap = padSettings.swapConfirmCancel;
  if (b === "a") return swap ? "cancel" : "confirm";
  if (b === "b") return swap ? "confirm" : "cancel";
  if (b === "start" || b === "y") return "menu";
  return null;
}

interface TouchButton {
  action: Action;
  label: string;
  /** Position relative to the bottom-right corner, in UI units. */
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
/** A touch that moves less than this (virtual px) and lifts quickly is a tap, not a joystick drag. */
const TAP_SLOP = 6;
const TAP_MAX_TIME = 350;
const STICK_DEADZONE = 0.18;

/**
 * Unified input: keyboard, game controllers, and for touch devices a floating
 * virtual joystick (left half of the screen) plus on-screen buttons.
 */
export class Input {
  private keysDown = new Set<string>();
  private held = new Set<Action>();
  private pressedThisFrame = new Set<Action>();
  /** Discrete presses (keys and touch buttons) in the order they happened; one is handled per step. */
  private events: (Action | NavDir)[] = [];

  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickPos = { x: 0, y: 0 };
  private stickStart = { x: 0, y: 0, time: 0, moved: 0 };
  private buttonPointers = new Map<number, Action>();

  private gamepads = new Gamepads();
  private pad: PadState = { buttons: new Set(), x: 0, y: 0 };

  private queuedTaps: { x: number; y: number }[] = [];
  /** Screen taps / clicks this update step, in UI units. */
  taps: { x: number; y: number }[] = [];

  private navDir: NavDir | null = null;
  private navTimer = 0;
  private navFired: NavDir | null = null;

  /** Touch controls are drawn once a touch has been seen. */
  touchMode = false;
  /** On-screen joystick and buttons. Scenes driven by tapping (battles) turn it off; taps still register. */
  virtualPad = true;

  constructor(private display: Display, target: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (KEY_DIRS[e.code] || KEY_ACTIONS[e.code]) e.preventDefault();
      if (e.repeat) return;
      this.keysDown.add(e.code);
      const d = KEY_DIRS[e.code];
      if (d) this.events.push(d[0] < 0 ? "left" : d[0] > 0 ? "right" : d[1] < 0 ? "up" : "down");
      const a = KEY_ACTIONS[e.code];
      if (a) this.events.push(a);
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
    this.pollGamepad();
    // Handle one queued press per step, so quick sequences like "down, down, A" keep their order.
    const ev = this.events.shift();
    this.pressedThisFrame = new Set();
    let navEvent: NavDir | undefined;
    if (ev === "up" || ev === "down" || ev === "left" || ev === "right") navEvent = ev;
    else if (ev) this.pressedThisFrame.add(ev);
    this.taps = this.queuedTaps;
    this.queuedTaps = [];
    this.updateNav(navEvent);
  }

  private pollGamepad(): void {
    const prev = this.pad.buttons;
    this.pad = this.gamepads.poll();
    let used = this.pad.x !== 0 || this.pad.y !== 0;
    for (const b of this.pad.buttons) {
      if (prev.has(b)) continue;
      used = true;
      if ((PAD_DIRS as string[]).includes(b)) this.events.push(b as NavDir);
      const a = padAction(b);
      if (a) this.events.push(a);
    }
    // Playing with a controller hides the on-screen touch controls (touching the screen brings them back).
    if (used) this.touchMode = false;
  }

  /** Menu navigation: fires once on press, then repeats while held (keys or joystick). */
  nav(): NavDir | null {
    return this.navFired;
  }

  private updateNav(queued?: NavDir): void {
    const m = this.move();
    let dir: NavDir | null = null;
    if (Math.hypot(m.x, m.y) > 0.5) {
      if (Math.abs(m.x) > Math.abs(m.y)) dir = m.x < 0 ? "left" : "right";
      else dir = m.y < 0 ? "up" : "down";
    }
    this.navFired = null;
    if (queued) {
      // One queued key press per step, so quick sequences like "down, right" both count.
      this.navFired = queued;
      this.navDir = dir ?? queued;
      this.navTimer = NAV_REPEAT_DELAY;
    } else if (dir !== this.navDir) {
      this.navDir = dir;
      this.navTimer = NAV_REPEAT_DELAY;
      this.navFired = dir;
    } else if (dir) {
      this.navTimer -= STEP;
      if (this.navTimer <= 0) {
        this.navTimer = NAV_REPEAT_RATE;
        this.navFired = dir;
      }
    }
  }

  /** True only on the update step the action was pressed. */
  pressed(action: Action): boolean {
    return this.pressedThisFrame.has(action);
  }

  isHeld(action: Action): boolean {
    if (this.held.has(action)) return true;
    for (const [code, a] of Object.entries(KEY_ACTIONS)) if (a === action && this.keysDown.has(code)) return true;
    for (const b of this.pad.buttons) if (padAction(b) === action) return true;
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
    // Controller analog stick
    if (this.pad.x !== 0 || this.pad.y !== 0) return { x: this.pad.x, y: this.pad.y };
    // Keyboard and controller D-pad
    let x = 0, y = 0;
    for (const code of this.keysDown) {
      const d = KEY_DIRS[code];
      if (d) { x += d[0]; y += d[1]; }
    }
    const pb = this.pad.buttons;
    x += (pb.has("right") ? 1 : 0) - (pb.has("left") ? 1 : 0);
    y += (pb.has("down") ? 1 : 0) - (pb.has("up") ? 1 : 0);
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
    this.navDir = null;
    this.events = [];
  }

  private buttonCenter(b: TouchButton): { x: number; y: number } {
    return { x: this.display.uiWidth - b.dx, y: this.display.uiHeight - b.dy };
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType === "touch") this.touchMode = true;
    e.preventDefault();
    const p = this.display.toUi(e.clientX, e.clientY);
    if (e.pointerType === "mouse" && !this.touchMode) {
      this.queuedTaps.push(p);
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (this.virtualPad) for (const b of BUTTONS) {
      const c = this.buttonCenter(b);
      if (Math.hypot(p.x - c.x, p.y - c.y) <= b.r + 6) {
        this.buttonPointers.set(e.pointerId, b.action);
        this.held.add(b.action);
        this.events.push(b.action);
        return;
      }
    }
    if (this.virtualPad && p.x < this.display.uiWidth * 0.55 && this.stickPointer === null) {
      // Joystick side: becomes a tap only if released without dragging (see onPointerUp).
      this.stickPointer = e.pointerId;
      this.stickOrigin = p;
      this.stickPos = p;
      this.stickStart = { x: p.x, y: p.y, time: performance.now(), moved: 0 };
      return;
    }
    this.queuedTaps.push(p);
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickPointer) return;
    const p = this.display.toUi(e.clientX, e.clientY);
    this.stickStart.moved = Math.max(this.stickStart.moved, Math.hypot(p.x - this.stickStart.x, p.y - this.stickStart.y));
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
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = null;
      const s = this.stickStart;
      if (s.moved < TAP_SLOP && performance.now() - s.time < TAP_MAX_TIME) this.queuedTaps.push({ x: s.x, y: s.y });
    }
    const a = this.buttonPointers.get(e.pointerId);
    if (a) {
      this.buttonPointers.delete(e.pointerId);
      if (![...this.buttonPointers.values()].includes(a)) this.held.delete(a);
    }
  }

  /** Draws touch controls on the UI layer (UI units). */
  render(ctx: CanvasRenderingContext2D): void {
    if (!this.touchMode || !this.virtualPad) return;
    ctx.save();
    if (this.stickPointer !== null) {
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(this.stickOrigin.x, this.stickOrigin.y, STICK_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.38;
      const m = this.move();
      ctx.beginPath();
      ctx.arc(this.stickOrigin.x + m.x * STICK_RADIUS, this.stickOrigin.y + m.y * STICK_RADIUS, 12, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.virtualPad) {
      // Hint where the joystick lives.
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(52, this.display.uiHeight - 52, STICK_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const b of BUTTONS) {
      const c = this.buttonCenter(b);
      const down = this.held.has(b.action);
      ctx.globalAlpha = down ? 0.42 : 0.18;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(c.x, c.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = down ? 0.8 : 0.5;
      ctx.fillStyle = "#1c1a24";
      ctx.font = `bold ${Math.round(b.r * 0.9)}px sans-serif`;
      ctx.fillText(b.label, c.x, c.y + 1);
    }
    ctx.restore();
  }
}
