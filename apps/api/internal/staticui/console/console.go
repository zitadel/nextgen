package console

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"strings"

	"github.com/zitadel/nextgen/internal/securityheaders"
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
	index, err := fs.ReadFile(root, "index.html")
	if err != nil {
		return nil, fmt.Errorf("staticui/console: read index.html: %w", err)
	}
	enforced, reportOnly := Policies(string(index))
	files := staticui.New(prefix, root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(securityheaders.PolicyHeader, enforced)
		w.Header().Set(securityheaders.ReportOnlyPolicyHeader, reportOnly)
		files.ServeHTTP(w, r)
	}), nil
}

// Policies returns the console's Content-Security-Policy for index, its
// built index.html: the policy a browser enforces, and the stricter one it
// only reports on until no first-party code breaks it. Both allow the page's
// inline scripts by hash and the bundle's from the console's own origin. The
// hosted cloud's console service sends the same two (repo-root vercel.json,
// which a test holds to this).
func Policies(index string) (enforced, reportOnly string) {
	scripts := "script-src " + strings.Join(append([]string{"'self'"}, securityheaders.InlineScriptHashes(index)...), " ")
	report := "report-uri " + securityheaders.ReportPath
	enforced = securityheaders.Policy(
		scripts,
		"object-src 'none'",
		"base-uri 'self'",
		"frame-ancestors 'none'",
		report,
	)
	reportOnly = securityheaders.Policy(
		"default-src 'self'",
		scripts,
		// The UI libraries insert <style> elements at run time (dialogs'
		// scroll lock, toasts); an injected style can restyle a page, not run
		// code in it.
		"style-src 'self' 'unsafe-inline'",
		// The sign-in widget shows the branding's logo, which may be any
		// https URL (logo_url).
		"img-src 'self' data: https:",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
		report,
	)
	return enforced, reportOnly
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
