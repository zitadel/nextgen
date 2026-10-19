package console

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"

	"github.com/zitadel/nextgen/internal/staticui"
)

// errLeftOut is what a binary built with -tags noconsole reports.
var errLeftOut = errors.New("console UI not embedded: the binary was built with -tags noconsole")

// Handler serves the embedded console SPA at prefix (e.g. "/ui/console").
func Handler(prefix string) (http.Handler, error) {
	if dist == nil {
		return nil, fmt.Errorf("staticui/console: %w", errLeftOut)
	}
	root, err := fs.Sub(dist, "dist")
	if err != nil {
		return nil, fmt.Errorf("staticui/console: sub dist: %w", err)
	}
	return staticui.New(prefix, root), nil
}

// ValidateDist reports whether a production console build was written into dist/.
func ValidateDist() error {
	if dist == nil {
		return errLeftOut
	}
	if _, err := fs.Stat(dist, "dist/index.html"); err != nil {
		return fmt.Errorf(
			"console UI not embedded: run `moon run console:build` (see CONTRIBUTING.md): %w",
			err,
		)
	}
	return nil
}
