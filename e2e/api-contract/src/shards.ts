/**
 * Deals operations into shards by a hash of their name, so an operation stays
 * in the same shard when others are added, removed or reordered, and what a
 * shard finds does not move with them.
 */
export class Shards {
  /**
   * 32-bit FNV-1a, which is stable across runs and machines.
   *
   * @param text - the operation's `METHOD /path` name.
   */
  private static hash(text: string): number {
    let hash = 0x811c9dc5;
    for (const character of text) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
  }

  /**
   * @param operations - what to deal out, each with the `name` that decides its shard.
   * @param count - how many shards; one when below 1.
   * @returns the non-empty shards, in shard order.
   */
  static of<T extends { name: string }>(operations: readonly T[], count: number): T[][] {
    const size = Math.max(1, Math.floor(count));
    const shards: T[][] = Array.from({ length: size }, () => {
      return [];
    });
    for (const operation of operations) {
      shards[Shards.hash(operation.name) % size]?.push(operation);
    }
    return shards.filter((shard) => {
      return shard.length > 0;
    });
  }
}
