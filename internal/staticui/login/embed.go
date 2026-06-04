package login

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"

	"github.com/zitadel/nextgen/internal/staticui"
)

//go:embed all:dist
var dist embed.FS

// Handler serves the embedded login shell at prefix (e.g. "/ui/login").
func Handler(prefix string) (http.Handler, error) {
	root, err := fs.Sub(dist, "dist")
	if err != nil {
		return nil, fmt.Errorf("staticui/login: sub dist: %w", err)
	}
	return staticui.New(prefix, root), nil
}

// ValidateDist reports whether a production login-ui build was synced into dist/.
func ValidateDist() error {
	if _, err := fs.Stat(dist, "dist/index.html"); err != nil {
		return fmt.Errorf(
			"login UI not embedded: run `pnpm nx build @zitadel/login-ui` and `scripts/sync-embedded-ui-dist.sh` (see CONTRIBUTING.md): %w",
			err,
		)
	}
	return nil
}
