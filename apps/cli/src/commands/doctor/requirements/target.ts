import {
  DEFAULT_LOCAL_SERVER_PORT,
  findUpward,
  LOCAL_RUNTIME_FILE,
  localServerUrl,
  readNearestRuntimeMetadata,
} from "../../../lib/local-server/runtime";
import { requirement } from "../../../lib/oclif/requirements";
import { hasZitadelConfig, readProjectServer, readZitadelConfig } from "../../../lib/project";
import { isLoopbackUrl } from "../../../lib/server";

type RuntimeFlags = {
  port?: number;
  runtime?: string;
  image?: string;
};

/**
 * The server of a project set up against a hosted server, for which doctor
 * checks no local runtime: no local server runs for it, so the runtime says
 * nothing about it, and a port another app holds would fail it. `undefined`
 * (check the runtime) before setup, for a project on a local server or with a
 * `zitadel.json` that does not parse, where a server was started in the
 * directory or a parent, and when a flag asks about the runtime.
 */
async function hostedServerWithoutLocalRuntime(
  cwd: string,
  flags: RuntimeFlags,
): Promise<string | undefined> {
  if (flags.port !== undefined || flags.runtime !== undefined || flags.image !== undefined) {
    return undefined;
  }
  if ((await findUpward(cwd, LOCAL_RUNTIME_FILE)) !== undefined || !(await hasZitadelConfig(cwd))) {
    return undefined;
  }
  const server = await readZitadelConfig(cwd).then(readProjectServer, () => undefined);
  return server === undefined || isLoopbackUrl(server) ? undefined : server;
}

/**
 * What `doctor` is about: the local server this directory uses, the one
 * `zitadel start` ran here or in the nearest parent, or the hosted server of a
 * project that has none. An unreadable record only costs the port hint; the
 * read doctor makes next reports it.
 */
export const target = requirement({
  resolve: async ({ flags, meta }) => {
    const asked: RuntimeFlags = {
      port: typeof flags.port === "number" ? flags.port : undefined,
      runtime: typeof flags.runtime === "string" ? flags.runtime : undefined,
      image: typeof flags.image === "string" ? flags.image : undefined,
    };
    const hint = await readNearestRuntimeMetadata(meta.cwd).catch(() => undefined);
    return {
      port: asked.port ?? hint?.runtime.port ?? DEFAULT_LOCAL_SERVER_PORT,
      hostedServer: await hostedServerWithoutLocalRuntime(meta.cwd, asked),
    };
  },
  source: ({ port, hostedServer }) => {
    return hostedServer ?? localServerUrl(port);
  },
});
