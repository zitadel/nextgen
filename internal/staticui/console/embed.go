package console

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"

	"github.com/zitadel/nextgen/internal/staticui"
)

//go:embed all:dist
var dist embed.FS

// Handler serves the embedded console SPA at prefix (e.g. "/ui/console").
func Handler(prefix string) (http.Handler, error) {
	root, err := fs.Sub(dist, "dist")
	if err != nil {
		return nil, fmt.Errorf("staticui/console: sub dist: %w", err)
	}
	return staticui.New(prefix, root), nil
}

// ValidateDist reports whether a production console build was synced into dist/.
func ValidateDist() error {
	if _, err := fs.Stat(dist, "dist/index.html"); err != nil {
		return fmt.Errorf(
			"console UI not embedded: run `pnpm nx build @zitadel/console` and `scripts/sync-embedded-ui-dist.sh` (see CONTRIBUTING.md): %w",
			err,
		)
	}
	return nil
}
