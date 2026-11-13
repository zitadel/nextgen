import { ZitadelError } from "@/lib/errors";
import { isObject, parseJsonObject, setTopLevelJsonKey } from "@/lib/json";
import { MANAGED_MARKER } from "@/lib/paths";
import type { PatchContext } from "@/lib/orca/patchers/types";
import type { WiringVerdict } from "@/lib/orca/patchers/rule/file-writer/types";
import { PROXY_PATH } from "@/lib/orca/patchers/rule/proxy";
import {
  assertNoUnreviewedProjectSecretProxy,
  EXCHANGE_PATH_CHECK,
  PREFIXED_EXCHANGE_PATH,
  PROXY_CREDENTIAL_POLICY_MARKER,
  PROXY_CREDENTIAL_POLICY_V2_MARKER,
  V2_EXCHANGE_PATH_CHECK,
} from "@/lib/orca/patchers/rule/proxy-credential-policy";
import {
  indented,
  proxyConfSessionCookieStatements,
  proxyConfSessionCookieStatementsV1,
  SESSION_COOKIE_MARKER,
  SESSION_COOKIE_MARKER_V1,
} from "@/lib/orca/patchers/rule/session-cookie";
import { lfText, withLfLineEnds } from "@/lib/orca/patchers/rule/utils/line-ends";

/** The managed launcher the app's `ng serve` and `ng build` scripts run through. */
export const LAUNCHER_PATH = "zitadel-ng.cjs";

/**
 * The identifier the app's client code reads its project id from. Angular's
 * CLI reads no environment into client code, so {@link launcherTemplate}
 * defines it at build time.
 */
const PROJECT_ID_DEFINE = "ZITADEL_PROJECT_ID";

/**
 * The declaration that types {@link PROJECT_ID_DEFINE} in `app.ts`, before the
 * component. It may be undefined: `ng test` cannot define it, since Angular's
 * unit-test builder takes no `define` of its own.
 */
const PROJECT_ID_DECLARATION = `// The project id: ${LAUNCHER_PATH}, which the dev and build scripts run,
// defines it from ZITADEL_PROJECT_ID in the environment or in .env.local.
// Without it (ng test, a plain ng build) the login widget says it has none.
declare const ${PROJECT_ID_DEFINE}: string | undefined;
`;

/**
 * What a plain `ng serve` or production `ng build` stops with: the value
 * `angular.json` defines {@link PROJECT_ID_DEFINE} to, which is no JavaScript
 * literal, so the build refuses it and prints it. The launcher's `--define`
 * replaces it.
 */
export const PROJECT_ID_GUARD = {
  name: PROJECT_ID_DEFINE,
  message: `${PROJECT_ID_DEFINE} is defined by ${LAUNCHER_PATH}: run the app with npm run dev and build it with npm run build`,
} as const;

/**
 * The line of `app.ts` that reads {@link PROJECT_ID_DEFINE}. The define
 * replaces the identifier inside `typeof` too, so a defined id is used as is.
 */
const PROJECT_ID_LINE = `    projectId: typeof ${PROJECT_ID_DEFINE} === "string" ? ${PROJECT_ID_DEFINE} : "",\n`;

/**
 * The managed root component `src/app/app.ts`: a standalone component that
 * renders the `@zitadel/sdk-angular` widgets based on the current path. The
 * project id (public, not secret) is {@link PROJECT_ID_DEFINE}, which
 * {@link launcherTemplate} defines from the environment, so the file names no
 * project; the dev proxy in `proxy.conf.cjs` attaches the project service-key
 * secret as the bearer server-side only to `POST /sessions/exchange` (read
 * from `.env.local`), and no secret reaches the browser.
 *
 * Projects set up with the business use case additionally expose the SDK's
 * `businessLocales` overlay as a class property, which `app.html` binds to the
 * login widgets via `[locales]` — restoring work-email copy on top of the
 * widget's neutral built-in dictionaries.
 */
