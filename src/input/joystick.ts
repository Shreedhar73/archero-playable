/** Joystick maths. No Pixi, no DOM, so it can be tested without a renderer. */

export interface JoystickVector {
  /**-1...1 along x axis on world */
  x: number;
  /** -1...1 along z axis on world */
  z: number;

  knobX: number;
  knobY: number;
}

const out: JoystickVector = { x: 0, z: 0, knobX: 0, knobY: 0 };

export function joystickVector(
  dx: number,
  dy: number,
  radius: number,
  reach = radius,
): JoystickVector {
  const distance = Math.hypot(dx, dy);
  // Direction saturates at the ring; the knob keeps travelling to `reach`,
  // since a knob pinned while the thumb moves on reads as a dropped touch.
  const held = distance > radius ? radius / distance : 1;
  const shown = distance > reach ? reach / distance : 1;
  out.knobX = dx * shown;
  out.knobY = dy * shown;
  out.x = (dx * held) / radius;
  out.z = (dy * held) / radius;
  return out;
}
