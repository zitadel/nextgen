import { startMockServer } from "../src/server.js";

const port = Number(process.env.PORT ?? 4000);
startMockServer(port);