export function appComponentTemplate(ctx: PatchContext): string {
  const business = ctx.useCase === "business";
  const importNames = business
    ? `
  ZitadelLoginComponent,
  ZitadelSessionComponent,
  businessLocales,
  configureZitadel,
`
    : `
  ZitadelLoginComponent,
  ZitadelSessionComponent,
  configureZitadel,
`;
  // The overlay ships with the SDK, so the generated app only wires it up
  // (and stays plain otherwise).
  const localesProperty = business
    ? `
  // Set up for a business audience: businessLocales overlays work-email copy
  // on the login widget's neutral built-in dictionaries. Remove it (and the
  // [locales] binding in app.html) to fall back to the neutral wording.
  protected readonly locales = businessLocales;`
    : "";
  return `${MANAGED_MARKER}
import { Component, OnInit } from "@angular/core";
import {${importNames}} from "@zitadel/sdk-angular";

${PROJECT_ID_DECLARATION}
@Component({
  selector: "app-root",
  standalone: true,
  imports: [ZitadelLoginComponent, ZitadelSessionComponent],
  templateUrl: "./app.html",
})
export class App implements OnInit {
  protected readonly project = configureZitadel({
${PROJECT_ID_LINE}    proxyPath: "${PROXY_PATH}",
  });
  protected readonly path = window.location.pathname;${localesProperty}

  ngOnInit(): void {
    if (this.path === "/") {
      window.location.replace("/login");
    }
  }
}
`;
}

/** The line of `app.ts` that names `projectId` as setup wrote it before it read the id from the environment. */
function literalProjectIdLine(projectId: string): string {
  return `    projectId: ${JSON.stringify(projectId)},\n`;
}

const COMPONENT_DECORATOR = "\n@Component({";

/** Whether `text` (LF line ends) is the managed `app.ts` an earlier CLI wrote, naming `projectId` as a literal. */
function namesProjectLiterally(text: string, projectId: string): boolean {
  return (
    text.includes(MANAGED_MARKER) &&
    text.includes(literalProjectIdLine(projectId)) &&
    text.includes(COMPONENT_DECORATOR) &&
    !text.includes(PROJECT_ID_DECLARATION)
  );
}

/**
 * Moves the managed `app.ts` an earlier CLI wrote, which named the project it
 * was set up against as a literal, onto {@link PROJECT_ID_DEFINE}: the exact
 * `projectId` line is replaced and the declaration goes before the component.
 * A file that reads the define already, an unmanaged one, and a managed one
 * whose line was changed by hand are left as they are;
 * {@link appComponentProjectIdVerdict} tells the doctor which it is. Line ends
 * are the file's own. Writes the managed component when it is absent.
 */
export function appComponentProjectIdEdit(
  ctx: PatchContext,
): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      return appComponentTemplate(ctx);
    }
    return withLfLineEnds(source, (text) => {
      return namesProjectLiterally(text, ctx.project.id)
        ? text
            .replace(literalProjectIdLine(ctx.project.id), PROJECT_ID_LINE)
            .replace(COMPONENT_DECORATOR, `\n${PROJECT_ID_DECLARATION}${COMPONENT_DECORATOR}`)
        : text;
    });
  };
}

/**
 * Whether `app.ts` reads its project id from {@link PROJECT_ID_DEFINE}, for
 * the doctor. The managed file an earlier CLI wrote, naming project
 * `projectId`, is `detached` (`doctor --fix` moves it). A managed file that
 * still names it but was changed by hand is `unknown`: only the developer can
 * move it. A file without the literal, or one the developer adopted, is theirs.
 */
export function appComponentProjectIdVerdict(projectId: string): (source: string) => WiringVerdict {
  return (source) => {
    const text = lfText(source);
    if (!text.includes(MANAGED_MARKER) || !text.includes(JSON.stringify(projectId))) {
      return "applied";
    }
    if (namesProjectLiterally(text, projectId)) {
      return "detached";
    }
    return {
      unknown: `it names project ${projectId} and was changed since zitadel setup wrote it, so it must read ${PROJECT_ID_DEFINE} (which ${LAUNCHER_PATH} defines) by hand`,
    };
  };
}

