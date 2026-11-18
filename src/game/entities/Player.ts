import type { Camera } from "../../engine/camera";
import type { Input } from "../../engine/input";
import { moveAndCollide, type Body, type Rect } from "../../engine/physics";
import type { Direction, SpriteSheet } from "../../engine/sprite";
import type { TileMap } from "../../engine/tilemap";

// Sizes are in tiles, so the player works with any tile size (16px, 32px, ...).
const SPEED = 5.125; // tiles per second at full joystick tilt
const BODY_W = 0.625; // collision box at the feet, as a fraction of a tile
const BODY_H = 0.375;
const REACH = 0.875; // how far in front the player can talk to things

/** The character you control on the map. Collision box is a small rectangle at the feet. */
export class Player {
  readonly body: Body = { x: 0, y: 0, w: 0, h: 0 };
  private tile = 16;
  facing: Direction = "down";
  private walkTime = 0;
  /** Distance walked since last reset (used later for random encounters). */
  distance = 0;

  constructor(private sprite: SpriteSheet) {}

  /** Centre of the collision box. */
  get cx(): number {
    return this.body.x + this.body.w / 2;
  }
  get cy(): number {
    return this.body.y + this.body.h / 2;
  }

  /** The point placeAt() would need to put the player back exactly here (for saving). */
  get anchor(): { x: number; y: number } {
    return { x: this.cx, y: this.body.y + this.body.h + Math.max(1, this.tile / 16) - this.tile / 2 };
  }

  /** Places the player on the tile centred on (x, y), feet near the bottom of the tile. */
  placeAt(x: number, y: number, tileSize: number, facing?: Direction): void {
    this.tile = tileSize;
    this.body.w = Math.round(tileSize * BODY_W);
    this.body.h = Math.round(tileSize * BODY_H);
    this.body.x = x - this.body.w / 2;
    this.body.y = y + tileSize / 2 - this.body.h - Math.max(1, tileSize / 16);
    if (facing) this.facing = facing;
    this.walkTime = 0;
  }

  update(dt: number, input: Input, map: TileMap, blockers: Rect[] = []): void {
    const m = input.move();
    const moving = m.x !== 0 || m.y !== 0;
    if (moving) {
      if (Math.abs(m.x) > Math.abs(m.y) + 0.05) this.facing = m.x < 0 ? "left" : "right";
      else if (Math.abs(m.y) > Math.abs(m.x) + 0.05) this.facing = m.y < 0 ? "up" : "down";
      const bx = this.body.x, by = this.body.y;
      const speed = SPEED * map.tileW;
      moveAndCollide(map, this.body, m.x * speed * dt, m.y * speed * dt, blockers);
      const moved = Math.hypot(this.body.x - bx, this.body.y - by);
      this.distance += moved;
      this.walkTime = moved > 0.01 ? this.walkTime + dt * Math.max(0.5, Math.hypot(m.x, m.y)) : 0;
    } else {
      this.walkTime = 0;
    }
  }

  /** World point just in front of the player (for talking to things). */
  facingPoint(reach = REACH * this.tile): { x: number; y: number } {
    const d = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[this.facing];
    return { x: this.cx + d[0] * reach, y: this.cy + d[1] * reach };
  }

  render(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const fw = this.sprite.frameW, fh = this.sprite.frameH;
    const x = Math.round(this.cx - fw / 2 - cam.x);
    const y = Math.round(this.body.y + this.body.h + Math.max(1, this.tile / 16) - fh - cam.y);
    this.sprite.draw(ctx, this.facing, this.walkTime, x, y);
  }
}
