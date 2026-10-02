// Shape "delegated": the Go module drives the generated client, but every
// call is performed by k6's own httpext.MakeRequest, so the built-in
// http_req_* metrics and the per-VU cookie jar are in force.
import nextgen from 'k6/x/nextgen-spike';
import { scenarios } from './scenarios.js';

export const options = { scenarios };

export function login() {
  nextgen.login('delegated');
}

export function getUser() {
  nextgen.getUser('delegated');
}
