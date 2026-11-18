/**
 * Two stacked canvases:
 *  - world: low "virtual" resolution, scaled up with crisp pixels (pixel-art look)
 *  - ui:    full device resolution, so text and touch controls stay sharp
 *
 * They use different coordinate spaces:
 *  - world pixels: WORLD_HEIGHT tall. With 32px tiles, 480 shows 15 tiles top to bottom.
 *  - UI units:     always UI_HEIGHT (240) tall, so menus, text and touch controls keep
 *                  the same size whatever the world resolution is.
 * Widths follow the screen's shape.
 */
export class Display {
  /** World view height in pixels. Raise it to see more of the map, lower it to zoom in. */
  static readonly WORLD_HEIGHT = 480;
  /** Height of the UI coordinate space. */
  static readonly UI_HEIGHT = 240;

  readonly world: CanvasRenderingContext2D;
  readonly ui: CanvasRenderingContext2D;
  /** World view size in world pixels. */
  width = 0;
  height = Display.WORLD_HEIGHT;
  /** UI size in UI units. */
  uiWidth = 0;
  uiHeight = Display.UI_HEIGHT;
  /** World pixels per UI unit (2 with the defaults). */
  readonly worldScale = Display.WORLD_HEIGHT / Display.UI_HEIGHT;
  /** Device pixels per UI unit. */
  private uiScale = 1;

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
    this.uiWidth = Math.max(160, Math.round(this.uiHeight * aspect));
    this.width = this.uiWidth * this.worldScale;
    this.worldCanvas.width = this.width;
    this.worldCanvas.height = this.height;
    this.world.imageSmoothingEnabled = false;

    const dpr = window.devicePixelRatio || 1;
    this.uiCanvas.width = Math.round(cssW * dpr);
    this.uiCanvas.height = Math.round(cssH * dpr);
    this.uiScale = this.uiCanvas.width / this.uiWidth;
  }

  /** Converts a screen (CSS pixel) position into UI units. */
  toUi(clientX: number, clientY: number): { x: number; y: number } {
    return {
      x: (clientX / window.innerWidth) * this.uiWidth,
      y: (clientY / window.innerHeight) * this.uiHeight,
    };
  }

  beginFrame(): void {
    const w = this.world;
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.imageSmoothingEnabled = false;
    w.fillStyle = "#000";
    w.fillRect(0, 0, this.width, this.height);
    const u = this.ui;
    u.setTransform(1, 0, 0, 1, 0, 0);
    u.clearRect(0, 0, this.uiCanvas.width, this.uiCanvas.height);
    u.setTransform(this.uiScale, 0, 0, this.uiScale, 0, 0);
  }
}
