# Playable

Playable-ad project generated from [create-playable](../create-playable).

Live build: <https://shreedhar73.github.io/archero-playable/> - the generic
single HTML file, deployed from `main` by `.github/workflows/pages.yml`.
`vercel.json` deploys the same `main` to Vercel with every network's bundle:
`/` rewrites to `/generic.html`; `/applovin.html` and `/google.zip` sit beside it.

## Stack

- TypeScript + Vite + `vite-plugin-singlefile`: everything inlined into one
  HTML file per network — ad networks forbid runtime requests.
- Pixi v8 UI overlay (`#ui`); optional Three.js world canvas (`#world`) below it.
- One build per network: `vite build --mode <network>`, then
  `scripts/package.mjs` packages and gates the size. `vite.config.ts` aliases
  `@network` to one file in `src/adapters/`, so each bundle carries only its
  own network's CTA code.

## Builds

| Network | Command | Output | Cap | CTA |
|---|---|---|---|---|
| generic | `npm run build:generic` | `dist/generic.html` | 5 MB, single HTML | `window.open(store)` |
| Meta | `npm run build:meta` | `dist/meta.html` | 2 MB, single HTML | `FbPlayableAd.onCTAClick()` |
| Google Ads | `npm run build:google` | `dist/google.zip` | 5 MB ZIP | `ExitApi.exit()` |
| AppLovin | `npm run build:applovin` | `dist/applovin.html` | 5 MB, single HTML | `mraid.open(storeUrl)` |

`npm run build` type-checks then builds every network this project includes.
`npm run dev` serves the first network; in dev the network globals are absent,
so the CTA logs a warning instead of clicking out.

## Network rules (pre-submit checklist)

- **All**: zero runtime requests — fonts, images, audio inlined. Caps read as
  decimal MB. Passing the gate ≠ validated: upload to each network's validator.
- **Sound**: the `AudioContext` is created at boot and asked to start; where
  the container's autoplay policy refuses, it stays silent until the first
  tap resumes it inside that gesture (`src/audio/audio.ts`), and nothing
  queues up meanwhile. The mute control is on screen from the first frame.
  A network that forbids sound before interaction gets it for free from the
  browser; none of the ones here states that rule. There is no audio file to inline: every
  sound is synthesized at runtime from two primitives in `src/audio/synth.ts`.
  Mute is not persisted — see the Google rule below.
- **Meta**: no `window.open`/`location` anywhere in the bundle (scanner
  rejects); CTA only through `FbPlayableAd.onCTAClick()`.
- **Google**: `exitapi.js` is the one allowed external script (injected by the
  build); no localStorage, no iframes; `index.html` at the ZIP root.
- **AppLovin**: wait for MRAID `ready` before any call (adapter does); no
  redirect on the first tap, no auto-click — reveal the CTA before it is
  tappable; must work portrait AND landscape.

## Layout

```
src/
  main.ts          composition root: adapter.ready -> renderers -> loop
  config.ts        CTA label, store URLs, game tunables
  vite-env.d.ts    APP_VERSION declaration
  adapters/        one file per ad network (types.ts is the contract)
  engine/          loop.ts (ticker + dt clamp), resize.ts (layout bus)
  three/           world.ts — Three.js boot (only in Three-enabled projects)
  audio/           cues.ts (state diff), synth.ts (primitives), audio.ts (output)
scripts/
  package.mjs      per-network packaging and size gate
```

Key invariant: game state lives outside renderers — resize/orientation only
re-layouts (`engine/resize.ts`), never restarts.

## Assets

