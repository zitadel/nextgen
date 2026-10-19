import dns from "node:dns";
import net from "node:net";

import { afterAll, afterEach } from "vitest";

/**
 * Keeps the suite on this machine: a test that opens a connection anywhere but
 * loopback fails, naming where it tried to go. A test reaches a server through
 * msw, which answers before any socket is opened, or through a server it starts
 * on localhost itself; nothing else is needed, so nothing else is allowed.
 *
 * Refusing the connection is not enough on its own. The CLI carries on past a
 * server it cannot reach — `auth-method sso enable` reports the publish as
 * failed and exits 0 — so a test that leaked to the real platform still passed:
 * slowly, and not at all once a request stalled past the timeout. So every
 * refusal is also recorded, and the test fails after it ends, whatever the
 * command made of it.
 *
 * A name is refused before anyone is asked to resolve it, so the verdict is the
 * same online and offline. A test that resolves a name itself, the way
 * `remote-server.ts` points `zitadel.test` at loopback, is taken at its word
 * when the address it answers with is local.
 */

/** Addresses that never leave the machine: loopback, and the unspecified address, which connects to it. */
const LOCAL = new net.BlockList();
LOCAL.addSubnet("127.0.0.0", 8, "ipv4");
LOCAL.addAddress("0.0.0.0", "ipv4");
LOCAL.addAddress("::1", "ipv6");
LOCAL.addAddress("::", "ipv6");

/** What `connect` reads once its overloads are resolved. */
type ConnectOptions = {
  host?: string;
  port?: number | string;
  path?: string;
  lookup?: net.LookupFunction;
};

/** `[options, callback]`, as `net.connect` passes them on. */
type NormalizedArgs = [ConnectOptions, unknown];

/** `net.connect`'s own overload resolution, which `@types/node` leaves out. */
const { _normalizeArgs: normalizeArgs } = net as unknown as {
  _normalizeArgs(args: unknown[]): NormalizedArgs;
};

/** The connections refused since the last check, shared by every file a worker runs. */
type Offline = { readonly refused: string[] };

const INSTALLED = Symbol.for("@zitadel/cli/tests/offline");

const offline = installOnce();

afterEach(() => assertStayedLocal());
// A connection made after a file's last test still belongs to that file.
afterAll(() => assertStayedLocal());

function assertStayedLocal(): void {
  const refused = [...new Set(offline.refused.splice(0))];
  if (refused.length > 0) {
    throw new Error(
      `Tried to reach ${refused.join(", ")}, which is not this machine. Answer the request with msw ` +
        "(`setupServer`, or `usePlatformMock()` in a spec) or a server the test starts on localhost.",
    );
  }
}

/**
 * Wraps `Socket.prototype.connect`, which every TCP connection goes through —
 * `fetch`, `http`, `https` and `tls` alike — once per worker: the prototype
 * outlives the module graph each test file gets.
 */
function installOnce(): Offline {
  const holder = globalThis as { [INSTALLED]?: Offline };
  const installed = holder[INSTALLED];
  if (installed !== undefined) {
    return installed;
  }
  const state: Offline = { refused: [] };
  holder[INSTALLED] = state;

  // The system resolver, as it was before any test replaced it.
  const resolver = dns.lookup;
  const connect = net.Socket.prototype.connect;

  /** Records the attempt, and fails it the way a closed port would. */
  const refuse = (target: string): Error => {
    state.refused.push(target);
    return Object.assign(new Error(`connect ECONNREFUSED ${target} (tests/helpers/offline.ts)`), {
      code: "ECONNREFUSED",
    });
  };

  /** Lets the resolver a test supplied answer, as long as it answers with this machine. */
  const answeringLocally =
    (lookup: net.LookupFunction, port: unknown): net.LookupFunction =>
    (hostname, options, callback) => {
      lookup(hostname, options, (error, address, family) => {
        if (error !== null) {
          callback(error, address, family);
          return;
        }
        const addresses =
          typeof address === "string" ? [address] : address.map((each) => each.address);
        const elsewhere = addresses.find((each) => !isLocalAddress(each));
        if (elsewhere === undefined) {
          callback(null, address, family);
        } else {
          callback(refuse(`${hostname} (${elsewhere}):${String(port)}`), address, family);
        }
      });
    };

  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    // `net.connect` hands its arguments on already resolved; anything else is
    // one of the public overloads.
    const normalized = Array.isArray(args[0]) ? (args[0] as NormalizedArgs) : normalizeArgs(args);
    const [options] = normalized;
    // A pipe or a Unix socket is on this machine by construction.
    if (options.path) {
      return Reflect.apply(connect, this, [normalized]) as net.Socket;
    }
    // `||`, as `connect` itself defaults it: an empty host is localhost too.
    const host = (options.host || "localhost").replace(/^\[(.*)\]$/, "$1");
    const lookup = options.lookup ?? dns.lookup;
    const named = net.isIP(host) === 0;
    // Any other name is the system resolver's to place, and asking it can
    // already be a request off the machine.
    const elsewhere = named ? lookup === resolver && host !== "localhost" : !isLocalAddress(host);
    if (elsewhere) {
      const error = refuse(`${host}:${String(options.port)}`);
      // On the next tick, as a refused connection fails, so the caller's error
      // listener is in place by then.
      process.nextTick(() => this.destroy(error));
      return this;
    }
    if (named) {
      normalized[0] = { ...options, lookup: answeringLocally(lookup, options.port) };
    }
    return Reflect.apply(connect, this, [normalized]) as net.Socket;
  } as typeof connect;

  return state;
}

function isLocalAddress(address: string): boolean {
  const family = net.isIP(address);
  return family !== 0 && LOCAL.check(address, family === 6 ? "ipv6" : "ipv4");
}
