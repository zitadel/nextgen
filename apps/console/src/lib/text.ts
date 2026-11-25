/** `admin` → `Admin`. */
export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** `["a", "b", "c"]` → `a, b and c`; one item is itself, none is empty. */
export function joinAnd(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
