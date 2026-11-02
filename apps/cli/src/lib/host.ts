/**
 * Whether `host` names this machine, that is, whether a connection to it never
 * leaves the computer.
 *
 * Three forms count as loopback: the name `localhost`, any address in the
 * IPv4 loopback block `127.0.0.0/8` (not just `127.0.0.1`), and the IPv6
 * address `::1`. The IPv6 address is accepted with or without brackets,
 * because a URL's `hostname` keeps them (`new URL("http://[::1]:8080").hostname`
 * is `"[::1]"`) while tools such as `lsof` print it bare.
 *
 * It looks at the text only. It does not resolve names, so `localhost.example.com`
 * is not loopback and a wildcard bind address such as `*` or `0.0.0.0` is not
 * either: whether a wildcard listener also serves loopback is the caller's
 * call to make.
 *
 * @param host A bare host name or address, without a port or a scheme.
 * @returns `true` when the host is a loopback name or address.
 *
 * @example
 * isLoopbackHost("localhost"); // true
 * isLoopbackHost("127.0.0.2"); // true
 * isLoopbackHost("[::1]"); // true
 * isLoopbackHost("10.0.0.1"); // false
 */
export function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" || host === "::1" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host)
  );
}
