/** Shared look for all UI panels and text. */
export const FONT_FAMILY = `"Trebuchet MS", "Segoe UI", sans-serif`;

export const COLORS = {
  panel: "rgba(16, 20, 48, 0.92)",
  border: "#e8e8f0",
  text: "#ffffff",
  dim: "#8a8fa8",
  accent: "#ffd75e",
  cursor: "rgba(255, 215, 94, 0.22)",
  hp: "#7be07b",
  hpLow: "#ff6a5a",
  mp: "#7ab8ff",
  atb: "#e8e8f0",
  atbFull: "#ffd75e",
  damage: "#ffffff",
  heal: "#7be07b",
};

export function font(size: number, bold = false): string {
  return `${bold ? "bold " : ""}${size}px ${FONT_FAMILY}`;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.fillStyle = COLORS.panel;
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Text with a dark outline, readable over any background. */
export function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
