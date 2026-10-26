/**
 * What the creative needs from its ad network. vite.config.ts aliases
 * `@network` to exactly one implementation per build.
 */
export interface NetworkAdapter {
  readonly network: string;
  /** CTA button label. */
  readonly ctaLabel: string;
  /** Resolves when the network allows the ad to start (MRAID `ready`). */
  ready: () => Promise<void>;
  /** Fires when the ad is hidden or shown again, where the network reports it. */
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
