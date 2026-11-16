// The global setup a customer writes, imported by the published entry name
// so the run exercises the built `./vitest` export, not the source.
import { zitadelGlobalSetup } from "@zitadel/testing/vitest";

const serverBinary = process.env.ZITADEL_SERVER_BINARY;

// Without a server binary the suite skips, like the kit's own integration
// test, so there is nothing to boot.
export default serverBinary
  ? zitadelGlobalSetup({ serverBinary, appOrigins: ["http://localhost:3002"] })
  : () => undefined;
