import { Display } from "./display";
import { Input } from "./input";
import { SceneStack } from "./scene";

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

/** Owns the display, input, scene stack and the fixed-timestep game loop. */
export class Game {
  readonly display: Display;
  readonly input: Input;
  readonly scenes = new SceneStack();
  readonly debug = new URLSearchParams(location.search).has("debug");

  private last = 0;
  private acc = 0;
  private fps = 0;
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(worldCanvas: HTMLCanvasElement, uiCanvas: HTMLCanvasElement) {
    this.display = new Display(worldCanvas, uiCanvas);
    this.input = new Input(this.display, uiCanvas);
    // When the app goes to the background, don't try to "catch up" on return.
    document.addEventListener("visibilitychange", () => {
      this.last = performance.now();
      this.acc = 0;
    });
  }

  start(): void {
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    const elapsed = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.acc += elapsed;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.input.update();
      this.scenes.update(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;

    const d = this.display;
    d.beginFrame();
    this.scenes.render(d.world, d.ui);
    this.input.render(d.ui);
    if (this.debug) this.drawFps(elapsed);
    requestAnimationFrame(this.frame);
  };

  private drawFps(elapsed: number): void {
    this.fpsFrames++;
    this.fpsTime += elapsed;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    const u = this.display.ui;
    u.fillStyle = "#0f0";
    u.font = "8px monospace";
    u.textAlign = "left";
    u.textBaseline = "top";
    u.fillText(`${this.fps} fps`, 4, 4);
  }
}
