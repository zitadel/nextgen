import { createHash } from "node:crypto";
import { posix } from "node:path";

/**
 * The body of the `PUT /<name>` that `npm publish` sends a registry for one
 * tarball, with `tags` pointing at its version. `manifest` is the package.json
 * packed into it. Only what an install reads is kept the way npm writes it:
 * the manifest, `bin` normalized as npm does, and the tarball's digests;
 * npm's own bookkeeping fields (`_npmVersion`, `_resolved`, …) are left out.
 */
export function publishBody(manifest, tarball, registryUrl, tags) {
  const { name, version } = manifest;
  const filename = `${name}-${version}.tgz`;
  return {
    _id: name,
    name,
    description: manifest.description,
    "dist-tags": Object.fromEntries(tags.map((tag) => [tag, version])),
    access: "public",
    versions: {
      [version]: {
        ...manifest,
        ...(manifest.bin === undefined ? {} : { bin: normalizeBin(name, manifest.bin) }),
        _id: `${name}@${version}`,
        dist: {
          integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
          shasum: createHash("sha1").update(tarball).digest("hex"),
          tarball: `${registryUrl}/${name}/-/${filename}`,
        },
      },
    },
    _attachments: {
      [filename]: {
        content_type: "application/octet-stream",
        data: tarball.toString("base64"),
        length: tarball.length,
      },
    },
  };
}

// npm-normalize-package-bin: a string names the package's own command, and
// every path is relative to the package root with no leading `./`.
function normalizeBin(name, bin) {
  const entries = typeof bin === "string" ? [[name.split("/").pop(), bin]] : Object.entries(bin);
  return Object.fromEntries(
    entries.map(([command, path]) => [
      posix.basename(command),
      posix.join("/", path.replaceAll("\\", "/")).slice(1),
    ]),
  );
}