/**
 * The managed launcher `zitadel-ng.cjs`, which the app's `ng serve` and
 * `ng build` scripts run instead of `ng`. Angular's CLI reads no environment
 * into client code (its `define` takes literals in `angular.json`, and a
 * shell to expand one on the command line), so this file reads
 * `ZITADEL_PROJECT_ID` from the environment, else from `.env.local`, which
 * `zitadel setup` writes, and runs the Angular CLI in this process with
 * `--define` for {@link PROJECT_ID_DEFINE}. A value in the environment wins,
 * as it does in `proxy.conf.cjs`, so a production build sets it there.
 */
export function launcherTemplate(): string {
  return `${MANAGED_MARKER}
// Runs the Angular CLI with the project id defined for the app's client code
// (${PROJECT_ID_DEFINE} in src/app/app.ts). The id comes from the environment,
// else from .env.local, which zitadel setup writes and .gitignore excludes.
const { existsSync } = require("node:fs");

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
const projectId = process.env.ZITADEL_PROJECT_ID;
if (!projectId) {
  console.error("ZITADEL_PROJECT_ID is not set; add it to .env.local (zitadel setup writes it) or to the environment.");
  process.exit(1);
}
process.argv.push("--define", \`${PROJECT_ID_DEFINE}=\${JSON.stringify(projectId)}\`);
require("@angular/cli/bin/ng.js");
`;
}

/** Writes the managed launcher when it is absent, and leaves one that exists as it is. */
export function launcherEdit(source: string | undefined): string {
  return source ?? launcherTemplate();
}

/** `source`, a `package.json`, and its scripts; throws when there is none to edit. */
function packageJson(source: string | undefined): {
  source: string;
  scripts: Record<string, unknown>;
} {
  if (source === undefined) {
    throw new ZitadelError("E_VALIDATION", "package.json is required to add the dev script", {
      hint: "Run setup from a project that has a package.json.",
    });
  }
  const pkg = parseJsonObject(source, "package.json");
  return { source, scripts: isObject(pkg.scripts) ? pkg.scripts : {} };
}

/**
 * `pkg` with its scripts replaced by `scripts`, or its source itself when they
 * are the same: the edit op then skips the file instead of reformatting the
 * developer's `package.json`, which is theirs. Only the scripts value is
 * spliced; every byte outside it stays.
 */
function withScripts(
  pkg: ReturnType<typeof packageJson>,
  scripts: Record<string, unknown>,
): string {
  return JSON.stringify(scripts) === JSON.stringify(pkg.scripts)
    ? pkg.source
    : setTopLevelJsonKey(pkg.source, "package.json", "scripts", scripts);
}

/**
 * The serve and build scripts as `ng new` writes them (`start`, `build`,
 * `watch`) and as earlier setups added `dev`, each run through the launcher.
 */
const LAUNCHED_SCRIPTS: Readonly<Record<string, string>> = {
  "ng serve": `node ${LAUNCHER_PATH} serve`,
  "ng build": `node ${LAUNCHER_PATH} build`,
  "ng build --watch --configuration development": `node ${LAUNCHER_PATH} build --watch --configuration development`,
};

/** A script that runs the Angular CLI's `serve` or `build`. */
const SERVES_OR_BUILDS = /\bng (serve|build)\b/;

/**
 * Runs the app's serve and build scripts through the launcher, so the client
 * code gets its project id: each script that is still exactly as `ng new` or
 * an earlier setup wrote it. A script the developer changed, and one that runs
 * another command (`ng test`), are left as they are;
 * {@link launcherScriptsVerdict} tells the doctor which ones need moving by hand.
 */
export function launcherScriptsEdit(source: string | undefined): string {
  const pkg = packageJson(source);
  return withScripts(
    pkg,
    Object.fromEntries(
      Object.entries(pkg.scripts).map(([name, command]) => {
        return [name, (typeof command === "string" && LAUNCHED_SCRIPTS[command]) || command];
      }),
    ),
  );
}

/**
 * Whether the app's serve and build scripts run through the launcher, for the
 * doctor. A script still as `ng new` or an earlier setup wrote it is
 * `detached` (`doctor --fix` moves it). One the developer changed that still
 * runs `ng serve` or `ng build` is `unknown`, named with what to run instead.
 */
