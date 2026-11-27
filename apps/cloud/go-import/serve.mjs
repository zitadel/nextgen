#!/usr/bin/env node
/**
 * The `go-import` service's dev server: `vercel dev` (scripts/run-cloud.mjs)
 * wants one for every service, a static one too. It answers every path with
 * public/index.html, as the service's rewrite does in a deployment.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const page = readFileSync(new URL("./public/index.html", import.meta.url));
const port = Number(process.env.PORT) || 3000;

createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(page);
}).listen(port, () => {
  console.log(`go-import: serving public/index.html for every path on http://localhost:${port}`);
});
