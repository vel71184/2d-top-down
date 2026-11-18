import { assetUrl } from "./engine/assets";
import { Game } from "./engine/game";
import { SpriteSheet } from "./engine/sprite";
import { OverworldScene } from "./game/scenes/OverworldScene";

async function boot(): Promise<void> {
  const game = new Game(
    document.getElementById("world") as HTMLCanvasElement,
    document.getElementById("ui") as HTMLCanvasElement,
  );

  // Handy for testing your own maps: ?map=house&spawn=entrance (add &debug to see collision).
  const params = new URLSearchParams(location.search);
  const startMap = params.get("map") ?? "town";
  const startSpawn = params.get("spawn") ?? "start";

  const hero = await SpriteSheet.load(assetUrl("assets/sprites/hero.json"));
  await game.scenes.push(new OverworldScene(game, hero, startMap, startSpawn));
  game.start();
  // Exposed for automated testing / poking around in the browser console with ?debug.
  if (game.debug) (window as unknown as { game: Game }).game = game;
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<pre style="position:fixed;inset:0;color:#f88;padding:16px;white-space:pre-wrap">Failed to start: ${String(e)}</pre>`,
  );
});
