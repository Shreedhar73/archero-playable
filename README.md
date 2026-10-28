# Playable

Playable-ad project generated from [create-playable](../create-playable).

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
scripts/
  package.mjs      per-network packaging and size gate
```

Key invariant: game state lives outside renderers — resize/orientation only
re-layouts (`engine/resize.ts`), never restarts.

## Assets

The `assets/*.glb` the bundle inlines are committed; their sources are not,
because the Mixamo downloads are tens of megabytes each.

```sh
npm run convert       # assets/raw/*.fbx -> intermediate glbs (headless Chromium)
npm run archer        # convert, then merge into assets/archer_playable.glb
npm run assets        # rebuild the other assets/*.glb from assets/raw/
npm run assets:check  # print clips, bounds and bone names of the built files
```

To rebuild the archer, `assets/raw/` needs the rigged character export as
`erika_archer.glb` plus four Mixamo downloads: `Standing Idle.fbx`,
`Running.fbx` (**without** "In Place"), `Standing Aim Recoil.fbx`,
`Standing Death Left 01.fbx`, and `Erika Archer With Bow Arrow.fbx` for the
bow itself.

## Commands

```sh
npm install
npm run dev      # vite on :8080
npm run check    # tsc --noEmit
npm run build    # check + all network builds + size gates
```
