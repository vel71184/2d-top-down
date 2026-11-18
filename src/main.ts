import { assetUrl } from "./engine/assets";
import { Game } from "./engine/game";
import { SpriteSheet } from "./engine/sprite";
import type { RPG } from "./game/context";
import { loadDatabase } from "./game/data";
import { startNewGame, START_MAP, START_SPAWN, toTitle } from "./game/flow";
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

  // Testing options (these skip the title screen and start a new game):
  //   ?map=house&spawn=entrance   start on a specific map / spawn point
  //   ?battle=slime,bat           start straight into a battle
  //   ?debug                      show collision boxes and FPS
  const params = new URLSearchParams(location.search);
  const battle = params.get("battle");
  if (params.has("map") || battle) {
    const overworld = await startNewGame(rpg, params.get("map") ?? START_MAP, params.get("spawn") ?? START_SPAWN);
    if (battle) overworld.startBattle(battle.split(","));
  } else {
    await toTitle(rpg);
  }
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
