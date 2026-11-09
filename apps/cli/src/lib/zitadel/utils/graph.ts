/**
 * Everything reached from where a walk starts, breadth first: each node once,
 * in the order it was first reached.
 *
 * @remarks
 * A node is told apart from another by its key, so a walk that carries
 * something along, such as the provider chosen on the way, visits a step once
 * for each thing it can carry there.
 *
 * @typeParam Node - What the walk visits.
 * @param start - Where the walk starts.
 * @param next - The nodes a node leads to.
 * @param key - What tells one node apart from another.
 * @returns Every node reached, the start included, in the order reached.
 */
export function walk<Node>(
  start: readonly Node[],
  next: (node: Node) => readonly Node[],
  key: (node: Node) => string,
): readonly Node[] {
  const reached = new Map<string, Node>();
  const queue = [...start];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) {
      break;
    }
    if (reached.has(key(node))) {
      continue;
    }
    reached.set(key(node), node);
    queue.push(...next(node));
  }
  return [...reached.values()];
}
