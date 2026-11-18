import { Scene } from "../../engine/scene";
import type { RPG } from "../context";
import { toTitle } from "../flow";
import { COLORS, font } from "../ui/theme";

/** Shown when the whole party falls. Returns to the title screen. */
export class GameOverScene extends Scene {
  private t = 0;
  private leaving = false;

  constructor(private rpg: RPG) {
    super(rpg.game);
  }

  enter(): void {
    this.game.input.reset();
  }

  update(dt: number): void {
    this.t += dt;
    const input = this.game.input;
    if (this.t > 1 && !this.leaving && (input.pressed("confirm") || input.pressed("cancel"))) {
      this.leaving = true;
      void toTitle(this.rpg);
    }
  }

  render(world: CanvasRenderingContext2D, ui: CanvasRenderingContext2D): void {
    const d = this.game.display;
    world.fillStyle = "#000";
    world.fillRect(0, 0, d.width, d.height);
    const a = Math.min(1, this.t / 1.2);
    ui.globalAlpha = a;
    ui.textAlign = "center";
    ui.textBaseline = "middle";
    ui.font = font(26, true);
    ui.fillStyle = "#c83a3a";
    ui.fillText("GAME OVER", d.uiWidth / 2, d.uiHeight / 2 - 12);
    if (this.t > 1 && Math.floor(this.t * 2) % 2 === 0) {
      ui.font = font(10);
      ui.fillStyle = COLORS.dim;
      ui.fillText("Press A to return to the title screen", d.uiWidth / 2, d.uiHeight / 2 + 20);
    }
    ui.globalAlpha = 1;
  }
}
