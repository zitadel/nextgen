/**
 * Puts `value` on the clipboard and says whether it got there: `false` for a
 * refused write and for the missing clipboard of an insecure origin, so the
 * caller never claims a copy that did not happen.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
