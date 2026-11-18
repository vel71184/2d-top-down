import type { Camera } from "../../engine/camera";
import type { Input } from "../../engine/input";
import { moveAndCollide, type Body } from "../../engine/physics";
import type { Direction, SpriteSheet } from "../../engine/sprite";
import type { TileMap } from "../../engine/tilemap";

const SPEED = 82; // pixels per second at full joystick tilt

/** The character you control on the map. Collision box is a small rectangle at the feet. */
export class Player {
  readonly body: Body = { x: 0, y: 0, w: 10, h: 6 };
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

  /** Places the player so their sprite fills the 16x16 tile centred on (x, y). */
  placeAt(x: number, y: number, facing?: Direction): void {
    this.body.x = x - this.body.w / 2;
    this.body.y = y + 8 - this.body.h - 1;
    if (facing) this.facing = facing;
    this.walkTime = 0;
  }

  update(dt: number, input: Input, map: TileMap): void {
    const m = input.move();
    const moving = m.x !== 0 || m.y !== 0;
    if (moving) {
      if (Math.abs(m.x) > Math.abs(m.y) + 0.05) this.facing = m.x < 0 ? "left" : "right";
      else if (Math.abs(m.y) > Math.abs(m.x) + 0.05) this.facing = m.y < 0 ? "up" : "down";
      const bx = this.body.x, by = this.body.y;
      moveAndCollide(map, this.body, m.x * SPEED * dt, m.y * SPEED * dt);
      const moved = Math.hypot(this.body.x - bx, this.body.y - by);
      this.distance += moved;
      this.walkTime = moved > 0.01 ? this.walkTime + dt * Math.max(0.5, Math.hypot(m.x, m.y)) : 0;
    } else {
      this.walkTime = 0;
    }
  }

  /** World point just in front of the player (for talking to things). */
  facingPoint(reach = 14): { x: number; y: number } {
    const d = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[this.facing];
    return { x: this.cx + d[0] * reach, y: this.cy + d[1] * reach };
  }

  render(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const fw = this.sprite.frameW, fh = this.sprite.frameH;
    const x = Math.round(this.cx - fw / 2 - cam.x);
    const y = Math.round(this.body.y + this.body.h + 1 - fh - cam.y);
    this.sprite.draw(ctx, this.facing, this.walkTime, x, y);
  }
}