Every asset here was sourced by research, not handed over. The player is a
chibi hero model off Sketchfab, with its four clips — Idle, Run, Shoot,
Death — from the Mixamo library at <https://www.mixamo.com>, which is also the
rig convention the hero pipeline is written against. Both enemies are from
**KayKit's Skeletons character pack** (CC0, Kay Lousberg,
<https://kaylousberg.itch.io/kaykit-skeletons>): the Rogue with the pack's
crossbow for the ranged enemy and the Warrior with its blade for melee, each
shipping four of its 95 embedded clips and the pack's palette atlas at 128².
They replaced Mixamo's Erika Archer and three.js's RobotExpressive, neither of
which was in the game's style; Erika stays under `assets/raw/` because the
hero's bow grip is measured off her. The props, the bow
and the arrow come from a ripped Archero mesh set found on GitHub; the one
prop that set does not contain is a conifer, so `low_poly_pine.glb` was
downloaded separately and the set's canopy blob stayed in the scene as the
round bushes it actually looks like. No logo artwork exists, so the end card's
logo is procedural Pixi text.

Preparing and optimizing those assets was done with AI, heavily and on
purpose: the ripped set is 882 files, the two characters have different
proportions and incompatible joint names, and both have to ship inside one
HTML file. The fifteen scripts under `scripts/` are that work — audit, merge,
retarget, measure, compress — and seven of them drive a headless Chromium: the
two merges use it to run three.js outside a browser, and two more exist only
to render an asset so a decision about it can be looked at instead of argued
about. The eight `assets/*.glb` the game ships total 662 KB on disk, 0.88 MB
once base64'd into the bundle — the hero's own merge goes in at 2.67 MB of raw
GLB and comes out at 113 KB.

The `assets/*.glb` the bundle inlines are committed; their sources are not,
because the Mixamo downloads are tens of megabytes each.

```sh
npm run convert       # assets/raw/*.fbx -> intermediate glbs (headless Chromium)
npm run archer        # merge the clips into assets/raw/archer_playable.glb (the hero's bow reference)
npm run skeletons     # KayKit raws -> assets/skeleton_rogue.glb, assets/skeleton_warrior.glb
npm run archero       # hero model + clips + bow -> assets/archero_hero.glb
npm run archero:view  # contact sheet of the hero's clips, any camera angle
npm run assets        # rebuild the other assets/*.glb from assets/raw/
npm run assets:check  # print clips, bounds and bone names of the built files
```

**There are no audio assets.** Sound is synthesized at runtime — two
primitives in `src/audio/synth.ts` (a tone with an optional pitch slide, a
filtered noise burst), and a table of sounds built from them in
`src/audio/audio.ts`. The background music and the footsteps are
built to measurements of the real game's own audio, taken off a screen
recording with `scripts/measure-audio.py` (numpy/scipy; the recording stays
in `requirements/`, gitignored, and nothing from it ships). Zero bundle
bytes, no licence question. The knobs: `MASTER`, `MUSIC`, `STEP_GAIN`, the
`gain` in each entry of `SFX`, and the `LEAD`/`BASS_*` tables. `npm run
audition` opens a dev-only page with each layer on its own switch, a
run-and-stand loop, and the measured shot, hit and death for comparison; it
is not part of any build.

An earlier version decoded seven CC0 MP3s instead and cost 220 KB. Those
recordings are still on disk at `assets/raw/audio/` (gitignored) if a sampled
version is ever wanted again; nothing in the build reads them.

To rebuild the enemy archer, `assets/raw/` needs the rigged character export as
`erika_archer.glb` plus four Mixamo downloads: `Standing Idle.fbx`,
`Running.fbx` (**without** "In Place"), `Standing Aim Recoil.fbx`,
`Standing Death Left 01.fbx`, and `Erika Archer With Bow Arrow.fbx` for the
bow itself. The hero needs `archero-model.glb`, `bow.glb` and the same four
clips — `Standing Draw Arrow.fbx` in place of the recoil one.

## Commands

```sh
npm install
npm run dev      # vite on :8080
npm run check    # tsc --noEmit
npm run build    # check + all network builds + size gates
npm run shot     # screenshot the running game at any viewport
npm run walk     # drive it across the room and shoot both ends
```

`walk` exists because `shot` only ever photographs a standing archer, which
is the one case where a camera that follows the player looks identical to a
fixed one. It holds `w` and then `s` and shoots the far wall, the near wall
and the settled frame. Its holds are long on purpose: headless Chromium
renders WebGL on the CPU, so the game runs well under real time.
