// The one k6 entry script. Which scenario runs, with how many VUs and for how
// long, comes from the environment `k6 x nextgen sweep` sets: SCEN, VUS, DUR.
// Scenarios run one at a time; run together they contend for the same machine
// and the cheap one starves the others.
import nextgen from 'k6/x/nextgen';
import exec from 'k6/execution';

// The scenario table comes from the module's registry, never from a list in
// this script: a scenario registered in Go is runnable here, and one that is
// registered without an exported function of its name fails the run.
const registry = nextgen.scenarios();
const all = Object.fromEntries(registry.map((s) => [s.name, { executor: 'constant-vus', exec: s.name }]));
const pick = __ENV.SCEN || registry[0].name;
if (!all[pick]) throw new Error(`unknown scenario ${pick}; one of ${Object.keys(all).join(', ')}`);

// An empty threshold on `metric{op:<id>}` makes k6 keep and report that
// sub-metric in its own end-of-test summary, one line per operation. The
// operation vocabulary comes from the module, so the script never spells an
// operation id the Go side does not know.
const perOperation = {};
for (const op of nextgen.operations()) {
  for (const metric of nextgen.metrics()) perOperation[`${metric}{op:${op}}`] = [];
}
// The session cache's own metrics are reported whole, never per operation:
// its logins must stay out of every operation trend.
for (const metric of nextgen.sessionMetrics()) perOperation[metric] = [];

export const options = {
  scenarios: {
    [pick]: { ...all[pick], vus: Number(__ENV.VUS || 1), duration: __ENV.DUR || '10s', gracefulStop: '5s' },
  },
  thresholds: perOperation,
};

export function login() {
  nextgen.login();
}

export function getUser() {
  nextgen.getUser();
}

// The session cache is warmed before anything is measured, so a measured
// iteration never pays for a login; a miss on the measured path is counted
// (nextgen_session_cache_miss) and invalidates the window.
export function setup() {
  if (registry.find((s) => s.name === pick).sessions) nextgen.warmSessions(Number(__ENV.VUS || 1));
}

export function getMySession() {
  nextgen.getMySession(exec.vu.idInTest);
}
