// The one k6 entry script. Every scenario is declared; `k6 x nextgen sweep`
// picks one per run with k6's own `--scenario <name>` and sets its shape
// through VUS and DUR. The target itself — and its secret — never passes
// through __ENV: the Go module reads it from its own process environment.
// Scenarios run one at a time; run together they contend for the same machine
// and the cheap one starves the others.
import nextgen from "k6/x/nextgen";

const shape = {
  executor: "constant-vus",
  vus: Number(__ENV.VUS || 1),
  duration: __ENV.DUR || "10s",
  gracefulStop: "5s",
};

// An empty threshold on a sub-metric makes k6 keep and report it in its own
// end-of-test summary: every metric per operation, and the error counter
// further per status class and per error code. The vocabulary comes from the
// module, so the script never spells a tag value the Go side does not know.
const thresholds = {};
for (const name of nextgen.submetrics()) thresholds[name] = [];

export const options = {
  scenarios: {
    login: { ...shape, exec: "login" },
    getUser: { ...shape, exec: "getUser" },
  },
  thresholds,
};

export function login() {
  nextgen.login();
}

export function getUser() {
  nextgen.getUser();
}
