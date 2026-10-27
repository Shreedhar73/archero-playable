/// <reference types="vite/client" />

/** Vite's client types cover images, fonts and media, not models. */
declare module "*.glb" {
  const src: string;
  export default src;
}

/** Injected by vite.config.ts `define` from package.json version. */
declare const APP_VERSION: string;
