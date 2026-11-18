/**
 * Two stacked canvases:
 *  - world: low "virtual" resolution, scaled up with crisp pixels (pixel-art look)
 *  - ui:    full device resolution, so text and touch controls stay sharp
 * Both are drawn in the same virtual coordinate space.
 */
export class Display {
  /** Height of the game view in virtual pixels (15 tiles of 16px). Width follows the screen shape. */
  static readonly VIRTUAL_HEIGHT = 240;

  readonly world: CanvasRenderingContext2D;
  readonly ui: CanvasRenderingContext2D;
  width = 0;
  height = Display.VIRTUAL_HEIGHT;
  /** Device pixels per virtual pixel on the UI canvas. */
  uiScale = 1;

  constructor(private worldCanvas: HTMLCanvasElement, private uiCanvas: HTMLCanvasElement) {
    this.world = worldCanvas.getContext("2d")!;
    this.ui = uiCanvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const aspect = cssW / cssH;
    this.height = Display.VIRTUAL_HEIGHT;
    this.width = Math.max(160, Math.round(this.height * aspect));
    this.worldCanvas.width = this.width;
    this.worldCanvas.height = this.height;
    this.world.imageSmoothingEnabled = false;

    const dpr = window.devicePixelRatio || 1;
    this.uiCanvas.width = Math.round(cssW * dpr);
    this.uiCanvas.height = Math.round(cssH * dpr);
    this.uiScale = this.uiCanvas.width / this.width;
  }

  /** Converts a screen (CSS pixel) position into virtual coordinates. */
  toVirtual(clientX: number, clientY: number): { x: number; y: number } {
    return {
      x: (clientX / window.innerWidth) * this.width,
      y: (clientY / window.innerHeight) * this.height,
    };
  }

  beginFrame(): void {
    const w = this.world;
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.fillStyle = "#000";
    w.fillRect(0, 0, this.width, this.height);
    const u = this.ui;
    u.setTransform(1, 0, 0, 1, 0, 0);
    u.clearRect(0, 0, this.uiCanvas.width, this.uiCanvas.height);
    u.setTransform(this.uiScale, 0, 0, this.uiScale, 0, 0);
  }
}
