/**
 * Joystick maths. No Pixi, no DOM: the rule is arithmetic on three numbers,
 * so it lives where it can be read and tested without a renderer.
 */

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
): JoystickVector {
  const distance = Math.hypot(dx, dy);
  const scale = distance > radius ? radius / distance : 1;
  out.knobX = dx * scale;
  out.knobY = dy * scale;
  out.x = out.knobX / radius;
  out.z = out.knobY / radius;
  return out;
}
