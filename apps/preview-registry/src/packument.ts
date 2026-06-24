import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { x as untar } from "tar";

import type { BlobEntry, BlobStore } from "./storage.js";

/**
 * Subset of an npm package manifest the registry needs to surface.
 *
 * Any extra fields a tarball ships are preserved verbatim when the
 * packument is built, so consumers see the same metadata pnpm pack
 * placed inside the archive.
 */
export interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly [field: string]: unknown;
}

/**
 * The metadata document the npm client GETs before downloading a tarball.
 *
 * Only the three fields a vanilla `npm install` resolver looks at are
 * modelled here: the canonical package name, the dist-tag map (with
 * `latest` populated), and the per-version manifest map keyed by SemVer.
 */
export interface Packument {
  readonly name: string;
  readonly "dist-tags": Readonly<Record<string, string>>;
  readonly versions: Readonly<
    Record<
      string,
      PackageManifest & {
        readonly dist: {
          readonly tarball: string;
          readonly shasum: string;
          readonly integrity: string;
          readonly unpackedSize: number;
        };
      }
    >
  >;
}

/**
 * Result of {@link extractManifestFromTarball}.
 *
 * Bundles the manifest with the integrity hashes the npm CLI compares
 * against the downloaded body before installing.
 */
interface TarballSummary {
  readonly manifest: PackageManifest;
  readonly shasum: string;
  readonly integrity: string;
  readonly size: number;
}

/**
 * Read `package/package.json` out of a packed npm tarball and compute
 * the integrity hashes the npm CLI expects.
 *
 * Streams the tarball through `tar.x` with a filter so only the
 * manifest entry is buffered. Anything else inside the tarball is
 * skipped without allocating memory for it.
 */
const extractManifestFromTarball = async (tarballBytes: Buffer): Promise<TarballSummary> => {
  const shasum = createHash("sha1").update(tarballBytes).digest("hex");
  const integrity = "sha512-" + createHash("sha512").update(tarballBytes).digest("base64");

  const manifest = await new Promise<PackageManifest>((resolve, reject) => {
    let captured: PackageManifest | undefined;
    const parser = untar({
      filter: (path) => path === "package/package.json",
      onentry: (entry) => {
        // tar's ReadEntry is a Readable stream at runtime but its TS
        // type omits the EventEmitter surface — cast to the standard
        // node stream type so the build passes under stricter tsconfigs
        // (eg the one @vercel/node applies to api/*.ts).
        const stream = entry as unknown as NodeJS.ReadableStream;
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          captured = JSON.parse(Buffer.concat(chunks).toString("utf8")) as PackageManifest;
        });
        stream.on("error", reject);
      },
    });
    Readable.from(tarballBytes)
      .pipe(parser)
      .on("finish", () => {
        if (captured) resolve(captured);
        else reject(new Error("no package/package.json inside tarball"));
      })
      .on("error", reject);
  });

  return { manifest, shasum, integrity, size: tarballBytes.length };
};

/**
 * Build an npm packument by reading every tarball matching a package
 * out of a {@link BlobStore} and unpacking each one's manifest.
 *
 * @param store - The blob store backing this deploy.
 * @param scope - The npm scope, including the leading `@` (eg `@mridang`).
 * @param name - The unscoped package name (eg `foo` for `@mridang/foo`).
 * @returns The packument, or `null` if no tarballs match.
 */
export const buildPackument = async (
  store: BlobStore,
  scope: string,
  name: string,
): Promise<Packument | null> => {
  const prefix = `${scope}/${name}/-/`;
  const blobs = (await store.list(prefix)).filter((blob: BlobEntry) => blob.key.endsWith(".tgz"));
  if (blobs.length === 0) return null;

  const summaries = await Promise.all(
    blobs.map(async (blob) => {
      const tarball = await store.read(blob.key);
      const summary = await extractManifestFromTarball(tarball);
      return { blob, summary };
    }),
  );

  const versions = Object.fromEntries(
    summaries.map(({ blob, summary }) => [
      summary.manifest.version,
      {
        ...summary.manifest,
        dist: {
          tarball: blob.url,
          shasum: summary.shasum,
          integrity: summary.integrity,
          unpackedSize: summary.size,
        },
      },
    ]),
  );

  const latest = summaries.reduce<{ version: string; uploadedAt: number } | undefined>(
    (winner, { blob, summary }) => {
      const uploadedAt = blob.uploadedAt.getTime();
      return !winner || uploadedAt > winner.uploadedAt
        ? { version: summary.manifest.version, uploadedAt }
        : winner;
    },
    undefined,
  );

  return {
    name: `${scope}/${name}`,
    "dist-tags": latest ? { latest: latest.version } : {},
    versions,
  };
};
