import { describe, expect, it } from "vitest";

import { staleFakeServers } from "../../helpers/stale-servers";

const ORPHAN =
  "87289     1 node /var/folders/zb/T/zitadel-fake-server-vjZmOm/nextgen --user-file /x/admin-user.json --migrate";
const RUNNING =
  "91000 90999 node /var/folders/zb/T/zitadel-fake-server-aBcDeF/nextgen --user-file /y/admin-user.json";
const UNRELATED_ORPHAN = "  500     1 /usr/sbin/cupsd -l";

describe("staleFakeServers", () => {
  it("names a fake server whose parent is gone", () => {
    expect(staleFakeServers(ORPHAN)).toEqual([87289]);
  });

  it("leaves a fake server whose parent is alive, since a run is using it", () => {
    expect(staleFakeServers(RUNNING)).toEqual([]);
  });

  it("leaves a process that is not a fake server, whoever its parent is", () => {
    expect(staleFakeServers(UNRELATED_ORPHAN)).toEqual([]);
  });

  it("finds each orphan among other processes", () => {
    const ps = [UNRELATED_ORPHAN, ORPHAN, RUNNING, "", "not a ps line"].join("\n");

    expect(staleFakeServers(ps)).toEqual([87289]);
  });
});