export function launcherScriptsVerdict(source: string): WiringVerdict {
  const { scripts } = packageJson(source);
  const commands = Object.entries(scripts).filter((entry): entry is [string, string] => {
    return typeof entry[1] === "string";
  });
  const changed = commands.filter(([, command]) => {
    return LAUNCHED_SCRIPTS[command] === undefined && SERVES_OR_BUILDS.test(command);
  });
  if (changed.length > 0) {
    return {
      unknown: `${changed
        .map(([name, command]) => {
          return `its "${name}" script (${command}) runs the Angular CLI without ${LAUNCHER_PATH}, so the app gets no project id`;
        })
        .join(
          "; ",
        )}: run "node ${LAUNCHER_PATH} serve …" where it runs "ng serve …", and "node ${LAUNCHER_PATH} build …" for "ng build …"`,
    };
  }
  return commands.some(([, command]) => {
    return LAUNCHED_SCRIPTS[command] !== undefined;
  })
    ? "detached"
    : "applied";
}

/**
 * Adds a `dev` script that serves through the launcher when the project
 * defines none. `ng new` ships only a `start` script, but the CLI tells every
 * framework to run `npm run dev` (and `ng serve` reads the proxy + port from
 * `angular.json`). An existing `dev` script is left as it is.
 */
export function devScriptEdit(source: string | undefined): string {
  const pkg = packageJson(source);
  return pkg.scripts.dev === undefined
    ? withScripts(pkg, { ...pkg.scripts, dev: `node ${LAUNCHER_PATH} serve` })
    : pkg.source;
}

/**
 * The managed `src/app/app.html`. The marker lives in an HTML comment that still
 * contains the literal managed-marker text, so eject/doctor stay marker-aware.
 * Business-use-case scaffolds bind the component's `locales` overlay property
 * onto the login widgets.
 */
export function appTemplateHtml(ctx: PatchContext): string {
  const localesBinding = ctx.useCase === "business" ? `\n      [locales]="locales"` : "";
  return `<!-- ${MANAGED_MARKER} -->
@if (path.startsWith('/profile')) {
  <div style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <zitadel-auth-session
      [project]="project"
      [postSignOutUrl]="'/login'"
    ></zitadel-auth-session>
  </div>
} @else if (path.startsWith('/register')) {
  <div style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <zitadel-auth-login
      [project]="project"${localesBinding}
      purpose="register"
      [postSignInUrl]="'/profile'"
    ></zitadel-auth-login>
  </div>
} @else {
  <div style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <zitadel-auth-login
      [project]="project"${localesBinding}
      purpose="login"
      [postSignInUrl]="'/profile'"
    ></zitadel-auth-login>
  </div>
}
`;
}

/**
 * The managed `proxy.conf.cjs` for `ng serve`: forwards `/__nextgen/*` to the
 * backend and attaches the project's service-key secret only to the current
 * app-plane `POST /sessions/exchange` request, which it knows with and without
 * the API prefix (`/api/v1`, ADR 077). Both the backend URL
 * (`ZITADEL_URL`) and the secret
 * (`ZITADEL_PROJECT_SECRET`) are read from `.env.local`, which `zitadel setup`
 * writes and `.gitignore` excludes — Angular's CLI does not auto-load env files
 * into the dev-server process, so this file does it itself with a small inline
 * parser. The prefix strip and the bearer are each provided in both the
 * http-proxy-middleware form (`pathRewrite`/`onProxyReq`) and the Vite form
 * (`rewrite`/`configure`), so both fire whichever proxy layer Angular's
 * dev server uses. Like the Vite proxy (`vite-support.ts`), it addresses the
 * backend by its own name (`changeOrigin`), which a remote https server
 * requires, and forwards the app's origin in `X-Forwarded-Host` and
 * `X-Forwarded-Proto` (`xfwd`), and it keeps the session cookie under the
 * app's project's name in the browser (`ZITADEL_PROJECT_ID`, ADR 073,
 * ADR 083).
 */
