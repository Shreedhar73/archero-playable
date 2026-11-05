/**
 * AppLovin (MRAID 2.0). Wait for MRAID `ready` before any MRAID call, click
 * through with mraid.open() and never window.open, and show the CTA only
 * after the game reveals it so the first tap is never a click-out.
 * mraid.js is injected by the SDK; the creative does not load it.
 */
import { CTA_LABEL, STORE_URLS } from "../config.ts";
import { isIos, type NetworkAdapter } from "./types.ts";

interface Mraid {
  getState: () => string;
  addEventListener: (
    event: string,
    listener: (...args: never[]) => void,
  ) => void;
  removeEventListener: (
    event: string,
    listener: (...args: never[]) => void,
  ) => void;
  isViewable: () => boolean;
  open: (url: string) => void;
}

declare global {
  interface Window {
    mraid?: Mraid;
  }
}

function storeUrl(): string {
  return isIos() ? STORE_URLS.ios : STORE_URLS.android;
}

export const adapter: NetworkAdapter = {
  network: "applovin",
  ctaLabel: CTA_LABEL,
  ready: () =>
    new Promise((resolve) => {
      const mraid = window.mraid;
      if (!mraid) {
        console.warn(
          "[playable] mraid missing; only present inside AppLovin's SDK and preview",
        );
        resolve();
        return;
      }
      if (mraid.getState() !== "loading") {
        resolve();
        return;
      }
      const onReady = () => {
        mraid.removeEventListener("ready", onReady);
        resolve();
      };
      mraid.addEventListener("ready", onReady);
    }),
  onViewableChange: (callback) => {
    window.mraid?.addEventListener("viewableChange", (viewable: boolean) =>
      callback(viewable),
    );
  },
  cta: () => {
    if (window.mraid) window.mraid.open(storeUrl());
    else console.warn("[playable] mraid missing; CTA would open", storeUrl());
  },
};
