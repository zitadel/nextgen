// Command analyzers bundles this repository's custom go/analysis analyzers
// into one binary. It runs standalone (moon run server:lint) or as a go vet
// tool:
//
//	go run ./tools/analyzers/cmd/analyzers ./...
//	go build -o "$TMPDIR/analyzers" ./tools/analyzers/cmd/analyzers && go vet -vettool="$TMPDIR/analyzers" ./...
//
// Flags are namespaced per analyzer (-egresslint.check-tests). Add a new
// analyzer by importing its package and appending it to the list below.
package main

import (
	"golang.org/x/tools/go/analysis/multichecker"

	"github.com/zitadel/nextgen/tools/analyzers/egresslint"
)

func main() {
	multichecker.Main(
		egresslint.Analyzer,
	)
}
