import type { RPG } from "./context";
import { loadState, type SaveData } from "./save";
import { OverworldScene } from "./scenes/OverworldScene";
import { TitleScene } from "./scenes/TitleScene";
import { GameState } from "./state";

/** Moving between the big parts of the game: title screen, new game, loading a save. */

export const START_MAP = "town";
export const START_SPAWN = "start";

export async function toTitle(rpg: RPG): Promise<void> {
  rpg.game.scenes.clear();
  rpg.game.input.reset();
  await rpg.game.scenes.push(new TitleScene(rpg));
}

export async function startNewGame(rpg: RPG, map = START_MAP, spawn = START_SPAWN): Promise<OverworldScene> {
  rpg.state = GameState.newGame(rpg.db);
  rpg.game.scenes.clear();
  rpg.game.input.reset();
  const ow = new OverworldScene(rpg, map, spawn);
  await rpg.game.scenes.push(ow);
  return ow;
}

export async function continueFromSave(rpg: RPG, data: SaveData): Promise<void> {
  rpg.state = loadState(rpg.db, data);
  rpg.game.scenes.clear();
  rpg.game.input.reset();
  await rpg.game.scenes.push(new OverworldScene(rpg, data.map, "", { x: data.x, y: data.y, facing: data.facing }));
}
