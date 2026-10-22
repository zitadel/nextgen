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

Versions are tagged `packages/go/v5.x.y`; the module path `go.zitadel.com/zitadel/v5`
resolves to this directory of the repository through the vanity host.
