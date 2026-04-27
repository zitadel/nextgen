// Package console embeds the React SPA built into apps/console/dist
// so it can be served by the Go server binary.
//
// The dist/ directory is populated by `pnpm --filter ./apps/console build`
// (Vite). In clean checkouts the directory contains only .gitkeep, which
// keeps //go:embed satisfied without shipping any UI assets.
package console

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// FS returns the embedded SPA asset tree rooted at the Vite dist root.
func FS() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
