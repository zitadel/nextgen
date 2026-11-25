import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { join } from "node:path";

/**
 * How the CLI reaches a deployment behind Vercel's Deployment Protection
 * without knowing it is protected: through a forward proxy shaped like a
 * company's TLS-inspecting proxy, which the CLI meets through Node's own proxy
 * support (`NODE_USE_ENV_PROXY`, `HTTPS_PROXY`) and trusts through
 * `NODE_EXTRA_CA_CERTS`. The CLI keeps addressing the deployment by its own
 * https URL, so everything it writes and prints names that URL; it never holds
 * the bypass secret, and has no flag or code path for it.
 *
 * - A tunnel to the deployment's host is answered by the proxy itself, with a
 *   certificate minted for that name for this run: each request is forwarded
 *   to the deployment with `x-vercel-protection-bypass` added.
 * - A tunnel to any other host (the npm registry `setup` scaffolds from) is
 *   passed through untouched.
 * - A request that is not a tunnel is refused: the CLI speaks https only.
 *
 * A request that slipped past the proxy would meet Vercel's sign-in page and
 * fail the command, so a passing run proves every request went through it.
 */
export type BypassProxy = {
  /** The proxy's own URL, for `HTTPS_PROXY`. */
  url: string;
  /** The certificate the proxy presents for the deployment's host. */
  certPath: string;
  close(): Promise<void>;
};

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

const ESTABLISHED = "HTTP/1.1 200 Connection Established\r\n\r\n";

export async function startBypassProxy(options: {
  /** The deployment's origin, `https://cloud-….vercel.app`. */
  deployment: string;
  secret: string;
  /** A directory of this run's, for the certificate. */
  dir: string;
}): Promise<BypassProxy> {
  const target = new URL(options.deployment);
  if (target.protocol !== "https:") {
    throw new Error(`the bypass proxy serves an https deployment, not ${target.origin}`);
  }
  const host = target.hostname;
  const port = Number(target.port || 443);
  const { cert, certPath, key } = mintCertificate(host, options.dir);
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };

  // Never listens: the proxy hands it the tunnels to the deployment.
  const inspector = https.createServer({ cert, key }, (req, res) => {
    const headers = withoutHopByHop(req.headers);
    headers.host = target.host;
    headers["x-vercel-protection-bypass"] = options.secret;
    const upstream = https.request(
      { host, port, servername: host, method: req.method, path: req.url, headers },
      (response) => {
        res.writeHead(response.statusCode ?? 502, withoutHopByHop(response.headers));
        response.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
      }
      res.end(`the bypass proxy could not reach ${target.origin}: ${error.message}`);
    });
    req.pipe(upstream);
  });

  const proxy = http.createServer((_req, res) => {
    res.writeHead(501, { "content-type": "text/plain" }).end("only CONNECT tunnels");
  });
  proxy.on("connect", (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    track(socket);
    socket.on("error", () => socket.destroy());
    const [tunnelHost, tunnelPort] = splitAuthority(req.url ?? "");
    if (tunnelHost === host && tunnelPort === port) {
      socket.write(ESTABLISHED);
      if (head.length > 0) {
        socket.unshift(head);
      }
      inspector.emit("connection", socket);
      return;
    }
    const upstream = net.connect(tunnelPort, tunnelHost, () => {
      socket.write(ESTABLISHED);
      if (head.length > 0) {
        upstream.write(head);
      }
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    track(upstream);
    upstream.on("error", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", () => {
      proxy.off("error", reject);
      resolve();
    });
  });
  const address = proxy.address() as net.AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    certPath,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        proxy.close(() => resolve());
      }),
  };
}

/**
 * The environment a CLI process needs to go through `proxy`: Node's proxy
 * support switched on and pointed at it, and trust for the certificate it
 * presents. Anything that would route around it (`NO_PROXY`) is dropped, and
 * certificates the caller already trusts are kept.
 */
export function bypassProxyEnv(
  proxy: Pick<BypassProxy, "url" | "certPath">,
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const { NO_PROXY: _NO_PROXY, no_proxy: _no_proxy, https_proxy: _https_proxy, ...kept } = env;
  let extraCerts = proxy.certPath;
  if (env.NODE_EXTRA_CA_CERTS) {
    extraCerts = join(dir, "extra-ca-certs.pem");
    writeFileSync(
      extraCerts,
      `${readFileSync(env.NODE_EXTRA_CA_CERTS, "utf8").trimEnd()}\n${readFileSync(proxy.certPath, "utf8")}`,
    );
  }
  return {
    ...kept,
    NODE_USE_ENV_PROXY: "1",
    HTTPS_PROXY: proxy.url,
    NODE_EXTRA_CA_CERTS: extraCerts,
  };
}

/** `host:port` of a CONNECT request, with an IPv6 host's brackets removed. */
function splitAuthority(authority: string): [string, number] {
  const url = new URL(`http://${authority}`);
  return [url.hostname.replace(/^\[(.*)\]$/, "$1"), Number(url.port || 443)];
}

/**
 * A self-signed certificate for `host`, minted with `openssl` for the run, so
 * no private key is checked in. The subject is unique per run: OpenSSL finds
 * a trusted certificate by subject, so another one of the same name in
 * NODE_EXTRA_CA_CERTS would otherwise shadow it.
 */
function mintCertificate(host: string, dir: string) {
  const certDir = mkdtempSync(join(dir, "proxy-"));
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
      `/CN=${host}/OU=${randomUUID()}`,
      "-addext",
      `subjectAltName=DNS:${host}`,
      "-keyout",
      keyPath,
      "-out",
      certPath,
    ],
    { stdio: "ignore" },
  );
  return { cert: readFileSync(certPath, "utf8"), certPath, key: readFileSync(keyPath, "utf8") };
}

function withoutHopByHop(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const kept: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && value !== undefined) {
      kept[name] = value;
    }
  }
  return kept;
}
