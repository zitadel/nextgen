import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import dns from "node:dns";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { dirname, join } from "node:path";
import tls from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The name the remote lane's server goes by. It resolves to loopback only in
 * processes that preload `resolve-remote-host.mjs` (see {@link remoteHostEnv}).
 */
export const REMOTE_HOST = "zitadel.test";

const here = dirname(fileURLToPath(import.meta.url));

// Connection-level headers, meaningful only between two directly connected peers.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Starts a local stand-in for the https edge of a hosted deployment, in front
 * of the local runtime on `upstreamPort`. It behaves the way Vercel's edge
 * does, which is what a scaffolded dev proxy meets in the hosted cloud:
 *
 * - it completes a TLS handshake only for {@link REMOTE_HOST}, refusing any
 *   other server name;
 * - it routes by `Host`, answering `421 Misdirected Request` to any other;
 * - it sets `X-Forwarded-Host`, `-Proto` and `-For` to what it saw itself,
 *   overwriting whatever the client sent.
 *
 * Its certificate is minted with `openssl` into `dir` for the run, so no
 * private key is checked in. Each request is logged to `logPath`, without
 * cookies or credentials. Port 0 takes one the OS assigns.
 *
 * @param {{ port: number, upstreamPort: number, dir: string, logPath: string }} options
 * @returns {Promise<{ url: string, certPath: string, close(): Promise<void> }>}
 */
export async function startHttpsEdge({ port, upstreamPort, dir, logPath }) {
  const { cert, certPath, key } = mintCertificate(dir);
  let ownHost = "";
  const log = (line) => appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
  const context = tls.createSecureContext({ cert, key });

  const server = https.createServer(
    {
      cert,
      key,
      SNICallback: (servername, accept) =>
        servername === REMOTE_HOST
          ? accept(null, context)
          : accept(new Error(`no certificate for ${servername}`)),
    },
    (req, res) => {
      const seen = describeRequest(req);
      if (req.headers.host !== ownHost) {
        log(`421 ${seen}`);
        res.writeHead(421, { "content-type": "text/plain" }).end("misdirected request");
        return;
      }
      const headers = withoutHopByHop(req.headers);
      headers["x-forwarded-host"] = ownHost;
      headers["x-forwarded-proto"] = "https";
      headers["x-forwarded-for"] = req.socket.remoteAddress ?? "";
      const upstream = http.request(
        {
          host: "127.0.0.1",
          port: upstreamPort,
          method: req.method,
          path: req.url,
          headers,
        },
        (response) => {
          log(`${response.statusCode} ${seen}`);
          res.writeHead(response.statusCode ?? 502, withoutHopByHop(response.headers));
          response.pipe(res);
        },
      );
      upstream.on("error", (error) => {
        log(`502 ${seen} (local runtime: ${error.message})`);
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "text/plain" });
        }
        res.end("bad gateway");
      });
      req.pipe(upstream);
    },
  );
  server.on("tlsClientError", (error, socket) => {
    log(`refused TLS for ${socket.servername || "no server name"}: ${error.message}`);
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  ownHost = `${REMOTE_HOST}:${server.address().port}`;
  const url = `https://${ownHost}`;
  log(`listening on ${url}, forwarding to http://127.0.0.1:${upstreamPort}`);

  return {
    url,
    certPath,
    close: () =>
      new Promise((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}

/**
 * The environment a child process needs to reach the edge by name: the
 * preloaded resolver for {@link REMOTE_HOST} and trust for the edge's
 * certificate. NODE_OPTIONS and NODE_EXTRA_CA_CERTS the caller already sets
 * are kept, the extra certificates bundled with the edge's in `dir`.
 *
 * @param {{ certPath: string, dir: string, env?: NodeJS.ProcessEnv }} options
 * @returns {{ NODE_OPTIONS: string, NODE_EXTRA_CA_CERTS: string }}
 */
export function remoteHostEnv({ certPath, dir, env = process.env }) {
  const preload = `--import=${pathToFileURL(join(here, "resolve-remote-host.mjs")).href}`;
  let extraCerts = certPath;
  if (env.NODE_EXTRA_CA_CERTS) {
    extraCerts = join(dir, "extra-ca-certs.pem");
    writeFileSync(
      extraCerts,
      `${readFileSync(env.NODE_EXTRA_CA_CERTS, "utf8").trimEnd()}\n${readFileSync(certPath, "utf8")}`,
    );
  }
  return {
    NODE_OPTIONS: env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${preload}` : preload,
    NODE_EXTRA_CA_CERTS: extraCerts,
  };
}

/**
 * Makes `dns.lookup` answer {@link REMOTE_HOST} with loopback, and leaves any
 * other name to the original. Returns a function that undoes it.
 *
 * @param {typeof dns} dnsModule
 * @returns {() => void}
 */
export function installRemoteHostResolution(dnsModule = dns) {
  const lookup = dnsModule.lookup;
  dnsModule.lookup = function lookupRemoteHost(hostname, options, callback) {
    if (hostname !== REMOTE_HOST) {
      return lookup.call(this, hostname, options, callback);
    }
    const done = typeof options === "function" ? options : callback;
    if (typeof options === "object" && options !== null && options.all) {
      process.nextTick(done, null, [{ address: "127.0.0.1", family: 4 }]);
    } else {
      process.nextTick(done, null, "127.0.0.1", 4);
    }
  };
  return () => {
    dnsModule.lookup = lookup;
  };
}

/**
 * A self-signed certificate for {@link REMOTE_HOST}, in a directory of its own
 * under `dir` so two edges never share one. The subject is unique per run:
 * OpenSSL finds a trusted certificate by subject, so another one named
 * `zitadel.test` in NODE_EXTRA_CA_CERTS would otherwise shadow it.
 */
function mintCertificate(dir) {
  const certDir = mkdtempSync(join(dir, "edge-"));
  const certPath = join(certDir, "cert.pem");
  const keyPath = join(certDir, "key.pem");
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
  return { cert: readFileSync(certPath, "utf8"), certPath, key: readFileSync(keyPath, "utf8") };
}

function withoutHopByHop(headers) {
  const kept = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && value !== undefined) {
      kept[name] = value;
    }
  }
  return kept;
}

/** What the edge was asked, and how the client addressed it — never cookies or credentials. */
function describeRequest(req) {
  const socket = /** @type {tls.TLSSocket} */ (req.socket);
  return [
    `${req.method} ${req.url}`,
    `sni=${socket.servername || "-"}`,
    `host=${req.headers.host ?? "-"}`,
    `origin=${req.headers.origin ?? "-"}`,
    `x-forwarded-host=${req.headers["x-forwarded-host"] ?? "-"}`,
    `x-forwarded-proto=${req.headers["x-forwarded-proto"] ?? "-"}`,
  ].join(" ");
}
