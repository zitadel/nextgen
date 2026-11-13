// The wrapper's loopback OTLP/HTTP collector: the server exports its spans and
// metrics here as protobuf, one POST per export, to the path of its signal.
//
// Every export gets an answer, so the server's exporter never waits for a
// timeout: 200 with an empty Export*ServiceResponse once it was taken, 404 for
// a path nothing takes, 413 for an export over maxBytes, and 400 for one that
// does not decode. The OTLP exporter retries none of these, so a rejected
// export is dropped, and logged here.

import { gunzipSync } from "node:zlib";

/**
 * Returns the collector's request handler.
 * @param {Map<string, (body: Buffer) => void>} collectors what takes an
 *   export, by path; a Map, so a path never names an inherited property
 * @param {{ maxBytes: number }} options the largest export taken, compressed
 *   or not
 */
export function collectorHandler(collectors, { maxBytes }) {
  return (req, res) => {
    const collect = req.method === "POST" ? collectors.get(req.url) : undefined;
    if (!collect) {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) {
        // Read and discarded, so the exporter can finish sending.
        return;
      }
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        // Paths and sizes are arguments, never part of the format string.
        console.error("server wrapper: dropping an export to %s over %d bytes", req.url, maxBytes);
        res.writeHead(413, { connection: "close" }).end();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        return;
      }
      try {
        let body = Buffer.concat(chunks);
        if (req.headers["content-encoding"] === "gzip") {
          // Bounded too: a small gzip body can inflate far past maxBytes.
          body = gunzipSync(body, { maxOutputLength: maxBytes });
        }
        collect(body);
        res.writeHead(200, { "content-type": "application/x-protobuf" }).end();
      } catch (error) {
        console.error("server wrapper: dropping an export to %s:", req.url, error);
        res.writeHead(400).end();
      }
    });
  };
}
