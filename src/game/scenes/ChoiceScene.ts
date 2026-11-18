import { Scene } from "../../engine/scene";
import type { Game } from "../../engine/game";
import { Menu } from "../ui/Menu";
import { COLORS, drawPanel, font } from "../ui/theme";

/**
 * A question with a few answers ("Stay the night for 20 gold?" Yes / No),
 * drawn over the current screen. B picks the last option (usually "No").
 */
export class ChoiceScene extends Scene {
  transparent = true;
  private menu: Menu;

  constructor(game: Game, private prompt: string, options: string[], private onChoose: (index: number) => void) {
    super(game);
    this.menu = new Menu(options.map((label) => ({ label })), 0, 0, 90, options.length * 20 + 8, 1, 20);
  }

  enter(): void {
    this.game.input.reset();
  }

  update(): void {
    const r = this.menu.update(this.game.input, false);
    if (!r) return;
    const index = r.type === "select" ? r.index : this.menu.items.length - 1;
    this.game.scenes.pop();
    this.game.input.reset();
    this.onChoose(index);
  }

  render(_world: CanvasRenderingContext2D, ui: CanvasRenderingContext2D): void {
    const W = this.game.display.uiWidth, H = this.game.display.uiHeight;
    const bw = Math.min(W - 16, 360), bh = 34;
    const bx = (W - bw) / 2, by = H - bh - 8;
    drawPanel(ui, bx, by, bw, bh);
    ui.font = font(11);
    ui.fillStyle = COLORS.text;
    ui.textAlign = "left";
    ui.textBaseline = "middle";
    ui.fillText(this.prompt, bx + 10, by + bh / 2, bw - 20);
    Object.assign(this.menu, { x: bx + bw - this.menu.w, y: by - this.menu.h - 4 });
    this.menu.render(ui);
  }
}
