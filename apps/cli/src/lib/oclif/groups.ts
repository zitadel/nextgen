/**
 * The order within a group, which the root help and the docs' CLI reference
 * (`./reference`) share: `groupOrder` first, lowest first, then the command id.
 */
export function compareInGroup(
  a: { id: string; groupOrder?: number },
  b: { id: string; groupOrder?: number },
): number {
  return (
    (a.groupOrder ?? Number.MAX_SAFE_INTEGER) - (b.groupOrder ?? Number.MAX_SAFE_INTEGER) ||
    a.id.localeCompare(b.id)
  );
}
