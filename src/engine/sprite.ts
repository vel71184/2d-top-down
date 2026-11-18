import { loadImage, loadJson } from "./assets";

export type Direction = "down" | "left" | "right" | "up";

/** JSON description of a character sprite sheet (see public/assets/sprites/hero.json). */
interface SpriteSheetData {
  image: string;
  frameWidth: number;
  frameHeight: number;
  /** Which row of the sheet holds each facing direction. */
  rows: Record<Direction, number>;
  /** Column indices that make up the walk cycle. The first one is the standing pose. */
  walkFrames: number[];
  walkFps: number;
}

/** A character sheet: one row per direction, columns are animation frames. */
export class SpriteSheet {
  private constructor(readonly data: SpriteSheetData, readonly image: HTMLImageElement) {}

  static async load(url: string): Promise<SpriteSheet> {
    const data = await loadJson<SpriteSheetData>(url);
    const image = await loadImage(new URL(data.image, url).href);
    return new SpriteSheet(data, image);
  }

  get frameW(): number {
    return this.data.frameWidth;
  }
  get frameH(): number {
    return this.data.frameHeight;
  }

  /** Draws the frame for `dir` with its top-left at (x, y); `walkTime` in seconds (0 = standing). */
  draw(ctx: CanvasRenderingContext2D, dir: Direction, walkTime: number, x: number, y: number, scale = 1): void {
    const d = this.data;
    const frames = d.walkFrames;
    const col = walkTime > 0 ? frames[Math.floor(walkTime * d.walkFps) % frames.length] : frames[0];
    ctx.drawImage(this.image, col * d.frameWidth, d.rows[dir] * d.frameHeight, d.frameWidth, d.frameHeight, x, y, d.frameWidth * scale, d.frameHeight * scale);
  }
}
