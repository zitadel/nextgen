/**
 * Everything reached from where a walk starts, breadth first: each node once,
 * in the order it was first reached.
 *
 * @remarks
 * A node is told apart from another by its key, so a walk that carries
 * something along, such as the provider chosen on the way, visits a step once
 * for each thing it can carry there. A node is queued only when its key has not
 * been seen, so each node is judged once and the order is the order reached.
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
  const seen = new Set<string>();
  const reached: Node[] = [];
  const enqueue = (nodes: readonly Node[]): void => {
    for (const node of nodes) {
      const id = key(node);
      if (!seen.has(id)) {
        seen.add(id);
        reached.push(node);
      }
    }
  };
  enqueue(start);
  // The list grows as nodes are found, and the loop follows it to the end.
  for (let index = 0; index < reached.length; index += 1) {
    const node = reached[index];
    if (node !== undefined) {
      enqueue(next(node));
    }
  }
  return reached;
}
