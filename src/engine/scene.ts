import type { Game } from "./game";

/**
 * A screen of the game (overworld, battle, menu...). Scenes live on a stack:
 * a battle can be pushed on top of the overworld and popped when it ends,
 * leaving the overworld exactly as it was.
 */
export abstract class Scene {
  constructor(protected game: Game) {}
  /** Called when the scene becomes the top of the stack for the first time. */
  enter(): void | Promise<void> {}
  /** Called when the scene is removed from the stack. */
  exit(): void {}
  abstract update(dt: number): void;
  abstract render(world: CanvasRenderingContext2D, ui: CanvasRenderingContext2D): void;
  /** If false, scenes underneath are not drawn (opaque scene). */
  transparent = false;
}

export class SceneStack {
  private stack: Scene[] = [];

  get top(): Scene | undefined {
    return this.stack[this.stack.length - 1];
  }

  async push(scene: Scene): Promise<void> {
    this.stack.push(scene);
    await scene.enter();
  }

  pop(): Scene | undefined {
    const s = this.stack.pop();
    s?.exit();
    return s;
  }

  async replace(scene: Scene): Promise<void> {
    this.pop();
    await this.push(scene);
  }

  update(dt: number): void {
    this.top?.update(dt);
  }

  render(world: CanvasRenderingContext2D, ui: CanvasRenderingContext2D): void {
    let start = this.stack.length - 1;
    while (start > 0 && this.stack[start].transparent) start--;
    for (let i = Math.max(0, start); i < this.stack.length; i++) this.stack[i].render(world, ui);
  }
}