export function proxyConfTemplate(): string {
  return `${MANAGED_MARKER}
const { readFileSync, existsSync } = require("node:fs");

function loadEnvLocal() {
  if (!existsSync(".env.local")) return {};
  const out = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\\r?\\n/)) {
    const m = line.match(/^\\s*(?:export\\s+)?([A-Z_][A-Z0-9_]*)\\s*=\\s*(.*)$/);
    if (m) {
      const raw = m[2].trim();
      const quoted = raw.match(/^(['"])(.*)\\1\\s*(?:#.*)?$/);
      out[m[1]] = quoted ? quoted[2] : raw.replace(/\\s+#.*$/, "").trim();
    }
  }
  return out;
}

const env = loadEnvLocal();
const server = process.env.ZITADEL_URL ?? env.ZITADEL_URL;
const secret = process.env.ZITADEL_PROJECT_SECRET ?? env.ZITADEL_PROJECT_SECRET;
if (!server) {
  throw new Error("ZITADEL_URL is not set; add it to .env.local (zitadel setup writes it).");
}
if (!secret) {
  throw new Error("ZITADEL_PROJECT_SECRET is not set; add it to .env.local (zitadel setup writes it).");
}
const bearer = \`Bearer \${secret}\`;

${EXCHANGE_ONLY_BEARER}

${SESSION_COOKIE_FUNCTIONS}

function stripPrefix(path) {
  return path.replace(/^\\${PROXY_PATH}/, "").replace(/^(?!\\/)/, "/");
}

module.exports = {
  "${PROXY_PATH}": {
    target: server,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: stripPrefix,
    rewrite: stripPrefix,
${SESSION_COOKIE_HOOKS}  },
};
`;
}

const LEGACY_UNCONDITIONAL_BEARER = `function setBearer(proxyReq) {
  proxyReq.setHeader("authorization", bearer);
}`;

/** The bearer hook, marked with the credential policy `marker`, testing the path with `pathCheck`. */
function exchangeOnlyBearer(marker: string, pathCheck: string): string {
  return `/* ${marker} */
function setBearer(proxyReq) {
  const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
  if (
    proxyReq.method === "POST" &&
    ${pathCheck} &&
    !proxyReq.getHeader("authorization")
  ) {
    proxyReq.setHeader("authorization", bearer);
  }
}`;
}

const EXCHANGE_ONLY_BEARER = exchangeOnlyBearer(
  PROXY_CREDENTIAL_POLICY_MARKER,
  EXCHANGE_PATH_CHECK,
);

/** The bearer hook as the CLI wrote it before it knew the API prefix (ADR 077). */
const V2_EXCHANGE_ONLY_BEARER = exchangeOnlyBearer(
  PROXY_CREDENTIAL_POLICY_V2_MARKER,
  V2_EXCHANGE_PATH_CHECK,
);

/** The exchange-only bearer hook `text` carries, of either version, or `undefined`. */
function bearerIn(text: string): string | undefined {
  return [EXCHANGE_ONLY_BEARER, V2_EXCHANGE_ONLY_BEARER].find((bearer) => {
    return text.includes(bearer);
  });
}

/** The session-cookie hooks' functions, after the bearer hook (ADR 073, ADR 083). */
const SESSION_COOKIE_FUNCTIONS = indented(proxyConfSessionCookieStatements(), "");

/** The session-cookie hooks' functions as the CLI wrote them before ADR 083. */
const SESSION_COOKIE_FUNCTIONS_V1 = indented(proxyConfSessionCookieStatementsV1(), "");

/** How the managed entry attached its hooks before it carried the session-cookie ones. */
const BEARER_ONLY_HOOKS = `    onProxyReq: setBearer,
    configure: (proxy) => proxy.on("proxyReq", setBearer),
`;

/** How the managed entry attached the bearer and the session-cookie hooks before ADR 083. */
const SESSION_COOKIE_HOOKS_V1 = `    onProxyReq: (proxyReq) => {
      setBearer(proxyReq);
      forwardSessionCookie(proxyReq);
    },
    onProxyRes: renameSessionCookie,
    configure: (proxy) => {
      proxy.on("proxyReq", setBearer);
      proxy.on("proxyReq", forwardSessionCookie);
      proxy.on("proxyRes", renameSessionCookie);
    },
`;

