// Command k6 is a k6 binary with the nextgen spike module compiled in. It is
// what `xk6 build` would generate; building it directly keeps the nested
// module's replace directive in force (xk6 builds from a temporary module).
package main

import (
	"go.k6.io/k6/v2/cmd"

	_ "github.com/zitadel/nextgen/tools/bench/spike"
)

func main() {
	cmd.Execute()
}
