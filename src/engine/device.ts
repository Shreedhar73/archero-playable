/**
 * The element the game renders into. Fills the viewport on a phone; a media
 * query shrinks it to a phone frame on desktop. Measure against this, not `window`.
 */
function findDevice(): HTMLElement {
  const element = document.getElementById("device");
  if (element === null) throw new Error("index.html is missing #device");
  return element;
}

export const device = findDevice();
