//go:build !noconsole

package console

import (
	"embed"
	"io/fs"
)

// The console's build (apps/console) lands in dist/. A binary built with
// -tags noconsole leaves it out (embed_noconsole.go).
//
//go:embed all:dist
var embedded embed.FS

var dist fs.FS = embedded