/**
 * How the managed entry attaches the bearer and the session-cookie hooks. Each
 * cookie hook takes the browser's request too, whose scheme names the cookie.
 */
const SESSION_COOKIE_HOOKS = `    onProxyReq: (proxyReq, req) => {
      setBearer(proxyReq);
      forwardSessionCookie(proxyReq, req);
    },
    onProxyRes: renameSessionCookie,
    configure: (proxy) => {
      proxy.on("proxyReq", setBearer);
      proxy.on("proxyReq", forwardSessionCookie);
      proxy.on("proxyRes", renameSessionCookie);
    },
`;

/**
 * The managed entry as emitted before it forwarded the app's origin, and what
 * replaces it. Keeping the browser's `Host` also kept `localhost` as the TLS
 * server name, so that proxy could reach no remote https server.
 */
const HOST_KEEPING_ENTRY = `    target: server,
    changeOrigin: false,
`;

const ORIGIN_FORWARDING_ENTRY = `    target: server,
    changeOrigin: true,
    xfwd: true,
`;

/** Upgrades the exact host-keeping entry, unless the file already chose its own `xfwd`. */
function forwardAppOrigin(source: string): string {
  if (/\bxfwd\s*:/.test(source)) {
    return source;
  }
  return source.replace(HOST_KEEPING_ENTRY, ORIGIN_FORWARDING_ENTRY);
}

/**
 * Creates the managed Angular proxy and upgrades the exact shapes earlier CLIs
 * emitted: the insecure unconditional bearer hook and the host-keeping entry.
 * Other edits are preserved; a safe custom proxy is left untouched, while an
 * unrecognized proxy that may still over-forward the project secret is
 * surfaced for manual review.
 */
export function proxyConfEdit(): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      return proxyConfTemplate();
    }
    return withLfLineEnds(source, (text) => {
      if (text.includes(MANAGED_MARKER) && text.includes(LEGACY_UNCONDITIONAL_BEARER)) {
        return forwardAppOrigin(text.replace(LEGACY_UNCONDITIONAL_BEARER, EXCHANGE_ONLY_BEARER));
      }
      assertNoUnreviewedProjectSecretProxy(text, "proxy.conf.cjs");
      return text.includes(MANAGED_MARKER) ? forwardAppOrigin(text) : text;
    });
  };
}

/** Whether `text` (LF line ends) is the managed proxy as an earlier CLI wrote it, without the session-cookie hooks. */
function hasBearerOnlyHooks(text: string): boolean {
  return (
    text.includes(MANAGED_MARKER) &&
    bearerIn(text) !== undefined &&
    text.includes(BEARER_ONLY_HOOKS)
  );
}

/** Whether `text` (LF line ends) is the managed proxy with the session-cookie hooks the CLI wrote before ADR 083. */
function hasV1Hooks(text: string): boolean {
  return (
    text.includes(MANAGED_MARKER) &&
    text.includes(SESSION_COOKIE_FUNCTIONS_V1) &&
    text.includes(SESSION_COOKIE_HOOKS_V1)
  );
}

/**
 * Gives the managed proxy the session-cookie hooks (ADR 073, ADR 083) when it
 * is the exact file an earlier CLI wrote: the hook functions go after the
 * bearer hook, and the entry attaches them beside it; the hooks from before
 * ADR 083 are replaced where they stand. A file that carries the current hooks
 * already, an unmanaged one, and a managed one whose hooks were changed by
 * hand are left as they are; {@link proxyConfSessionCookieVerdict} tells the
 * doctor which it is. Line ends are the file's own (CRLF or LF). Creates the
 * managed proxy when it is absent, as {@link proxyConfEdit} does.
 */
export function proxyConfSessionCookieEdit(): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      return proxyConfTemplate();
    }
    return withLfLineEnds(source, (text) => {
      if (text.includes(SESSION_COOKIE_MARKER)) {
        return text;
      }
      if (hasV1Hooks(text)) {
        return text
          .replace(SESSION_COOKIE_FUNCTIONS_V1, SESSION_COOKIE_FUNCTIONS)
          .replace(SESSION_COOKIE_HOOKS_V1, SESSION_COOKIE_HOOKS);
      }
      const bearer = bearerIn(text);
      return bearer && hasBearerOnlyHooks(text)
        ? text
            .replace(bearer, `${bearer}\n\n${SESSION_COOKIE_FUNCTIONS}`)
            .replace(BEARER_ONLY_HOOKS, SESSION_COOKIE_HOOKS)
        : text;
    });
  };
}

