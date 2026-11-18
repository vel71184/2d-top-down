import type { TileMap } from "./tilemap";

export interface Body {
  /** Top-left of the collision box, in world pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far (px) the body may be nudged sideways to slip around a corner. */
const CORNER_ASSIST = 6;

/**
 * Moves a body by (dx, dy) against the map's solid tiles, one axis at a time
 * so it slides along walls. When walking straight into a corner that is only
 * slightly in the way, the body is nudged past it (makes doorways easy to hit,
 * especially with a touch joystick).
 */
export function moveAndCollide(map: TileMap, b: Body, dx: number, dy: number): { hitX: boolean; hitY: boolean } {
  const hitX = dx !== 0 && !stepAxis(map, b, dx, 0);
  const hitY = dy !== 0 && !stepAxis(map, b, 0, dy);
  if (hitX && dy === 0) cornerAssist(map, b, 0, 1, Math.abs(dx), dx);
  if (hitY && dx === 0) cornerAssist(map, b, 1, 0, Math.abs(dy), dy);
  return { hitX, hitY };
}

/** Returns true if the full move happened. */
function stepAxis(map: TileMap, b: Body, dx: number, dy: number): boolean {
  const nx = b.x + dx, ny = b.y + dy;
  if (!map.rectHitsSolid(nx, ny, b.w, b.h)) {
    b.x = nx;
    b.y = ny;
    return true;
  }
  // Snap flush against the blocking tile edge.
  if (dx > 0) b.x = Math.floor((nx + b.w) / map.tileW) * map.tileW - b.w;
  else if (dx < 0) b.x = Math.ceil(nx / map.tileW) * map.tileW;
  if (dy > 0) b.y = Math.floor((ny + b.h) / map.tileH) * map.tileH - b.h;
  else if (dy < 0) b.y = Math.ceil(ny / map.tileH) * map.tileH;
  return false;
}

function cornerAssist(map: TileMap, b: Body, ax: number, ay: number, speed: number, dir: number): void {
  const mx = ax === 0 ? Math.sign(dir) : 0;
  const my = ay === 0 ? Math.sign(dir) : 0;
  for (let off = 1; off <= CORNER_ASSIST; off++) {
    for (const s of [-1, 1]) {
      const ox = ax * off * s, oy = ay * off * s;
      // Free to shift sideways AND then continue forward from there?
      if (!map.rectHitsSolid(b.x + ox, b.y + oy, b.w, b.h) && !map.rectHitsSolid(b.x + ox + mx, b.y + oy + my, b.w, b.h)) {
        const step = Math.min(speed, off);
        b.x += ax * step * s;
        b.y += ay * step * s;
        return;
      }
    }
  }
}
