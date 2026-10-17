import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import dns from "node:dns";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { brotliCompressSync, gzipSync } from "node:zlib";

import { afterAll, beforeAll } from "vitest";

/** The remote server's name, which resolves to loopback only in this process. */
export const REMOTE_HOST = "zitadel.test";

/** The session token the remote server hands out, in the body and the cookie. */
export const SESSION_TOKEN = "SECRET-SESSION-TOKEN";

/** The `Set-Cookie` the remote server answers every `/sessions/*` call with. */
export const SESSION_COOKIE = `__nextgen_session=${SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Lax`;

/** The body the remote server answers every `/sessions/*` call with: the exchange's. */
export const EXCHANGE_BODY = { session: { session_id: "s1" }, session_token: SESSION_TOKEN };

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
 * is answered `200`, so a test sees what the server was sent rather than how it
 * would have handled it: a `/sessions/*` path with the session exchange's
 * {@link EXCHANGE_BODY} and {@link SESSION_COOKIE} (plain text when the query
 * has `as=text`, with the status of `status=<code>` if given), anything else
 * with `ok`.
 *
 * A `/sessions/*` query can make that answer misbehave the way an intermediary
 * might, whatever the request asked for: `encoding=gzip` or `encoding=br`
 * compresses it, `encoding=garbled` labels as `gzip` bytes that are neither
 * gzip nor JSON but still carry the token, and `abort` drops the connection
 * halfway through the body, and `bom` puts a UTF-8 byte order mark before it.
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
        if (misdirected) {
          res.writeHead(421, { "content-type": "text/plain" });
          res.end("misdirected");
        } else if (req.url?.startsWith("/sessions/") && !req.url.includes("as=text")) {
          answerSession(new URL(req.url, url).searchParams, res);
        } else {
          const status = new URL(req.url ?? "/", url).searchParams.get("status");
          res.writeHead(Number(status ?? 200), { "content-type": "text/plain" });
          res.end("ok");
        }
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

/** Answers a `/sessions/*` call with the exchange's body, misbehaving as `query` asks. */
function answerSession(query: URLSearchParams, res: ServerResponse): void {
  const plain = Buffer.from(JSON.stringify(EXCHANGE_BODY));
  const encoding = query.get("encoding");
  const body = query.has("bom")
    ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), plain])
    : encoding === "gzip"
      ? gzipSync(plain)
      : encoding === "br"
        ? brotliCompressSync(plain)
        : encoding === "garbled"
          ? Buffer.concat([Buffer.from("garbled:"), plain])
          : plain;
  res.writeHead(200, {
    "content-type": "application/json",
    "set-cookie": SESSION_COOKIE,
    ...(encoding === null
      ? {}
      : { "content-encoding": encoding === "garbled" ? "gzip" : encoding }),
  });
  if (query.has("abort")) {
    res.write(body.subarray(0, body.length / 2), () => res.destroy());
  } else {
    res.end(body);
  }
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
