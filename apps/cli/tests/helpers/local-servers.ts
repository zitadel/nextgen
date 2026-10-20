import Doctor from "../../src/commands/doctor";
import Stop from "../../src/commands/stop";
import type { LocalServers, ManagedRuntimeProcess } from "../../src/lib/local-server/processes";

/** A machine that runs exactly the given servers, whatever it really runs. */
export function aMachineRunning(
  ...processes: ReadonlyArray<Omit<ManagedRuntimeProcess, "kind">>
): LocalServers {
  return {
    current: () =>
      Promise.resolve({
        supported: true,
        processes: processes.map((entry) => ({ ...entry, kind: "server-wrapper" as const })),
      }),
  };
}

/** `doctor` that asks `servers` which servers run, for `runCliForTest`. */
export function doctorSeeing(servers: LocalServers): typeof Doctor {
  return class extends Doctor {
    protected override localServers(): LocalServers {
      return servers;
    }
  };
}

/** `stop` that asks `servers` which servers run, for `runCliForTest`. */
export function stopSeeing(servers: LocalServers): typeof Stop {
  return class extends Stop {
    protected override localServers(): LocalServers {
      return servers;
    }
  };
}
