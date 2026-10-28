/**
 * The element the game renders into. On a phone it fills the viewport; on a
 * desktop a media query shrinks it to a phone frame. Everything measures
 * against this rather than `window`, so one CSS rule decides the play area
 * and no layout code has to know which case it is in.
 */
function findDevice(): HTMLElement {
  const element = document.getElementById("device");
  if (element === null) throw new Error("index.html is missing #device");
  return element;
}

export const device = findDevice();
