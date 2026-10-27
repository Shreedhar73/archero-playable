/// <reference types="vite/client" />

/** Vite's client type covers images , fonts media , not 3d models */
declare module "*.glb" {
  const src: string;
  export default src;
}

/** Injected by vite.config.ts `define` from package.json version. */
declare const APP_VERSION: string;
