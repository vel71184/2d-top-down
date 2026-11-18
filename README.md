# Top-Down RPG (working title)

A top-down adventure RPG for Android, with exploration and party-based turn-based battles.
It's written in TypeScript with HTML5 Canvas and wrapped as an Android app with [Capacitor](https://capacitorjs.com).

**Status:** stage 2 of 5. You can explore maps, go through doors and read signs, and fight turn-based battles with a party of 3.

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
- `?debug` shows collision (red), objects (blue) and FPS.

## Getting it on your phone

Every push to GitHub builds an installable APK:

1. Open the repo on GitHub → **Actions** → the latest **Android APK** run.
2. Download the `top-down-rpg-debug-apk` artifact (a zip) and unzip it to get `app-debug.apk`.
3. Copy it to your phone and open it. Android will ask you to allow installing from that source the first time.

To build it locally instead, install Android Studio, then run `npm run android:sync` and open the `android/` folder in Android Studio.

## Making maps (Tiled)

Maps are made with [Tiled](https://www.mapeditor.org/), a free map editor. Open `public/assets/maps/town.tmj` to see a working example.

Steps for a new map:
1. **File → New Map**: Orthogonal, tile size 16×16, **untick "Infinite"**.
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
| `battle` | anything | `enemies` (e.g. `slime,slime,bat`), `text` (optional), `canFlee` (bool, default true) | Interact to start a fight, after showing `text` if set |
| `encounter` | anything | `table`, `rate` | Random-battle zone (used from stage 3) |

**Collision:** tiles with the boolean property `solid` are walls. Set it per tile in the tileset editor. You can also add a tile layer named `collision`: anything painted on it is solid and invisible.

**Doors:** place the target map's spawn point *next to* its door, not on it.

## Battles

Battles use turn gauges: each character's gauge fills based on their speed, and they act when it's full.
Commands are **Attack**, **Skill**, **Item**, **Defend** (halves damage until your next turn) and **Run**.
By default the gauges pause while you're choosing a command. Set `battleSettings.atbMode` to `"active"` in `src/game/battle/BattleScene.ts` for real-time pressure.

All content is in `public/data/`:

| File | What's in it |
|---|---|
| `characters.json` | Party members (stats, skills, sprite), the starting party and starting items |
| `enemies.json` | Enemies (stats, XP and gold rewards, weaknesses and resistances, which skills they use and how often) |
| `skills.json` | Skills: `physical`, `magic` or `heal`; power (100 = normal attack); MP cost; target; optional element |
| `items.json` | Items and their effects (`hp`, `mp`, `revive`) |

Targets are `enemy`, `all_enemies`, `ally`, `all_allies`, `self` or `ally_dead`, always seen from the user's side.
The game checks for unknown IDs on startup and shows an error naming the bad entry.
Damage formulas are at the top of `src/game/battle/rules.ts`.

## Swapping art ("skins")

- **Tiles:** `public/assets/tilesets/overworld.png` is a 16×16 grid. Replace the image, or make a new tileset in Tiled.
- **Characters:** `public/assets/sprites/<name>.png` (one per party member, e.g. `aren.png`) has 4 rows (down, left, right, up) × 4 walk frames, 16×16 each. The layout is described in the matching `.json`, so different frame sizes and orders work by editing that file. The first party member is the one you walk around with; in battle, characters use the "left" row at 2× size.
- **Enemies:** `public/assets/enemies/*.png`, any size, drawn at 2× (set `scale` in `enemies.json` to change it).
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
3. Encounters: random encounters in zones, fixed encounters on the map
4. Progression: XP, levels, equipment, inventory, saving
5. NPCs and dialogue, menus, shops, audio and polish

## Google Play notes (only needed if you publish)

- The app ID is `com.vel71184.toprpg` (in `capacitor.config.ts` and `android/app/build.gradle`). It can change freely until the first upload to Play, and never after that.
- Play needs a release-signed `.aab`. The signing keystore must **never** be committed (`.gitignore` blocks `*.jks` and `*.keystore`), and it must be backed up somewhere safe.
- New personal developer accounts must run a closed test (about 12 testers for 14 days) before releasing publicly.
