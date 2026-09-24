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
/** code -> { email, verified }, redeemed once. */
const codes = new Map();

/**
 * The consent screen.
 *
 * It is styled to read, at a glance, as a different site from the app: a
 * recording of the journey is only worth watching if the hop off to the
 * provider is obvious. It deliberately does not imitate any real vendor's
 * branding -- this is a local fixture and says so.
 */
const page = (redirectUri, state) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Mock identity provider</title>
<style>
 :root{color-scheme:light}
 body{font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;
      background:linear-gradient(160deg,#1f2937,#0f172a);color:#0f172a}
 .card{background:#fff;padding:36px 40px;border-radius:16px;box-shadow:0 24px 60px #0006;min-width:380px}
 .badge{display:inline-flex;align-items:center;gap:8px;background:#fef3c7;color:#92400e;
        border:1px solid #fcd34d;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:650;
        letter-spacing:.3px;text-transform:uppercase;margin-bottom:18px}
 h1{font-size:22px;margin:0 0 6px;font-weight:650}
 .sub{font-size:14px;color:#64748b;margin:0 0 24px}
 label{display:block;font-size:13px;margin-bottom:6px;color:#475569;font-weight:550}
 input{width:100%;padding:11px 12px;font-size:15px;border:1px solid #cbd5e1;border-radius:9px;box-sizing:border-box}
 button{margin-top:20px;width:100%;padding:12px;font-size:15px;font-weight:600;border:0;
        border-radius:9px;background:#1d4ed8;color:#fff;cursor:pointer}
 .foot{margin-top:18px;font-size:12px;color:#94a3b8;text-align:center}
</style></head>
<body>
 <form class="card" method="POST" action="/authorize">
  <span class="badge">External identity provider</span>
  <h1>Choose an account</h1>
  <p class="sub">to continue to the application that sent you here</p>
  <label for="email">Email</label>
  <input id="email" name="email" type="email" value="sso-user@example.com" data-testid="mock-idp-email" autofocus>
  <input type="hidden" name="redirect_uri" value="${redirectUri}">
  <input type="hidden" name="state" value="${state}">
  <!-- The unverified case is a journey of its own: a provider may answer with
       an address it has not checked, and the engine must collect rather than
       take it. Exposed as a field so the matrix can drive it. -->
  <label style="font-weight:400;margin-top:14px">
   <input type="checkbox" name="verified" value="1" checked data-testid="mock-idp-verified"
          style="width:auto;margin-right:8px">
   Email is verified
  </label>
  <button type="submit" data-testid="mock-idp-continue">Continue</button>
  <p class="foot">Local mock provider &mdash; stands in for Google during testing</p>
 </form>
</body></html>`;

function issueCode(email, verified) {
  const code = `code_${Math.random().toString(36).slice(2)}`;
  codes.set(code, { email, verified });
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
    target.searchParams.set("code", issueCode(body.get("email"), body.get("verified") === "1"));
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
    const issued = codes.get(body.get("code"));
    codes.delete(body.get("code"));
    if (!issued) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant" }));
      return;
    }
    const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const idToken = [
      b64({ alg: "none", typ: "JWT" }),
      b64({
        iss: `http://localhost:${port}`,
        sub: `mock|${issued.email}`,
        aud: body.get("client_id"),
        email: issued.email,
        email_verified: issued.verified,
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
