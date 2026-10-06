// The one k6 entry script. Every scenario is declared; `k6 x nextgen sweep`
// picks one per run with k6's own `--scenario <name>` and sets its shape
// through VUS and DUR. The target itself — and its secret — never passes
// through __ENV: the Go module reads it from its own process environment.
// Scenarios run one at a time; run together they contend for the same machine
// and the cheap one starves the others.
import nextgen from 'k6/x/nextgen';
import exec from 'k6/execution';

const shape = { executor: 'constant-vus', vus: Number(__ENV.VUS || 1), duration: __ENV.DUR || '10s', gracefulStop: '5s' };

// The scenario table comes from the module's registry, never from a list in
// this script: a scenario registered in Go is runnable here, and one that is
// registered without an exported function of its name fails the run.
const registry = nextgen.scenarios();

// An empty threshold on a sub-metric makes k6 keep and report it in its own
// end-of-test summary: every metric per operation, and the error counter
// further per status class and per error code. The vocabulary comes from the
// module, so the script never spells a tag value the Go side does not know.
const thresholds = {};
for (const name of nextgen.submetrics()) thresholds[name] = [];
// The session cache's own metrics are reported whole, never per operation:
// its logins must stay out of every operation trend.
for (const name of nextgen.sessionMetrics()) thresholds[name] = [];

export const options = {
  scenarios: Object.fromEntries(registry.map((s) => [s.name, { ...shape, exec: s.name }])),
  thresholds,
};

export function login() {
  nextgen.login();
}

export function getUser() {
  nextgen.getUser();
}

// The session cache is warmed before anything is measured, so a measured
// iteration never pays for a login; a miss on the measured path is counted
// (nextgen_session_cache_miss) and invalidates the window. `--scenario`
// leaves only the selected scenario in the options, so this warms nothing
// for a run whose scenario takes no sessions.
export function setup() {
  if (registry.some((s) => s.sessions && s.name in exec.test.options.scenarios)) nextgen.warmSessions(Number(__ENV.VUS || 1));
}

export function getMySession() {
  nextgen.getMySession(exec.vu.idInTest);
}
