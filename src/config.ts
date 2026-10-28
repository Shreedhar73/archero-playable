/** Per-project values the generator fills in; everything else is tunables. */

export const CTA_LABEL = "Install now!";

export const STORE_URLS = {
  ios: "https://apps.apple.com/app/id000000000",
  android: "https://play.google.com/store/apps/details?id=com.example.app",
};

export const PLAYER_SPEED = 3; // units per second

/** Room footprint. Taller than wide, as in the reference (~1:1.3) — enough to
 *  read as an Archero arena, shallow enough to still frame in landscape. */
export const ROOM_WIDTH = 9;
export const ROOM_DEPTH = 12;

export const PLAYER_RADIUS = 0.3; // units, for collision detection

/** Pool size, decided at boot. Each enemy has x number of draw calls. ( based on glb)
 * so this is a frame-time budget, not a difficuly or performance dial
 */

export const ENEMY_COUNT = 6;

/** Ememy height of glb is 4.791 untits, archer is 1.832, so we need to scale down enemy */
export const ENEMY_SCALE = 0.32;

/** Emeny  speed */
export const ENEMY_SPEED = 2.6;

/** Enemy radium. Help to stop enemy before as soon as it touches player */
export const ENEMY_RADIUS = 0.35;

/** Seconds between enemy spawns */
export const SPAWN_INTERVAL = 1;

/** Pathfinding grid resolution. Half a unit is finer than a body (0.7 across),
 *  so a lane a body fits through is never closed by rounding, and 18x24 cells
 *  is small enough to flood in well under a millisecond. */
export const CELL_SIZE = 0.5;

/** Player health. A single number so the HUD can draw one bar. */
export const PLAYER_HP = 100;

/** Enemy health: three arrows at ARROW_DAMAGE, so a kill is quick but not
 *  instant — long enough for the hit reaction to read. */
export const ENEMY_HP = 30;

export const ENEMY_DAMAGE = 4;

/** Seconds between melee swings, so standing in a crowd is lethal but not
 *  instantly so. */
export const ENEMY_ATTACK_INTERVAL = 1.4;

/** Seconds the Death clip plays before the pool slot is handed back. The clip
 *  itself is longer; this is how much of it is worth watching. */
export const ENEMY_DEATH_TIME = 1.1;

export const ARROW_SPEED = 11;
export const ARROW_DAMAGE = 10;
export const ARROW_RADIUS = 0.12;

/** Seconds before an arrow despawns, in case it somehow misses everything. */
export const ARROW_LIFE = 2;

/** Arrows in flight at once. Fire rate times life plus headroom. */
export const PROJECTILE_COUNT = 24;

export const FIRE_INTERVAL = 0.4;
export const FIRE_RANGE = 5;

export const POINTS_PER_KILL = 10;
export const POINTS_TARGET = 120;
