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

The client is generated from the OpenAPI source in
[`apps/api/api/openapi`](../../apps/api/api/openapi) by `moon run
server:generate`, with ogen. Do not edit the `*_gen.go` files: change the
spec and regenerate.

Versions are tagged `packages/go/v5.x.y`. The module path resolves through the
vanity host: `go get` asks `https://go.zitadel.com/zitadel/v5/...?go-get=1`, and
the hosted cloud answers every path on that host with one page whose
`go-import` meta names this module's repository and its directory,
`packages/go` ([`apps/cloud/go-import`](../../apps/cloud/go-import),
[runbook](../../docs/runbooks/cloud.md#go-import-path)).
