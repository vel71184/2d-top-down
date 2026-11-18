import type { Input } from "../../engine/input";
import { COLORS, drawPanel, font } from "./theme";

export interface MenuItem {
  label: string;
  /** Right-aligned extra text, e.g. MP cost or item count. */
  right?: string;
  disabled?: boolean;
  /** Shown in a help line while the cursor is on this item. */
  help?: string;
}

export type MenuResult = { type: "select"; index: number } | { type: "cancel" } | null;

/**
 * A grid/list of choices inside a panel. Works with keys / joystick
 * (move the cursor, confirm), and optionally with taps (tap an item to pick it).
 * Moving the cursor past the visible rows scrolls the list.
 */
export class Menu {
  cursor = 0;
  private scroll = 0; // first visible row

  constructor(
    public items: MenuItem[],
    public x: number,
    public y: number,
    public w: number,
    public h: number,
    public cols = 1,
    public rowH = 20,
  ) {}

  private get rows(): number {
    return Math.ceil(this.items.length / this.cols);
  }
  private get visibleRows(): number {
    return Math.max(1, Math.floor((this.h - 8) / this.rowH));
  }
  get current(): MenuItem | undefined {
    return this.items[this.cursor];
  }

  /** `allowTaps`: false for menus driven only by the joystick / D-pad and buttons (battles). */
  update(input: Input, allowTaps = true): MenuResult {
    const n = this.items.length;
    if (input.pressed("cancel")) return { type: "cancel" };

    for (const t of allowTaps ? input.taps : []) {
      if (t.x < this.x || t.x > this.x + this.w || t.y < this.y || t.y > this.y + this.h) continue;
      // scroll arrows
      if (t.x > this.x + this.w - 16 && this.rows > this.visibleRows) {
        if (t.y < this.y + this.h / 2) this.scroll = Math.max(0, this.scroll - 1);
        else this.scroll = Math.min(this.rows - this.visibleRows, this.scroll + 1);
        this.cursor = Math.min(n - 1, this.scroll * this.cols);
        return null;
      }
      const col = Math.floor((t.x - this.x - 4) / this.colW());
      const row = Math.floor((t.y - this.y - 4) / this.rowH) + this.scroll;
      const i = row * this.cols + col;
      if (col >= 0 && col < this.cols && i >= 0 && i < n) {
        this.cursor = i;
        if (!this.items[i].disabled) return { type: "select", index: i };
      }
      return null;
    }

    if (n === 0) return null;
    switch (input.nav()) {
      case "up": {
        let c = this.cursor - this.cols;
        if (c < 0) {
          // wrap to the bottom of the same column
          c = (this.rows - 1) * this.cols + (this.cursor % this.cols);
          if (c >= n) c -= this.cols;
        }
        this.cursor = Math.max(0, c);
        break;
      }
      case "down": {
        const c = this.cursor + this.cols;
        this.cursor = c < n ? c : this.cursor % this.cols;
        break;
      }
      case "left": if (this.cols > 1) this.cursor = this.cursor % this.cols === 0 ? this.cursor + this.cols - 1 : this.cursor - 1; break;
      case "right": if (this.cols > 1) this.cursor = this.cursor % this.cols === this.cols - 1 ? this.cursor - this.cols + 1 : this.cursor + 1; break;
    }
    if (this.cursor >= n) this.cursor = n - 1;
    const row = Math.floor(this.cursor / this.cols);
    if (row < this.scroll) this.scroll = row;
    if (row >= this.scroll + this.visibleRows) this.scroll = row - this.visibleRows + 1;

    if (input.pressed("confirm") && !this.items[this.cursor]?.disabled) return { type: "select", index: this.cursor };
    return null;
  }

  private colW(): number {
    return (this.w - 8 - (this.rows > this.visibleRows ? 12 : 0)) / this.cols;
  }

  render(ctx: CanvasRenderingContext2D, active = true): void {
    drawPanel(ctx, this.x, this.y, this.w, this.h);
    ctx.save();
    ctx.textBaseline = "middle";
    const cw = this.colW();
    for (let r = 0; r < this.visibleRows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = (r + this.scroll) * this.cols + c;
        const item = this.items[i];
        if (!item) continue;
        const ix = this.x + 4 + c * cw;
        const iy = this.y + 4 + r * this.rowH;
        if (i === this.cursor && active) {
          ctx.fillStyle = COLORS.cursor;
          ctx.fillRect(ix, iy + 1, cw - 2, this.rowH - 2);
          ctx.fillStyle = COLORS.accent;
          ctx.font = font(9);
          ctx.textAlign = "left";
          ctx.fillText("▶", ix + 2, iy + this.rowH / 2);
        }
        ctx.font = font(11);
        ctx.fillStyle = item.disabled ? COLORS.dim : COLORS.text;
        ctx.textAlign = "left";
        ctx.fillText(item.label, ix + 13, iy + this.rowH / 2);
        if (item.right) {
          ctx.textAlign = "right";
          ctx.font = font(10);
          ctx.fillStyle = item.disabled ? COLORS.dim : COLORS.accent;
          ctx.fillText(item.right, ix + cw - 6, iy + this.rowH / 2);
        }
      }
    }
    if (this.rows > this.visibleRows) {
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = "center";
      ctx.font = font(9);
      const ax = this.x + this.w - 9;
      ctx.globalAlpha = this.scroll > 0 ? 1 : 0.25;
      ctx.fillText("▲", ax, this.y + 12);
      ctx.globalAlpha = this.scroll + this.visibleRows < this.rows ? 1 : 0.25;
      ctx.fillText("▼", ax, this.y + this.h - 10);
    }
    ctx.restore();
  }
}
