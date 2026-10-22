# Zitadel Go client

The Go client for the Zitadel API: `go.zitadel.com/zitadel/v5`. The `api`
package is the generated client for every operation of the API, with the
request and response types; `ogenx` holds the few hand-written types the
wire format needs (an ISO 8601 duration).

```go
import (
	"context"
	"fmt"

	"go.zitadel.com/zitadel/v5/api"
)

func main() {
	client, err := api.NewClient("https://zitadel.example.com")
	if err != nil {
		panic(err)
	}
	health, err := client.GetHealth(context.Background())
	if err != nil {
		panic(err)
	}
	fmt.Println(health)
}
```

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
