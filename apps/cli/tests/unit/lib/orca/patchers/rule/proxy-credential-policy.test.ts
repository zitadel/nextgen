import { EventEmitter } from "node:events";
import zlib from "node:zlib";

import { describe, expect, it } from "vitest";

import { exchangeRedactionFunctions } from "../../../../../../src/lib/orca/patchers/rule/proxy-credential-policy";

type Relay = (proxyRes: unknown, req: unknown, res: unknown) => void;

const relayResponse = new Function(
  "zitadelZlib",
  `${exchangeRedactionFunctions("")}\nreturn relayResponse;`,
)(zlib) as Relay;

const TOKEN = "SECRET-SESSION-TOKEN";

/** A server response whose `writeHead` throws for the first `failures` calls. */
function aResponse(failures: number) {
  const written: string[] = [];
  let calls = 0;
  const res = {
    destroyed: false,
    headersSent: false,
    destroy() {
      this.destroyed = true;
    },
    writeHead(status: number) {
      calls += 1;
      if (calls <= failures) {
        throw new Error("ERR_HTTP_TRAILER_INVALID");
      }
      this.headersSent = true;
      written.push(`head ${status}`);
    },
    end(chunk?: string | Buffer) {
      written.push(String(chunk ?? ""));
    },
  };
  return { res, written };
}

function anAnswer(statusCode: number, headers: Record<string, string>, body: string) {
  const proxyRes = Object.assign(new EventEmitter(), {
    statusCode,
    headers,
    pipe: () => {
      throw new Error("must not pipe");
    },
  });
  return {
    proxyRes,
    deliver() {
      proxyRes.emit("data", Buffer.from(body));
      proxyRes.emit("end");
    },
  };
}

const EXCHANGE = { method: "POST", url: "/sessions/exchange" };
const ANSWER = JSON.stringify({ session_token: TOKEN, session: { session_id: "s1" } });

describe("the generated exchange relay", () => {
  it("answers 502 instead of throwing when the head of an exchange answer cannot be written", () => {
    const { res, written } = aResponse(1);
    const { proxyRes, deliver } = anAnswer(200, { "content-type": "application/json" }, ANSWER);
    relayResponse(proxyRes, EXCHANGE, res);

    expect(deliver).not.toThrow();
    expect(written[0]).toBe("head 502");
  });

  it("cuts the connection instead of throwing when no answer can be written", () => {
    const { res } = aResponse(Number.POSITIVE_INFINITY);
    const { proxyRes, deliver } = anAnswer(200, { "content-type": "application/json" }, ANSWER);
    relayResponse(proxyRes, EXCHANGE, res);

    expect(deliver).not.toThrow();
    expect(res.destroyed).toBe(true);
  });

  it("writes nothing of a failed exchange answer, the session token least of all", () => {
    const { res, written } = aResponse(1);
    const { proxyRes, deliver } = anAnswer(200, { "content-type": "application/json" }, ANSWER);
    relayResponse(proxyRes, EXCHANGE, res);

    deliver();

    expect(written.join("")).not.toContain(TOKEN);
  });

  it("answers 502 instead of throwing when the head of any other answer cannot be written", () => {
    const { res, written } = aResponse(1);
    const { proxyRes } = anAnswer(200, {}, "ok");

    expect(() =>
      relayResponse(proxyRes, { method: "GET", url: "/sessions/me" }, res),
    ).not.toThrow();
    expect(written[0]).toBe("head 502");
  });
});
