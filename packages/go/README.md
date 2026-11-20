# Zitadel Go client

The Go client for the Zitadel API: `go.zitadel.com/zitadel/v5`. The `api`
package is the generated client for every operation of the API, with the
request and response types; `ogenx` holds the few hand-written types the
wire format needs (an ISO 8601 duration).

```go
import (
	"context"
	"fmt"

	"github.com/ogen-go/ogen/ogenerrors"

	"go.zitadel.com/zitadel/v5/api"
)

// projectSecret authenticates every request with a project secret, the
// bearer token the API's OAuth2 scheme takes. The session cookie scheme is
// skipped: it is for a browser signed in through the login.
type projectSecret string

func (s projectSecret) OAuth2(context.Context, api.OperationName) (api.OAuth2, error) {
	return api.OAuth2{Token: string(s)}, nil
}

func (projectSecret) SessionCookie(context.Context, api.OperationName) (api.SessionCookie, error) {
	return api.SessionCookie{}, ogenerrors.ErrSkipClientSecurity
}

func main() {
	// The deployment's origin; api.New puts the API's path prefix after it.
	client, err := api.New("https://zitadel.example.com", projectSecret("zps_…"))
	if err != nil {
		panic(err)
	}
	res, err := client.GetProject(context.Background(), api.GetProjectParams{ProjectID: "proj_123"})
	if err != nil {
		panic(err)
	}
	project, ok := res.(*api.ProjectDetailResponse)
	if !ok {
		panic(fmt.Sprintf("not a project: %T", res))
	}
	fmt.Println(project.Name)
}
```

Every operation answers one of its response types (`res` above): the
successful one, or an error response the API documents, which is why the
example asserts the type. The same code runs as `api/example_test.go` against a
test server.

## Mounting the login

The `login` package renders and drives the Zitadel login flow server-side,
with [templ](https://templ.guide) components: mount it at a route and a Go
web app has a working sign-in, every step a plain form that works with
JavaScript off. The configuration is what `zitadel setup` writes to
`.env.local`.

```go
import (
	"net/http"
	"os"

	"go.zitadel.com/zitadel/v5/login"
)

func main() {
	mux := http.NewServeMux()
	err := login.Mount(mux, "/login", login.Config{
		ServerURL:     os.Getenv("ZITADEL_URL"),
		ProjectID:     os.Getenv("ZITADEL_PROJECT_ID"),
		ProjectSecret: os.Getenv("ZITADEL_PROJECT_SECRET"),
		PublicOrigin:  "http://localhost:8080",
		PostSignInURL: "/",
	})
	if err != nil {
		panic(err)
	}
	http.ListenAndServe(":8080", mux)
}
```

`PublicOrigin` is the origin browsers reach the app on, such as
`https://app.example.com`: the API matches it against the project's origins
literally, and an `https` one makes every cookie `Secure`. It is configured,
not read off the request, which behind a proxy says neither.

`GET /login/` renders the current step and `POST /login/` submits it; a
signed-in user gets the session cookie the Zitadel SDKs read
(`__Host-zitadel_session_<project id>`, or `zitadel_session_<project id>` on a
plain `http` origin) and lands on the flow's redirect, else on
`PostSignInURL`. Failures are logged in full to `Config.Logger` and told to the
browser only in general. The same code runs as `login/example_test.go`
against a test server. A passkey step loads `passkey.js` from under the login's
route, the `<zl-passkey>` atom of `@zitadel/components` with its form glue, the
one thing that needs JavaScript. The copy comes in `en`, `de` and `it`
(`Config.Locale`).

A sign-in provider's button sends the browser to the provider, but the
sign-in cannot complete yet: the API binds the attempt to the browser with a
cookie of its own, which lands on this server instead, so the provider's
callback does not find it. That needs a same-origin callback proxy, which this
package does not have.

The client is generated from the OpenAPI source in
[`apps/api/api/openapi`](../../apps/api/api/openapi) by `turbo run generate
--filter=@zitadel/server`, with ogen. Do not edit the `*_gen.go` files: change the
spec and regenerate.

Versions are tagged `packages/go/v5.x.y`. The module path resolves through the
vanity host: `go get` asks `https://go.zitadel.com/zitadel/v5/...?go-get=1`, and
the hosted cloud answers every path on that host with one page whose
`go-import` meta names this module's repository and its directory,
`packages/go` ([`apps/cloud/go-import`](../../apps/cloud/go-import),
[runbook](../../docs/runbooks/cloud.md#go-import-path)).
