/** `fn` over `items` with at most `limit` calls in flight, results in item order. */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) {
      out[index] = await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
