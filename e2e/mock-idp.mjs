/**
 * A minimal OIDC provider for driving the SSO journey locally.
 *
 * Stands in for Google: it serves a sign-in page, issues an authorization
 * code, and exchanges it for an id_token carrying the email that was chosen.
 * Nothing is signed — the stub server reads the claims without verifying — so
 * this is a test fixture, never a dependency of anything shipped.
 *
 *   node mock-idp.mjs --port 9100
 */
import { createServer } from "node:http";

const port = Number(process.argv[process.argv.indexOf("--port") + 1] ?? 9100);
/** code -> email, redeemed once. */
const codes = new Map();

const page = (redirectUri, state) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Mock provider sign-in</title>
<style>
 body{font:16px system-ui;margin:0;display:grid;place-items:center;height:100vh;background:#f6f7f9}
 form{background:#fff;padding:32px;border-radius:12px;box-shadow:0 1px 3px #0002;min-width:320px}
 h1{font-size:18px;margin:0 0 16px} label{display:block;font-size:13px;margin-bottom:6px;color:#555}
 input{width:100%;padding:10px;font-size:15px;border:1px solid #ccc;border-radius:8px;box-sizing:border-box}
 button{margin-top:16px;width:100%;padding:10px;font-size:15px;border:0;border-radius:8px;background:#1a73e8;color:#fff;cursor:pointer}
</style></head>
<body>
 <form method="POST" action="/authorize">
  <h1>Mock provider — choose an account</h1>
  <label for="email">Email</label>
  <input id="email" name="email" type="email" value="sso-user@example.com" data-testid="mock-idp-email" autofocus>
  <input type="hidden" name="redirect_uri" value="${redirectUri}">
  <input type="hidden" name="state" value="${state}">
  <button type="submit" data-testid="mock-idp-continue">Continue</button>
 </form>
</body></html>`;

function issueCode(email) {
  const code = `code_${Math.random().toString(36).slice(2)}`;
  codes.set(code, email);
  return code;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  if (url.pathname === "/authorize" && req.method === "GET") {
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page(redirectUri, state));
    return;
  }

  if (url.pathname === "/authorize" && req.method === "POST") {
    const body = await new Promise((resolve) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => resolve(new URLSearchParams(raw)));
    });
    const target = new URL(body.get("redirect_uri"));
    target.searchParams.set("code", issueCode(body.get("email")));
    target.searchParams.set("state", body.get("state") ?? "");
    res.writeHead(302, { location: target.toString() });
    res.end();
    return;
  }

  if (url.pathname === "/token" && req.method === "POST") {
    const body = await new Promise((resolve) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => resolve(new URLSearchParams(raw)));
    });
    const email = codes.get(body.get("code"));
    codes.delete(body.get("code"));
    if (!email) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant" }));
      return;
    }
    const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const idToken = [
      b64({ alg: "none", typ: "JWT" }),
      b64({
        iss: `http://localhost:${port}`,
        sub: `mock|${email}`,
        aud: body.get("client_id"),
        email,
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
      "",
    ].join(".");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ access_token: "mock-access-token", id_token: idToken, token_type: "Bearer" }));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(port, () => console.log(`mock idp listening on http://localhost:${port}`));
