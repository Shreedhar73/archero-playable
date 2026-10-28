/** Per-project values the generator fills in; everything else is tunables. */

export const CTA_LABEL = "Install now!";

export const STORE_URLS = {
  ios: "https://apps.apple.com/app/id000000000",
  android: "https://play.google.com/store/apps/details?id=com.example.app",
};

export const PLAYER_SPEED = 3; // units per second

/**Room is tall rectangle */
export const ROOM_WIDTH = 12;
export const ROOM_DEPTH = 13;

export const PLAYER_RADIUS = 0.3; // units, for collision detection

/** Pool size, decided at boot. Each enemy has x number of draw calls. ( based on glb)
 * so this is a frame-time budget, not a difficuly or performance dial
 */

export const ENEMY_COUNT = 6;

/** Ememy height of glb is 4.791 untits, archer is 1.832, so we need to scale down enemy */
export const ENEMY_SCALE = 0.32;

/** Emeny  speed */
export const ENEMY_SPEED = 1.8;

/** Enemy radium. Help to stop enemy before as soon as it touches player */
export const ENEMY_RADIUS = 0.35;

/** Seconds between enemy spawns */
export const SPAWN_INTERVAL = 1.5;
