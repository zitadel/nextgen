// Command k6 is k6 with the nextgen benchmark harness compiled in: the
// k6/x/nextgen JavaScript module and the `k6 x nextgen` subcommand tree.
//
// It is exactly what `xk6 build` would generate. Building it directly keeps
// this module's `replace github.com/zitadel/nextgen => ../..` in force, which
// xk6 cannot honour because it builds from a temporary module of its own.
package main

import (
	"go.k6.io/k6/v2/cmd"

	_ "github.com/zitadel/nextgen/tools/bench/k6cmd"
	_ "github.com/zitadel/nextgen/tools/bench/k6module"
)

func main() {
	cmd.Execute()
}
