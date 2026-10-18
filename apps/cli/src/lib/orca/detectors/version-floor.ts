import { ZitadelError } from "../../errors";
import {
  dependencySpecProvablyBelow,
  installedVersionBelow,
  type PackageJson,
} from "./package-json";
import type { Detector } from "./types";

/**
 * The one place a framework version floor is enforced (ADR 043). Each detector
 * declares its `versionFloor` and `versionPackage`; its `detect` calls this
 * once it has recognised the project, so `setup` and `doctor` share a single
 * loud gate and no detector carries its own checking logic.
 *
 * Throws `E_UNSUPPORTED_PROJECT_SHAPE` only for a provable violation: a
 * declared spec that cannot resolve to the floor or newer, or an installed
 * release older than the floor (a range such as `^15.0.0` can still be locked
 * to an older one). Protocol specs and dist-tags pass, a prerelease of the
 * floor counts as at-floor, and a newer major is never refused. With nothing
 * installed the declared spec is the only gate.
 */
export async function enforceVersionFloor(
  detector: Pick<Detector, "displayName" | "versionPackage" | "versionFloor" | "versionFloorNote">,
  pkg: PackageJson,
  cwd: string,
): Promise<void> {
  const { displayName, versionPackage, versionFloor, versionFloorNote } = detector;
  const hint = [`Upgrade the app to ${displayName} ${versionFloor} or later and rerun.`]
    .concat(versionFloorNote ?? [])
    .join(" ");
  const supported = `the CLI integrates ${displayName} ${versionFloor} and newer`;

  const declared = dependencySpecProvablyBelow(pkg, versionPackage, versionFloor);
  if (declared !== undefined) {
    throw new ZitadelError(
      "E_UNSUPPORTED_PROJECT_SHAPE",
      `${displayName} "${declared}" is below the supported floor — ${supported}`,
      { hint },
    );
  }

  const installed = await installedVersionBelow(cwd, versionPackage, versionFloor);
  if (installed !== undefined) {
    throw new ZitadelError(
      "E_UNSUPPORTED_PROJECT_SHAPE",
      `${displayName} ${installed} is installed, below the supported floor — ${supported}`,
      { hint },
    );
  }
}
