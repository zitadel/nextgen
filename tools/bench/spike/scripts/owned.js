// Shape "owned": the Go module performs the whole login journey and the user
// read through the generated client. k6 supplies VUs, pacing and the summary.
import nextgen from 'k6/x/nextgen-spike';
import { scenarios } from './scenarios.js';

export const options = { scenarios };

export function login() {
  nextgen.login('owned');
}

export function getUser() {
  nextgen.getUser('owned');
}
