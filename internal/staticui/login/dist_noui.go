//go:build noui

package login

import "embed"

// dist is empty: a build with the noui tag embeds no login shell. It is for a
// deployment whose UIs are built and served next to the server (server.ui
// external or headless); enabling the embedded UI on such a build fails at
// boot, as ValidateDist finds no index.html.
var dist embed.FS
