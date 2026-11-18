import type { TileMap } from "./tilemap";

export interface Body {
  /** Top-left of the collision box, in world pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** How far the body may be nudged sideways to slip around a corner, as a fraction of a tile. */
const CORNER_ASSIST = 0.375;

/**
 * Moves a body by (dx, dy) against the map's solid tiles, one axis at a time
 * so it slides along walls. When walking straight into a corner that is only
 * slightly in the way, the body is nudged past it (makes doorways easy to hit,
 * especially with a touch joystick).
 * `blockers` are extra solid rectangles that aren't tiles (e.g. enemies on the map).
 */
export function moveAndCollide(map: TileMap, b: Body, dx: number, dy: number, blockers: Rect[] = []): { hitX: boolean; hitY: boolean } {
  const blocked = (x: number, y: number) => blockers.some((r) => overlaps({ x, y, w: b.w, h: b.h }, r));
  const hitX = dx !== 0 && !stepAxis(map, b, dx, 0, blocked);
  const hitY = dy !== 0 && !stepAxis(map, b, 0, dy, blocked);
  const reach = Math.round(CORNER_ASSIST * map.tileW);
  if (hitX && dy === 0) cornerAssist(map, b, 0, 1, Math.abs(dx), dx, reach, blocked);
  if (hitY && dx === 0) cornerAssist(map, b, 1, 0, Math.abs(dy), dy, reach, blocked);
  return { hitX, hitY };
}

/** Returns true if the full move happened. */
function stepAxis(map: TileMap, b: Body, dx: number, dy: number, blocked: (x: number, y: number) => boolean): boolean {
  const nx = b.x + dx, ny = b.y + dy;
  const tileHit = map.rectHitsSolid(nx, ny, b.w, b.h);
  if (!tileHit && !blocked(nx, ny)) {
    b.x = nx;
    b.y = ny;
    return true;
  }
  if (!tileHit) return false; // blocked by an object: just don't move
  // Snap flush against the blocking tile edge.
  if (dx > 0) b.x = Math.floor((nx + b.w) / map.tileW) * map.tileW - b.w;
  else if (dx < 0) b.x = Math.ceil(nx / map.tileW) * map.tileW;
  if (dy > 0) b.y = Math.floor((ny + b.h) / map.tileH) * map.tileH - b.h;
  else if (dy < 0) b.y = Math.ceil(ny / map.tileH) * map.tileH;
  return false;
}

function cornerAssist(
  map: TileMap, b: Body, ax: number, ay: number, speed: number, dir: number, reach: number,
  blocked: (x: number, y: number) => boolean,
): void {
  const free = (x: number, y: number) => !map.rectHitsSolid(x, y, b.w, b.h) && !blocked(x, y);
  const mx = ax === 0 ? Math.sign(dir) : 0;
  const my = ay === 0 ? Math.sign(dir) : 0;
  for (let off = 1; off <= reach; off++) {
    for (const s of [-1, 1]) {
      const ox = ax * off * s, oy = ay * off * s;
      // Free to shift sideways AND then continue forward from there?
      if (free(b.x + ox, b.y + oy) && free(b.x + ox + mx, b.y + oy + my)) {
        const step = Math.min(speed, off);
        b.x += ax * step * s;
        b.y += ay * step * s;
        return;
      }
    }
  }
}
