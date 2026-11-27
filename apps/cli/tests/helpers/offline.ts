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

/**
 * What `connect` reads once its overloads are resolved. A caller may leave any
 * of these out or pass `null`, which `connect` treats as left out.
 */
type ConnectOptions = {
  readonly host?: string | null;
  readonly port?: number | string | null;
  readonly path?: string | null;
  readonly lookup?: net.LookupFunction | null;
};

/** `[options, callback]`, as `net.connect` passes them on. */
type NormalizedArgs = [ConnectOptions, unknown];

/**
 * Whether a value is absent, or a string.
 *
 * @param value - The field read.
 * @returns Whether it is `undefined`, `null` or a string.
 */
function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

/**
 * Whether a value is the options `connect` reads, every field it reads either
 * absent or of the kind `net.connect` documents.
 *
 * @param value - What sits first in the arguments.
 * @returns Whether it can be read as {@link ConnectOptions}.
 */
function isConnectOptions(value: unknown): value is ConnectOptions {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const host = "host" in value ? value.host : undefined;
  const port = "port" in value ? value.port : undefined;
  const path = "path" in value ? value.path : undefined;
  const lookup = "lookup" in value ? value.lookup : undefined;
  return (
    isOptionalString(host) &&
    isOptionalString(path) &&
    (isOptionalString(port) || typeof port === "number") &&
    (lookup === undefined || lookup === null || typeof lookup === "function")
  );
}

/**
 * Whether a value is the `[options, callback]` pair `net.connect` hands on
 * once it has resolved its overloads.
 *
 * @param value - The first argument `connect` was given.
 * @returns Whether it is that pair.
 */
function isNormalizedArgs(value: unknown): value is NormalizedArgs {
  if (!Array.isArray(value)) {
    return false;
  }
  const [options]: unknown[] = value;
  return isConnectOptions(options);
}

/**
 * `net.connect`'s own overload resolution, an internal `@types/node` leaves
 * out, so it is looked up by name and what it answers is checked.
 *
 * @param args - The arguments as a caller passed them to `connect`.
 * @returns The `[options, callback]` pair they resolve to.
 */
function normalizeArgs(args: unknown[]): NormalizedArgs {
  const internal: unknown = Reflect.get(net, "_normalizeArgs");
  if (typeof internal !== "function") {
    throw new Error(
      "net._normalizeArgs is gone, so tests/helpers/offline.ts cannot read connect's arguments.",
    );
  }
  const normalized: unknown = Reflect.apply(internal, undefined, [args]);
  if (!isNormalizedArgs(normalized)) {
    throw new Error("net._normalizeArgs answered something other than [options, callback].");
  }
  return normalized;
}

/** The connections refused since the last check, shared by every file a worker runs. */
type Offline = { readonly refused: string[] };

/** Where the worker's {@link Offline} is kept, so every test file finds the same one. */
const INSTALLED = Symbol.for("@zitadel/cli/tests/offline");

/**
 * Whether a value is the {@link Offline} an earlier test file installed.
 *
 * @param value - What the global holds under {@link INSTALLED}.
 * @returns Whether it is that record.
 */
function isOffline(value: unknown): value is Offline {
  return (
    typeof value === "object" &&
    value !== null &&
    "refused" in value &&
    Array.isArray(value.refused)
  );
}

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
  const installed: unknown = Reflect.get(globalThis, INSTALLED);
  if (isOffline(installed)) {
    return installed;
  }
  const state: Offline = { refused: [] };
  Reflect.set(globalThis, INSTALLED, state);

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

  /**
   * Hands the connection to the real `connect`, in the resolved form it takes
   * internally, which `@types/node` does not declare.
   *
   * @param socket - The socket connecting.
   * @param normalized - Its resolved arguments.
   * @returns What `connect` returns: the socket itself.
   */
  const proceed = (socket: net.Socket, normalized: NormalizedArgs): net.Socket => {
    const connected: unknown = Reflect.apply(connect, socket, [normalized]);
    return connected instanceof net.Socket ? connected : socket;
  };

  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]): net.Socket {
    // `net.connect` hands its arguments on already resolved; anything else is
    // one of the public overloads.
    const [first] = args;
    const normalized = isNormalizedArgs(first) ? first : normalizeArgs(args);
    const [options] = normalized;
    // A pipe or a Unix socket is on this machine by construction.
    if (options.path) {
      return proceed(this, normalized);
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
    return proceed(this, normalized);
  };

  return state;
}

function isLocalAddress(address: string): boolean {
  const family = net.isIP(address);
  return family !== 0 && LOCAL.check(address, family === 6 ? "ipv6" : "ipv4");
}
