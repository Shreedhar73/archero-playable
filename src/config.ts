/** Per-project values the generator fills in; everything else is tunables. */

export const CTA_LABEL = "Install now!";

export const STORE_URLS = {
  ios: "https://apps.apple.com/app/id000000000",
  android: "https://play.google.com/store/apps/details?id=com.example.app",
};

export const PLAYER_SPEED = 3; // units per second

/**
 * How fast the player's velocity closes on what the stick is asking for, per
 * second. Braking is faster than accelerating.
 *
 * The real game's player leans into a turn and settles out of it instead of
 * changing direction on one frame, and that easing is a good part of what
 * the recording reads as smooth. Short enough that nobody can feel a delay
 * between the thumb and the body: at 18, 0.15 s covers 93% of the change.
 */
export const PLAYER_ACCEL = 18;
export const PLAYER_BRAKE = 26;

/**
 * Room footprint. Taller than wide, as in the reference.
 *
 * 16, derived rather than chosen — see `src/three/camera.ts`. The arena
 * covers 96% of a portrait screen's width and 59% of its height in the
 * recording, which at 9 units wide makes the foreshortened depth 12.0 units
 * of screen; at the measured 48.5-degree elevation that is a room 16 deep.
 * The user was right that the fight ground reads longer than ours did: it is,
 * by a third.
 */
export const ROOM_WIDTH = 9;
export const ROOM_DEPTH = 16;

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
  "archer",
  "melee",
  "archer",
] as const;

/**
 * Pool size, and the length of a level: both are "how many enemies exist",
 * so both come from ENEMY_KINDS rather than being repeated. Adding a kind to
 * that list is the only edit needed to make a level longer.
 */
export const ENEMY_COUNT = ENEMY_KINDS.length;

/** Ememy height of glb is 4.791 untits, archer is 1.832, so we need to scale down enemy */
export const ENEMY_SCALE = 0.18;

/**
 * How big the player's model is drawn. Visual only — `PLAYER_RADIUS` is what
 * the simulation collides with, and it does not move.
 *
 * Measured against the recording: their hero is about 9.6% of the arena's
 * width on screen and ours was 6.9%, which is why our room read as empty.
 * This is the cheaper half of the fix — the other half would be a narrower
 * room, and the room was just asked to get longer.
 *
 * 1.15, not the 1.35 this started at: that was set under a 78-degree camera
 * which flattened everything, and at the measured 48.5 the same model shows
 * its full height.
 */
export const PLAYER_SCALE = 0.85;

/** Emeny  speed */
export const ENEMY_SPEED = 1.6;

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

export const ENEMY_DAMAGE = 3;

/** Seconds between melee swings, so standing in a crowd is lethal but not
 *  instantly so. */
export const ENEMY_ATTACK_INTERVAL = 1.4;

/** Seconds the Death clip plays before the pool slot is handed back. The clip
 *  itself is longer; this is how much of it is worth watching. */
export const ENEMY_DEATH_TIME = 1.1;

export const ARROW_SPEED = 11;
export const ARROW_DAMAGE = 15;
export const ARROW_RADIUS = 0.12;

/** Seconds before an arrow despawns, in case it somehow misses everything. */
export const ARROW_LIFE = 2;

/** Arrows in flight at once. Fire rate times life plus headroom. */
export const PROJECTILE_COUNT = 24;

export const FIRE_INTERVAL = 0.8;
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

export const ENEMY_SHOT_INTERVAL = 2.5;
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

/**
 * Enemy archers reuse the player's GLB: it already carries a bow, a Shoot
 * clip and a Death clip, so they cost no extra bundle bytes at all.
 *
 * Sharing a model means sharing a silhouette, so the tint is doing all the
 * work of telling friend from foe. A gentle 0.55 mix was not enough — at this
 * camera distance both read as "dark figure with a bow" — hence a strong mix
 * toward a saturated red. Scale helps a little, colour does the rest.
 */
export const ENEMY_ARCHER_SCALE = 0.58;
export const ENEMY_ARCHER_TINT = 0xff3b2e;

export const ENEMY_ARCHER_TINT_MIX = 0.82;

/**
 * Rest-pose height of each model as it ships, straight off
 * `scripts/check-assets.mjs`: the hero 1.830, Erika 1.836, the robot 4.791.
 * Times the scale it is drawn at, that is where its head is — and a floating
 * bar is placed *and* sized from it, so changing a scale carries the bar with
 * the body instead of leaving it behind at the height the old scale had.
 *
 * Declared here, below the scales, rather than beside them: a `const` read by
 * an initializer above its own declaration is a temporal-dead-zone throw, not
 * a hoist.
 */
export const PLAYER_HEIGHT = 1.83 * PLAYER_SCALE;
export const ENEMY_HEIGHTS: Record<(typeof ENEMY_KINDS)[number], number> = {
  melee: 4.791 * ENEMY_SCALE,
  archer: 1.836 * ENEMY_ARCHER_SCALE,
};
