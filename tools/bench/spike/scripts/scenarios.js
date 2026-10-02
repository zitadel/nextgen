// One scenario at a time (SCEN=login|getUser): they contend for the same
// machine and the cheap one starves the other. VUS and DUR from the env.
const all = {
  login:   { executor: 'constant-vus', exec: 'login' },
  getUser: { executor: 'constant-vus', exec: 'getUser' },
};
const vus = Number(__ENV.VUS || 1);
const duration = __ENV.DUR || '10s';
const pick = __ENV.SCEN || 'login';

export const scenarios = Object.fromEntries(
  Object.entries(all)
    .filter(([k]) => k === pick)
    .map(([k, s]) => [k, { ...s, vus, duration, gracefulStop: '5s' }]),
);
