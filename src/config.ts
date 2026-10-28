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

/**
 * Which enemy each spawn is, in order. Two melee and four archers, spread so
 * the player never faces a melee pair back to back — a literal [melee, melee,
 * archer, archer, archer, archer] would make the first half of the level a
 * different game from the second.
 */
export const ENEMY_KINDS = [
  "melee",
  "archer",
  "archer",
  "melee",
  "archer",
  "archer",
] as const;

/**
 * Pool size, and the length of a level: both are "how many enemies exist",
 * so both come from ENEMY_KINDS rather than being repeated. Adding a kind to
 * that list is the only edit needed to make a level longer.
 */
export const ENEMY_COUNT = ENEMY_KINDS.length;

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

/**
 * Seconds the draw-and-recoil pose holds after a shot. Shorter than the clip
 * itself (0.7 s) so the archer settles back to idle between arrows instead of
 * being permanently mid-recoil at FIRE_INTERVAL.
 */
export const SHOOT_POSE = FIRE_INTERVAL * 1.15;

export const POINTS_PER_KILL = 10;
export const ENEMIES_TO_KILL = ENEMY_COUNT;

/** Derived, so the two can never drift apart. */
export const POINTS_TARGET = ENEMIES_TO_KILL * POINTS_PER_KILL;

/** How far in front of the archer an arrow appears. Inside the body it reads
 *  as the arrow materialising out of the chest. */
export const ARROW_SPAWN_OFFSET = 0.45;

/**
 * Seconds the tutorial waits before starting the game on its own.
 *
 * The brief says the stage ends on first input, and it does — this is the
 * floor under that. A player who never taps would otherwise watch a hand
 * trace a figure-8 for the whole ad, which is the one outcome worth ruling
 * out: no gameplay seen, no CTA reached.
 */
export const TUTORIAL_TIMEOUT = 3;


/**
 * The distance an archer enemy tries to hold.
 *
 * Deliberately INSIDE the player's FIRE_RANGE of 5. An archer that outranges
 * the player reads better on paper — advance into danger to answer it — but
 * the simulation showed what it actually does: a player who stands still can
 * never reach them, the level never ends, and the ad never reaches its CTA.
 * Measured at 5.6, four seeds all stalled at 3-4 kills of 6.
 *
 * An ad has to be winnable by someone who barely plays. The kinds stay
 * different because of how they move, not because of who outranges whom.
 */
export const ENEMY_SHOOT_RANGE = 4.4;

export const ENEMY_SHOT_INTERVAL = 1.9;
export const ENEMY_ARROW_SPEED = 7;
export const ENEMY_ARROW_DAMAGE = 5;

/**
 * How far inside its firing range an archer tolerates the player before
 * backing off, as a fraction of ENEMY_SHOOT_RANGE. A band rather than a
 * single distance: an exact target makes the enemy jitter across it every
 * frame, stepping forward and back forever.
 */
export const ENEMY_KITE_BAND = 0.78;

/** Retreating is slower than advancing — walking backwards always is, and it
 *  gives the player a way to close the gap. */
export const ENEMY_BACKPEDAL = 0.8;
