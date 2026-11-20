# Top-Down RPG (working title)

A top-down adventure RPG for Android, with exploration and party-based turn-based battles.
It's written in TypeScript with HTML5 Canvas and wrapped as an Android app with [Capacitor](https://capacitorjs.com).

**Status:** stage 4 of 5. Explore maps, fight random encounters and visible enemies in turn-based battles, level up, buy and equip gear, rest at the inn, and save your progress.

## Running it

```bash
npm install
npm run dev        # open the printed URL; use --host URL to try it on your phone over Wi-Fi
```

Controls:
- **Phone:** drag anywhere on the left side for the joystick. **A** confirms or interacts, **B** cancels, **☰** opens the menu (menu comes in a later stage). In battle, use the joystick to move the cursor (long lists scroll as you go), **A** to confirm and **B** to go back. Battle menus don't respond to taps.
- **Keyboard:** WASD or arrow keys to move or pick from menus. Space, Enter, Z or E to confirm or interact. Esc or X to cancel.
- **Controller** (8BitDo, Xbox, PlayStation, etc.): left stick or D-pad to move and pick from menus. The **bottom** face button confirms or interacts, the **right** one cancels, and **Start** or the **top** button opens the menu. On-screen touch controls hide while you use a controller and come back when you touch the screen.
  - Buttons are matched by position, not label. On an 8BitDo with Nintendo-style labels, the bottom button (printed "B") confirms. If you'd rather the right-hand button confirm, add `?nintendo` to the URL in a browser, or set `padSettings.swapConfirmCancel` in `src/engine/gamepad.ts` for the app.
  - On Android, pair the controller over Bluetooth first. X-input mode (8BitDo: hold **X** while turning it on) is the most widely supported.

Useful URL options:
- `?map=house&spawn=entrance` starts on a specific map and spawn point.
- `?battle=slime,bat,goblin` starts straight into a battle.
- `?noencounters` turns random encounters off (handy while testing maps).
- `?debug` shows collision (red), objects (blue) and FPS.

## Getting it on your phone

Every push to GitHub builds an installable APK:

1. Open the repo on GitHub → **Actions** → the latest **Android APK** run.
2. Download the `top-down-rpg-debug-apk` artifact (a zip) and unzip it to get `app-debug.apk`.
3. Copy it to your phone and open it. Android will ask you to allow installing from that source the first time.

To build it locally instead, install Android Studio, then run `npm run android:sync` and open the `android/` folder in Android Studio.

## Menu

The game starts on a title screen: **Continue** (most recent save), **New Game** or **Load Game**.

Press **☰** (top-right), **Start** or **Y** (top face button) while walking around:
- **Items:** use Potions, Ethers and Revive Tonics on your party.
- **Equip:** change weapon, armor and accessory. Stat changes are previewed (green up, red down).
- **Status:** level, XP to the next level, stats, equipment and skills.
- **Settings:** battle gauges (Wait or Active), and which controller button confirms. Settings are remembered on the device.
- **Save:** 3 slots, saved on the device. You can save anywhere. Saves survive app updates, but uninstalling the app deletes them.

If the whole party falls in battle, it's **Game Over** and you return to the title screen, so save often.

## Secrets in the sample maps

- **House back wall,** just above the innkeeper: face it and press A three times without moving. A door opens to a hidden cellar. It relocks once you leave the house.
- **Cellar:** the **Debug Merchant** sells every item and piece of equipment in the game for free, for testing. Remove it from `cellar.tmj` before a real release.

## Making maps (Tiled)

