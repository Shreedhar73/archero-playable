/**
 * Keyboard input handling for the game.
 * Dev and desktop only: Mobile uses on-screen joystick, not a keyboard.
 */

const held = new Set<string>();

window.addEventListener("keydown", (event) => {
  held.add(event.key.toLowerCase());
});

window.addEventListener("keyup", (event) => {
  held.delete(event.key.toLowerCase());
});

/** Reused, never reallocated, runs every frame*/
const direction = { x: 0, z: 0 };

export function keyboardDirection(): { x: number; z: number } {
  direction.x = (held.has("d") ? 1 : 0) - (held.has("a") ? 1 : 0);
  const length = Math.hypot(direction.x, direction.z);
  if (length > 0) {
    direction.x /= length;
    direction.z /= length;
  }
  direction.z = (held.has("s") ? 1 : 0) - (held.has("w") ? 1 : 0);
  return direction;
}
