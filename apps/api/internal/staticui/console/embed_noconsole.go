//go:build noconsole

package console

import "io/fs"

// Built with -tags noconsole, the binary carries no console: dist stays nil,
// so Handler and ValidateDist refuse. The hosted cloud's function builds this
// way (apps/cloud/build-launcher.sh): its console is a service of its own,
// whose build lands in dist/ of the same checkout.
var dist fs.FS