Maps are made with [Tiled](https://www.mapeditor.org/), a free map editor. Open `public/assets/maps/town.tmj` to see a working example.

Steps for a new map:
1. **File → New Map**: Orthogonal, tile size 32×32, **untick "Infinite"**.
2. Save it as `public/assets/maps/<name>.tmj` (JSON map format).
3. Add the tileset `public/assets/tilesets/overworld.tsj` (Map → Add External Tileset).
4. Paint tile layers. Layers **above** the object layer in the layers panel draw over the player.
5. Add an **object layer** and place objects (rectangles). Set each object's **Class**:

| Class | Name | Custom properties | What it does |
|---|---|---|---|
| `spawn` | e.g. `start` | `facing` (optional: up/down/left/right) | Where the player appears |
| `door` | anything | `map` (target map name), `spawn` (spawn name there) | Walking onto it moves the player to another map |
| `sign` | anything | `text`, with pages separated by `\|` | A to read |
| `npc` | speaker name | `text` | Like a sign, but shows the speaker's name (NPC sprites come later) |
| `secret` | anything | `presses` (default 3), `tile` (tile name to show once open, e.g. `door`; leave out to just remove the wall), `map` + `spawn` (optional: once open it works as a door), `text` (message when it opens), `relock` (bool: closes again once you leave the map) | A hidden passage. Face it and press A `presses` times without moving or turning (any step or turn resets the count). Its solid tiles open up. It stays open for good (saved), unless `relock` is set |
| `shop` | shop name | `items` (comma list of item/equipment ids, or `*` for everything in the game), `text` (greeting), `free` (bool: everything costs 0) | Interact to buy and sell |
| `inn` | innkeeper name | `price`, `text` | Interact to rest: full HP/MP for the price |
| any of the above | | `sprite` (a sheet in `assets/sprites`, e.g. `merchant`), `facing` | Draws the object as a character, who turns to face you when you talk. Characters are solid |
| `battle` | anything | `enemies` (e.g. `slime,slime,bat`), `text` (optional), `canFlee` (bool, default true) | Interact to start a fight, after showing `text` if set |
| `enemy` | speaker name (optional) | `enemies` (e.g. `goblin,slime`), `text` (optional), `canFlee` (bool, default true), `image` (optional, file in `assets/enemies`), `size` (tiles tall, default 1) | A visible enemy. It's solid; bumping into it or pressing A starts the fight. Once beaten it stays gone |
| `encounter` | anything | `table` (name in `encounters.json`), `rate` (chance per tile walked, default 0.1), `minSteps` (grace tiles after a fight, default 4) | Random-battle zone |

**Collision:** tiles with the boolean property `solid` are walls. Set it per tile in the tileset editor. You can also add a tile layer named `collision`: anything painted on it is solid and invisible.

**Doors:** place the target map's spawn point *next to* its door, not on it.

## Battles

Battles use turn gauges: each character's gauge fills based on their speed, and they act when it's full.
Commands are **Attack**, **Skill**, **Item**, **Defend** (halves damage until your next turn), **Row** (switch rows; uses the turn) and **Run**.
By default the gauges pause while you're choosing a command. You can switch this to Active in the menu's Settings.

### Rows

Each side has a **front row** and a **back row**, shown as columns. The front row stands nearer the middle of the screen.

| Attack range | From the back row | Against a back-row target |
|---|---|---|
| **Melee** (most weapons, enemy claws/clubs) | half damage | half damage |
| **Reach** (spears) | full damage | half damage |
| **Ranged** (bows, arrows) | full damage | full damage |
| **Magic and healing** | full | full |

- If a side's whole front row is down, its back row is **exposed** and counts as front.
- Enemies aim physical attacks at the front row more often (3 to 1).
- **Formation** in the menu sets each character's starting row.
- Row-based skills:
  - `area: "row"` hits everyone in the chosen target's row (Cross Slash).
  - `area: "pierce"` hits the target and the enemy behind it (Piercing Thrust).
  - `knockback: true` pushes a front-row target into the back row (Shield Bash).
  - `effect: "cover"` (Bram's Cover) takes single-target physical hits aimed at back-row allies until his next turn.

All content is in `public/data/`:

| File | What's in it |
|---|---|
| `characters.json` | Party members: level-1 `stats`, `growth` per level, starting `skills`, skills to `learn` at levels (`{"5": "thunder"}`), starting `equip`; plus the starting party, items and gold |
| `equipment.json` | Weapons, armor and accessories: `slot`, stat bonuses, `price`, and `users` (who can equip it; leave out for everyone) |
| `enemies.json` | Enemies (stats, XP and gold rewards, weaknesses and resistances, which skills they use and how often) |
| `skills.json` | Skills: `physical`, `magic` or `heal`; power (100 = normal attack); MP cost; target; optional element |
| `items.json` | Items, their effects (`hp`, `mp`, `revive`) and `price` |
| `encounters.json` | Random-encounter tables: enemy groups with weights (higher = more common) |

Targets are `enemy`, `all_enemies`, `ally`, `all_allies`, `self` or `ally_dead`, always seen from the user's side.
Row-related fields:
- `row` in `characters.json` (starting row) and `enemies.json` (where that enemy stands).
- `range` on weapons in `equipment.json` (`melee`, `reach`, `ranged`; default melee).
- `range` on skills (default `weapon`, which uses the equipped weapon's range), plus `area`, `knockback` and `effect` on skills.

Any enemy list (encounter tables, `enemy`/`battle` map objects, `?battle=`) can place an enemy in a row with `@`, e.g. `slime@back`.
The game checks for unknown IDs on startup and shows an error naming the bad entry.
Damage formulas are at the top of `src/game/battle/rules.ts`; the XP curve and level-up rules are in `src/game/party.ts`. Shops sell items back for half price.

## Swapping art ("skins")

The game uses **32×32** tiles and characters. The screen shows about 15 tiles top to bottom; `WORLD_HEIGHT` in `src/engine/display.ts` changes that (lower zooms in). Walking speed, collision and reach are measured in tiles, so they adapt to the tile size automatically.

- **Tiles:** `public/assets/tilesets/overworld.png` is a 32×32 grid. Replace the image, or make a new tileset in Tiled.
- **Characters:** `public/assets/sprites/<name>.png` (one per party member, e.g. `aren.png`) has 4 rows (down, left, right, up) × 4 walk frames, 32×32 each. The layout is described in the matching `.json`, so different frame sizes and orders work by editing that file. The first party member is the one you walk around with; in battle, characters use the "left" row at 2× size.
- **Enemies:** `public/assets/enemies/*.png`, any size (the placeholders are 64×64), drawn at 2× like the party (set `scale` in `enemies.json` to change it).
- The current art is placeholder art generated by `npm run art` (`tools/gen-placeholder-art.mjs`). Running it again overwrites those PNGs.

## Project layout

```
src/engine/   reusable bits: game loop, input, display, Tiled map loader, collision, camera, sprites, scenes
src/game/     this game: overworld and battle scenes, player, UI, data loading, game state
public/assets maps, tilesets, sprites, enemy images
public/data   characters, enemies, skills, items (JSON)
android/      Capacitor Android project (landscape, fullscreen)
tools/        content helper scripts
```

## Roadmap

1. ✅ Exploration: movement, Tiled maps, collision, camera, doors, signs, touch controls
2. ✅ Battles: party of 3 vs enemies, Attack/Skill/Item/Defend/Run, turn gauges, weaknesses
3. ✅ Encounters: random encounters in zones, visible enemies on the map
4. ✅ Progression: levels and skills, equipment, shops and inn, saving, title and game over
5. NPCs and dialogue, menus, shops, audio and polish

## Google Play notes (only needed if you publish)

- The app ID is `com.vel71184.toprpg` (in `capacitor.config.ts` and `android/app/build.gradle`). It can change freely until the first upload to Play, and never after that.
- Play needs a release-signed `.aab`. The signing keystore must **never** be committed (`.gitignore` blocks `*.jks` and `*.keystore`), and it must be backed up somewhere safe.
- New personal developer accounts must run a closed test (about 12 testers for 14 days) before releasing publicly.
