/**
 * The first candidate `read` finds something for, with what it found. Candidates
 * are tried in order and the rest are left unread once one answers.
 */
export async function firstExisting<T>(
  candidates: ReadonlyArray<string>,
  read: (candidate: string) => Promise<T | undefined>,
): Promise<{ candidate: string; found: T } | undefined> {
  for (const candidate of candidates) {
    const found = await read(candidate);
    if (found !== undefined) {
      return { candidate, found };
    }
  }
  return undefined;
}
