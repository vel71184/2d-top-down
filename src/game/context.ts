import type { Game } from "../engine/game";
import type { SpriteSheet } from "../engine/sprite";
import type { Database } from "./data";
import type { GameState } from "./state";

/** Shared game-wide objects handed to every scene. */
export interface RPG {
  game: Game;
  db: Database;
  state: GameState;
  /** Character sprite sheets by name (preloaded for every character in the data). */
  sprites: Map<string, SpriteSheet>;
}
