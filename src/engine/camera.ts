/** Follows a point and stays inside the map. Small maps are centred on screen. */
export class Camera {
  x = 0;
  y = 0;
  viewW = 0;
  viewH = 0;

  follow(targetX: number, targetY: number, viewW: number, viewH: number, worldW: number, worldH: number): void {
    this.viewW = viewW;
    this.viewH = viewH;
    this.x = worldW <= viewW ? (worldW - viewW) / 2 : clamp(targetX - viewW / 2, 0, worldW - viewW);
    this.y = worldH <= viewH ? (worldH - viewH) / 2 : clamp(targetY - viewH / 2, 0, worldH - viewH);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