/**
 * Whether `proxy.conf.cjs` carries the session-cookie hooks, for the doctor.
 * The managed file as an earlier CLI wrote it is `detached` (`doctor --fix`
 * adds them). One the edit cannot place them in, a managed file changed by
 * hand or a proxy of the developer's own, is `unknown`: only the developer can.
 * Hooks from before ADR 083 are `outdated`: they keep the session in cookies
 * the server no longer reads.
 */
export function proxyConfSessionCookieVerdict(source: string): WiringVerdict {
  const text = lfText(source);
  if (text.includes(SESSION_COOKIE_MARKER)) {
    return "applied";
  }
  if (text.includes(SESSION_COOKIE_MARKER_V1)) {
    return {
      outdated: hasV1Hooks(text)
        ? "its session-cookie hooks name the session cookies before ADR 083; doctor --fix updates them"
        : "its session-cookie hooks name the session cookies before ADR 083 and were changed since zitadel setup wrote them, so they must be updated by hand",
    };
  }
  if (hasBearerOnlyHooks(text)) {
    return "detached";
  }
  return {
    unknown: text.includes(MANAGED_MARKER)
      ? "it was changed since zitadel setup wrote it, so the session-cookie hooks (ADR 073) must be added by hand"
      : "it is not the proxy zitadel setup writes, so the session-cookie hooks (ADR 073) must be added by hand",
  };
}

/**
 * Moves the managed proxy's bearer hook from v2, which knew only
 * `/sessions/exchange`, to v3, which knows the exchange under the API prefix
 * too (ADR 077): once an app's packages call `/api/v1`, a v2 proxy no longer
 * attaches the project secret to the exchange. Only the exact hook an earlier
 * CLI wrote is replaced; a file that carries v3 already, an unmanaged one and a
 * hook changed by hand are left as they are, and
 * {@link proxyConfApiPrefixVerdict} tells the doctor which it is. Line ends are
 * the file's own. Creates the managed proxy when it is absent, as
 * {@link proxyConfEdit} does.
 */
export function proxyConfApiPrefixEdit(): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      return proxyConfTemplate();
    }
    return withLfLineEnds(source, (text) => {
      return text.includes(MANAGED_MARKER) && text.includes(V2_EXCHANGE_ONLY_BEARER)
        ? text.replace(V2_EXCHANGE_ONLY_BEARER, EXCHANGE_ONLY_BEARER)
        : text;
    });
  };
}

/**
 * Whether `proxy.conf.cjs` attaches the project secret to the exchange under
 * the API prefix too, for the doctor. The managed file with an earlier CLI's
 * v2 hook is `detached` (`doctor --fix` moves it to v3). A managed file whose
 * hook was changed by hand, and a proxy of the developer's own that attaches
 * the secret but never names `/api/v1/sessions/exchange`, are `unknown`: only
 * the developer can change them.
 */
export function proxyConfApiPrefixVerdict(source: string): WiringVerdict {
  const text = lfText(source);
  if (text.includes(EXCHANGE_ONLY_BEARER)) {
    return "applied";
  }
  if (text.includes(MANAGED_MARKER) && text.includes(V2_EXCHANGE_ONLY_BEARER)) {
    return "detached";
  }
  if (!text.includes("ZITADEL_PROJECT_SECRET") || text.includes(PREFIXED_EXCHANGE_PATH)) {
    return "applied";
  }
  return {
    unknown: text.includes(MANAGED_MARKER)
      ? `it was changed since zitadel setup wrote it, so its project-secret check must accept ${PREFIXED_EXCHANGE_PATH} by hand (ADR 077)`
      : `it is not the proxy zitadel setup writes, so its project-secret check must accept ${PREFIXED_EXCHANGE_PATH} by hand (ADR 077)`,
  };
}
