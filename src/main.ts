import { assetUrl } from "./engine/assets";
import { Game } from "./engine/game";
import { SpriteSheet } from "./engine/sprite";
import type { RPG } from "./game/context";
import { loadDatabase } from "./game/data";
import { OverworldScene } from "./game/scenes/OverworldScene";
import { loadSettings } from "./game/settings";
import { GameState } from "./game/state";

async function boot(): Promise<void> {
  const game = new Game(
    document.getElementById("world") as HTMLCanvasElement,
    document.getElementById("ui") as HTMLCanvasElement,
  );

  loadSettings();
  const db = await loadDatabase();
  const state = GameState.newGame(db);
  const sprites = new Map<string, SpriteSheet>();
  await Promise.all(
    Object.values(db.characters).map(async (c) => {
      sprites.set(c.sprite, await SpriteSheet.load(assetUrl(`assets/sprites/${c.sprite}.json`)));
    }),
  );
  const rpg: RPG = { game, db, state, sprites };

  // Testing options:
  //   ?map=house&spawn=entrance   start on a specific map / spawn point
  //   ?battle=slime,bat           start straight into a battle
  //   ?debug                      show collision boxes and FPS
  const params = new URLSearchParams(location.search);
  const overworld = new OverworldScene(rpg, params.get("map") ?? "town", params.get("spawn") ?? "start");
  await game.scenes.push(overworld);
  const battle = params.get("battle");
  if (battle) overworld.startBattle(battle.split(","));
  game.start();

  // Exposed for automated testing / poking around in the browser console with ?debug.
  if (game.debug) Object.assign(window, { rpg, game });
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<pre style="position:fixed;inset:0;color:#f88;padding:16px;white-space:pre-wrap">Failed to start: ${String(e)}</pre>`,
  );
});
