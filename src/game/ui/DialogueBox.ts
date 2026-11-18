import type { Input } from "../../engine/input";
import { FONT_FAMILY, roundRect } from "./theme";

const CHARS_PER_SECOND = 45;
const PAD = 8;
const FONT_SIZE = 11;
const LINE_H = 14;

/**
 * Message box at the bottom of the screen. Text types out; confirm finishes the
 * page, then advances to the next page. Pages are given as separate strings.
 */
export class DialogueBox {
  private page = 0;
  private shown = 0;
  private blink = 0;
  done = false;

  constructor(private pages: string[], private speaker?: string) {}

  update(dt: number, input: Input): void {
    const text = this.pages[this.page];
    this.blink += dt;
    if (this.shown < text.length) {
      this.shown = Math.min(text.length, this.shown + CHARS_PER_SECOND * dt * (input.isHeld("confirm") ? 3 : 1));
      if (input.pressed("confirm") || input.pressed("cancel")) this.shown = text.length;
      return;
    }
    if (input.pressed("confirm") || input.pressed("cancel")) {
      this.page++;
      this.shown = 0;
      if (this.page >= this.pages.length) this.done = true;
    }
  }

  render(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    if (this.done) return;
    const w = Math.min(viewW - 16, 360);
    const h = PAD * 2 + LINE_H * 3;
    const x = Math.round((viewW - w) / 2);
    const y = viewH - h - 8;

    ctx.save();
    ctx.fillStyle = "rgba(16, 20, 48, 0.92)";
    ctx.strokeStyle = "#e8e8f0";
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 4);
    ctx.fill();
    ctx.stroke();

    ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    if (this.speaker) {
      ctx.fillStyle = "#ffd75e";
      ctx.fillText(this.speaker, x + PAD, y - LINE_H);
    }
    ctx.fillStyle = "#fff";
    const text = this.pages[this.page].slice(0, Math.floor(this.shown));
    const lines = wrap(ctx, text, w - PAD * 2);
    lines.slice(0, 3).forEach((line, i) => ctx.fillText(line, x + PAD, y + PAD + i * LINE_H));

    if (this.shown >= this.pages[this.page].length && Math.floor(this.blink * 2.5) % 2 === 0) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      const ax = x + w - 12, ay = y + h - 10;
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + 6, ay);
      ctx.lineTo(ax + 3, ay + 4);
      ctx.fill();
    }
    ctx.restore();
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}
