/**
 * What the creative needs from the network it runs in. The game calls only
 * this; vite.config.ts aliases `@network` to exactly one implementation per
 * build, so the others never reach the bundle.
 */
export interface NetworkAdapter {
  readonly network: string;
  /** Button label on the CTA buttons. Every network here runs playables as app installs. */
  readonly ctaLabel: string;
  /** Resolves when the network allows the ad to start (MRAID `ready`). Immediate elsewhere. */
  ready: () => Promise<void>;
  /** Calls back when the ad is hidden or shown again, where the network reports it. */
  onViewableChange?: (callback: (viewable: boolean) => void) => void;
  /** The click-through. */
  cta: () => void;
}

/** iOS (iPhone, iPad, iPadOS reporting as a Mac with touch) gets the App Store link. */
export function isIos(): boolean {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}
