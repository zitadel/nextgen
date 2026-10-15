import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import dns from "node:dns";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";

import { afterAll, beforeAll } from "vitest";

/** The remote server's name, which resolves to loopback only in this process. */
export const REMOTE_HOST = "zitadel.test";

/** A request as it reached the remote server. */
export interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  /** The TLS server name the client sent, if any. */
  readonly servername: string | undefined;
}

/**
 * A remote https Zitadel as a dev proxy meets it: reachable by its own name
 * only. It completes a TLS handshake only for {@link REMOTE_HOST}, the way a
 * shared edge such as Vercel refuses any other server name, and it routes by
 * `Host`, answering `421 Misdirected Request` to anything else. Every request
 * is answered `200 ok`, so a test sees what the server was sent rather than
 * how it would have handled it.
 */
export interface RemoteServer {
  /** `https://zitadel.test:<port>`. */
  readonly url: string;
  /** The requests that reached the server, oldest first. */
  readonly requests: ReadonlyArray<ReceivedRequest>;
}

/**
 * Starts a {@link RemoteServer} for one test file. Its certificate is minted
 * with `openssl` for the run, so no private key is checked in, and is trusted
 * by this process only; {@link REMOTE_HOST} resolves to loopback the same
 * way. Both are undone after the file.
 */
export function useRemoteServer(): RemoteServer {
  const requests: ReceivedRequest[] = [];
  let url = "";
  let server: Server | undefined;
  let dir = "";
  let defaultCAs: string[] = [];
  const lookup = dns.lookup;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "zitadel-remote-"));
    const { cert, key } = await mintCertificate(dir);
    defaultCAs = tls.getCACertificates("default");
    tls.setDefaultCACertificates([...defaultCAs, cert]);
    dns.lookup = resolvingRemoteHost(lookup);

    const context = tls.createSecureContext({ cert, key });
    const started = createServer(
      {
        cert,
        key,
        SNICallback: (servername, accept) =>
          servername === REMOTE_HOST
            ? accept(null, context)
            : accept(new Error(`no certificate for ${servername}`)),
      },
      (req, res) => {
        requests.push({
          method: req.method ?? "",
          path: req.url ?? "",
          headers: req.headers,
          servername: (req.socket as tls.TLSSocket).servername || undefined,
        });
        const misdirected = req.headers.host !== new URL(url).host;
        res.writeHead(misdirected ? 421 : 200, { "content-type": "text/plain" });
        res.end(misdirected ? "misdirected" : "ok");
      },
    );
    await new Promise<void>((resolve) => started.listen(0, "127.0.0.1", resolve));
    server = started;
    url = `https://${REMOTE_HOST}:${(started.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    dns.lookup = lookup;
    tls.setDefaultCACertificates(defaultCAs);
    await rm(dir, { recursive: true, force: true });
  });

  return {
    get url() {
      return url;
    },
    requests,
  };
}

/**
 * A self-signed certificate for {@link REMOTE_HOST}. The subject is unique per
 * run: OpenSSL finds a trusted certificate by subject, so another one named
 * `zitadel.test` in the store (`NODE_EXTRA_CA_CERTS`) would otherwise shadow it.
 */
async function mintCertificate(dir: string): Promise<{ cert: string; key: string }> {
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-days",
      "1",
      "-subj",
      `/CN=${REMOTE_HOST}/OU=${randomUUID()}`,
      "-addext",
      `subjectAltName=DNS:${REMOTE_HOST}`,
      "-keyout",
      keyPath,
      "-out",
      certPath,
    ],
    { stdio: "ignore" },
  );
  return { cert: await readFile(certPath, "utf8"), key: await readFile(keyPath, "utf8") };
}

/** `dns.lookup`, answering {@link REMOTE_HOST} with loopback and anything else as before. */
function resolvingRemoteHost(lookup: typeof dns.lookup): typeof dns.lookup {
  return ((hostname: string, options: unknown, callback?: unknown) => {
    const done = (typeof options === "function" ? options : callback) as (
      error: NodeJS.ErrnoException | null,
      address: string | dns.LookupAddress[],
      family?: number,
    ) => void;
    if (hostname !== REMOTE_HOST) {
      return typeof options === "function"
        ? lookup(hostname, done)
        : lookup(hostname, options as dns.LookupOptions, done);
    }
    if (typeof options === "object" && options !== null && (options as dns.LookupOptions).all) {
      process.nextTick(done, null, [{ address: "127.0.0.1", family: 4 }]);
    } else {
      process.nextTick(done, null, "127.0.0.1", 4);
    }
  }) as typeof dns.lookup;
}
