package oauth

import (
	"html/template"
	"net/http"
	"net/url"

	"github.com/zitadel/nextgen/internal/service"
)

// consentPage is the minimal consent screen a third-party client gets. ADR
// 081 §11 makes consent a step of the login widget's flow; until then the
// server renders it. Every value is escaped by html/template.
var consentPage = template.Must(template.New("consent").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Allow {{.ClientName}}?</title>
<style>
  :root { color-scheme: light dark; --fg: #111; --muted: #555; --bg: #fff; --card: #f6f6f7; --line: #ddd; --accent: #4f46e5; }
  @media (prefers-color-scheme: dark) { :root { --fg: #eee; --muted: #aaa; --bg: #121214; --card: #1c1c1f; --line: #333; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
  main { width: min(440px, calc(100vw - 32px)); background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 28px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { margin: 0 0 12px; color: var(--muted); }
  dl { margin: 16px 0; display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; }
  dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
  .actions { display: flex; gap: 12px; margin-top: 20px; }
  button { flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--fg); font: inherit; cursor: pointer; }
  button[value=allow] { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
</head>
<body>
<main>
  <h1>Allow {{.ClientName}} to act as you?</h1>
  <p>{{.ClientName}} wants to use {{.APIName}} on your behalf, as {{.User}}.</p>
  <dl>
    <dt>App</dt><dd>{{.ClientName}}</dd>
    <dt>Returns to</dt><dd>{{.RedirectHost}}</dd>
    <dt>Access</dt><dd>{{.APIName}}{{if .Scope}} ({{.Scope}}){{end}}</dd>
  </dl>
  <p>Only allow apps you trust. You can sign out of them by signing in again.</p>
  <form method="post" action="{{.Action}}">
    <input type="hidden" name="request" value="{{.Request}}">
    <input type="hidden" name="csrf" value="{{.CSRF}}">
    <div class="actions">
      <button type="submit" name="decision" value="deny">Deny</button>
      <button type="submit" name="decision" value="allow">Allow</button>
    </div>
  </form>
</main>
</body>
</html>
`))

type consentView struct {
	ClientName   string
	RedirectHost string
	APIName      string
	Scope        string
	User         string
	Action       string
	Request      string
	CSRF         string
}

func (s *Server) showConsent(w http.ResponseWriter, r *http.Request, client Client, req authorizationRequest, user string) {
	ctx := r.Context()
	sealed, err := s.seal(ctx, kindRequest, req, requestTTL)
	if err != nil {
		authorizationServerFault(w, r, err)
		return
	}
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		authorizationServerFault(w, r, err)
		return
	}
	redirect, _ := url.Parse(req.RedirectURI)
	api, _ := s.app.apiByIdentifier(req.Resource)
	name := client.Name
	if name == "" {
		name = "An unnamed app"
	}
	view := consentView{
		ClientName:   name,
		RedirectHost: redirect.Host,
		APIName:      api.Name,
		User:         s.displayUser(r, user),
		Action:       s.issuerPath() + "/consent",
		Request:      sealed,
		CSRF:         consentToken(cookie.Value, sealed),
	}
	for i, scope := range req.Scope {
		if i > 0 {
			view.Scope += " "
		}
		view.Scope += scope
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	// The consent screen must never be framed: a page that framed it could
	// trick a click onto Allow.
	// No form-action: browsers apply it to the redirect after the post too,
	// and that redirect goes to the client.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
	w.Header().Set("X-Frame-Options", "DENY")
	_ = consentPage.Execute(w, view)
}

// displayUser is how the consent screen names the signed-in developer: the
// identifier their user schema designates, else the id.
func (s *Server) displayUser(r *http.Request, userID string) string {
	user, err := s.users.GetMyUser(r.Context(), service.GetMyUserInput{Self: s.selfOf(userID)})
	if err != nil || user.Ref == nil || user.Ref.Identifier == "" {
		return userID
	}
	return user.Ref.Identifier
}
