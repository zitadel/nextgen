// Shape "prepared": k6/http performs each request from JavaScript; the Go
// module prepares the request (typed encoders, bounded tags, cached bearer)
// and verifies the response (typed decoders). The sealed _zflow cookie rides
// in k6's per-VU cookie jar between the calls.
import http from 'k6/http';
import nextgen from 'k6/x/nextgen-spike';
import { scenarios } from './scenarios.js';

export const options = { scenarios };

export function login() {
  let r = nextgen.prepareCreateFlow();
  let res = http.post(r.url, r.body, r.params);
  let flow = nextgen.verifyFlow('create_flow', res.status, res.body);

  r = nextgen.prepareSubmit('submit_identifier', flow.id, { email: __ENV.EMAIL });
  res = http.post(r.url, r.body, r.params);
  flow = nextgen.verifyFlow('submit_identifier', res.status, res.body);

  r = nextgen.prepareSubmit('submit_password', flow.id, { 'x-auth-methods#password': __ENV.PASSWORD });
  res = http.post(r.url, r.body, r.params);
  flow = nextgen.verifyFlow('submit_password', res.status, res.body);
  if (!flow.handoff_token) throw new Error('no handoff token');
}

export function getUser() {
  const r = nextgen.prepareGetUser();
  const res = http.get(r.url, r.params);
  nextgen.verifyUser(res.status, res.body);
}
