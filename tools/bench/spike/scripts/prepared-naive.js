// Shape "prepared" without the module's bounded tags: what a plain k6/http
// script does by default. k6 then tags every request by its URL, and
// /flow/{id}/submit carries a fresh id per flow. Exists only to measure the
// series count against prepared.js.
import http from 'k6/http';
import nextgen from 'k6/x/nextgen-spike';
import { scenarios } from './scenarios.js';

export const options = { scenarios };

const naked = (r) => ({ headers: r.params.headers });

export function login() {
  let r = nextgen.prepareCreateFlow();
  let res = http.post(r.url, r.body, naked(r));
  let flow = nextgen.verifyFlow('create_flow', res.status, res.body);

  r = nextgen.prepareSubmit('submit_identifier', flow.id, { email: __ENV.EMAIL });
  res = http.post(r.url, r.body, naked(r));
  flow = nextgen.verifyFlow('submit_identifier', res.status, res.body);

  r = nextgen.prepareSubmit('submit_password', flow.id, { 'x-auth-methods#password': __ENV.PASSWORD });
  res = http.post(r.url, r.body, naked(r));
  flow = nextgen.verifyFlow('submit_password', res.status, res.body);
  if (!flow.handoff_token) throw new Error('no handoff token');
}

export function getUser() {
  const r = nextgen.prepareGetUser();
  const res = http.get(r.url, naked(r));
  nextgen.verifyUser(res.status, res.body);
}
