/** Per-project values the generator fills in; everything else is tunables. */

export const CTA_LABEL = "Install now!";

export const STORE_URLS = {
  ios: "https://apps.apple.com/app/id000000000",
  android: "https://play.google.com/store/apps/details?id=com.example.app",
};

export const PLAYER_SPEED = 5; // units per second

/**
 * Ground covered between footsteps: one every 0.30 s at full speed in the
 * real game. A distance, not a time, so a body held against a wall takes
 * none. Shared by the footstep sound and the dust.
 */
export const STEP_LENGTH = PLAYER_SPEED * 0.3;

/** How fast velocity closes on the stick, per second. Braking is faster. */
export const PLAYER_ACCEL = 18;
export const PLAYER_BRAKE = 26;

/** Room footprint. Depth follows from the camera angle; see `three/camera.ts`. */
export const ROOM_WIDTH = 9;
export const ROOM_DEPTH = 16;

export const PLAYER_RADIUS = 0.3; // units, for collision detection

/** Enemy kind per spawn, in order. Melee spread out so no pair comes back to back. */
export const ENEMY_KINDS = [
  "melee",
  "archer",
  "archer",
  "melee",
  "archer",
  "archer",
  "archer",
  "melee",
  "archer",
] as const;

/** Pool size and level length. Add to ENEMY_KINDS to make a level longer. */
export const ENEMY_COUNT = ENEMY_KINDS.length;

/** Visual only. The Warrior is 2.591 tall in its file. */
export const ENEMY_SCALE = 0.6;

/** Visual only. `PLAYER_RADIUS` is what collides. */
export const PLAYER_SCALE = 0.95;

export const ENEMY_SPEED = 2.6;

/** Collision radius; stops an enemy as it touches the player. */
export const ENEMY_RADIUS = 0.35;

/** Seconds between enemy spawns */
export const SPAWN_INTERVAL = 1;

/** Pathfinding cell size. Finer than a body, so rounding never closes a lane. */
export const CELL_SIZE = 0.5;

export const PLAYER_HP = 100;

/** Three arrows at ARROW_DAMAGE. */
export const ENEMY_HP = 30;

export const ENEMY_DAMAGE = 5;

/** Seconds between melee swings. */
export const ENEMY_ATTACK_INTERVAL = 0.75;

/** Seconds the Death clip plays before the pool slot is handed back. */
export const ENEMY_DEATH_TIME = 1.1;

export const ARROW_SPEED = 11;
export const ARROW_DAMAGE = 15;
export const ARROW_RADIUS = 0.12;

/** Seconds before an arrow despawns if it misses everything. */
export const ARROW_LIFE = 2;

/** Arrows in flight at once. Fire rate times life plus headroom. */
export const PROJECTILE_COUNT = 24;

export const FIRE_INTERVAL = 0.8;
export const FIRE_RANGE = 5;

/** Seconds the shoot pose holds. Shorter than the clip so the archer settles between arrows. */
export const SHOOT_POSE = FIRE_INTERVAL * 1.15;

export const POINTS_PER_KILL = 10;
export const ENEMIES_TO_KILL = ENEMY_COUNT;

export const POINTS_TARGET = ENEMIES_TO_KILL * POINTS_PER_KILL;

/** How far in front of the archer an arrow appears, so it leaves the bow and not the chest. */
export const ARROW_SPAWN_OFFSET = 0.45;

/** Seconds before the tutorial starts the game on its own if nobody taps. */
export const TUTORIAL_TIMEOUT = 3;

/** Distance an archer holds. Must stay inside FIRE_RANGE or a standing player can never reach it. */
export const ENEMY_SHOOT_RANGE = 4.4;

export const ENEMY_SHOT_INTERVAL = 0.75;
export const ENEMY_ARROW_SPEED = 10;
export const ENEMY_ARROW_DAMAGE = 2;

/** Fraction of ENEMY_SHOOT_RANGE an archer tolerates before backing off. A band, or it jitters. */
export const ENEMY_KITE_BAND = 0.78;

/** Retreat speed factor, so the player can close the gap. */
export const ENEMY_BACKPEDAL = 0.8;

/** Visual only. The Rogue is 2.308 tall in its file. */
export const ENEMY_ARCHER_SCALE = 0.52;

/**
 * Rest-pose height of each model (`scripts/check-assets.mjs`) times its
 * draw scale. Floating bars are placed and sized from these, so a scale
 * edit carries the bar with the body. Declared after the scales: a const
 * read before its declaration throws.
 */
export const PLAYER_HEIGHT = 1.83 * PLAYER_SCALE;
export const ENEMY_HEIGHTS: Record<(typeof ENEMY_KINDS)[number], number> = {
  melee: 2.591 * ENEMY_SCALE,
  archer: 2.308 * ENEMY_ARCHER_SCALE,
};
