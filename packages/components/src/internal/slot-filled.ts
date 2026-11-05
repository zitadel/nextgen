/**
 * Whether the host has a light-DOM child assigned to `slot`. Read at render
 * time, so the first paint already knows which regions are empty.
 */
export function lightDomSlotFilled(host: Element, slot: string): boolean {
  for (const child of host.children) {
    if (child.getAttribute("slot") === slot) return true;
  }
  return false;
}
