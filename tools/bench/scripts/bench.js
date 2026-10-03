// The one k6 entry script. Which scenario runs, with how many VUs and for how
// long, comes from the environment `k6 x nextgen sweep` sets: SCEN, VUS, DUR.
// Scenarios run one at a time; run together they contend for the same machine
// and the cheap one starves the others.
import nextgen from 'k6/x/nextgen';

const all = {
  login: { executor: 'constant-vus', exec: 'login' },
  getUser: { executor: 'constant-vus', exec: 'getUser' },
};
const pick = __ENV.SCEN || 'login';
if (!all[pick]) throw new Error(`unknown scenario ${pick}; one of ${Object.keys(all).join(', ')}`);

// An empty threshold on `metric{op:<id>}` makes k6 keep and report that
// sub-metric in its own end-of-test summary, one line per operation. The
// operation vocabulary comes from the module, so the script never spells an
// operation id the Go side does not know.
const perOperation = {};
for (const op of nextgen.operations()) {
  for (const metric of nextgen.metrics()) perOperation[`${metric}{op:${op}}`] = [];
}

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
