// Package scripts embeds the k6 entry script so `k6 x nextgen sweep` can run
// from any working directory without being told where the checkout is.
package scripts

import _ "embed"

// Bench is the contents of bench.js.
//
//go:embed bench.js
var Bench []byte
