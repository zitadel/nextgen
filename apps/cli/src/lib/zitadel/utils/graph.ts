/**
 * Everything reached from where a walk starts, breadth first: each node once,
 * in the order it was first reached.
 *
 * @remarks
 * A node is told apart from another by its key, so a walk that carries
 * something along, such as the provider chosen on the way, visits a step once
 * for each thing it can carry there. The walk goes one level at a time, and a
 * level holds only the nodes not reached before it.
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
  const grow = (
    reached: ReadonlyMap<string, Node>,
    level: readonly Node[],
  ): ReadonlyMap<string, Node> => {
    const fresh = level.filter((node, index) => {
      const first = level.findIndex((other) => {
        return key(other) === key(node);
      });
      return first === index && !reached.has(key(node));
    });
    if (fresh.length === 0) {
      return reached;
    }
    const entries = fresh.map((node): readonly [string, Node] => {
      return [key(node), node];
    });
    return grow(new Map([...reached, ...entries]), fresh.flatMap(next));
  };
  return [...grow(new Map(), start).values()];
}
