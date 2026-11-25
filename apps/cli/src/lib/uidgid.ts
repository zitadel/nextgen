/**
 * The user and group this process runs as, so files a container writes into a
 * mounted directory belong to the developer and not to root. Empty where there
 * are no user ids (Windows); the group falls back to the user id where the
 * platform has no group id.
 */
export function currentUser(): { uid?: number; gid?: number } {
  const getuid = process.getuid;
  const getgid = process.getgid;
  if (typeof getuid !== "function") {
    return {};
  }
  const uid = getuid();
  const gid = typeof getgid === "function" ? getgid() : uid;
  return { uid, gid };
}
