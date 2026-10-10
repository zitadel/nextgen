//go:build !noui

package login

import "embed"

// dist is the production build of the login shell, embedded by the default
// build. A build with the noui tag embeds nothing (dist_noui.go).
//
//go:embed all:dist
var dist embed.FS
