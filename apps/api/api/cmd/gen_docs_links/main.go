// gen_docs_links makes the docs links in the public Go client's godoc
// absolute. The spec links docs pages root-relative (`/docs/concepts/...`),
// which the docs site resolves on whichever deployment serves it, but which
// open nowhere from pkg.go.dev or an editor. ogen copies the spec's
// descriptions into comments as they are, so this pass rewrites them in the
// files it wrote, on client.DocsOrigin.
//
// Usage: gen_docs_links <dir>, which rewrites every *_gen.go in dir. It runs
// after ogen writes the client (api/generate.go). The server's stubs keep
// relative links: only this repository reads them, beside the spec.
package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"

	"github.com/zitadel/nextgen/api/client"
)

var (
	relativeDocsLink = []byte("](/docs/")
	absoluteDocsLink = []byte("](" + client.DocsOrigin + "/docs/")
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: gen_docs_links <dir>")
		os.Exit(2)
	}
	if err := rewriteDir(os.Args[1]); err != nil {
		fmt.Fprintln(os.Stderr, "gen_docs_links:", err)
		os.Exit(1)
	}
}

// rewriteDir rewrites the docs links in every *_gen.go in dir, writing only
// the files that change.
func rewriteDir(dir string) error {
	files, err := filepath.Glob(filepath.Join(dir, "*_gen.go"))
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return fmt.Errorf("no *_gen.go in %s", dir)
	}
	for _, file := range files {
		src, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		out := absoluteDocsLinks(src)
		if bytes.Equal(out, src) {
			continue
		}
		if err := os.WriteFile(file, out, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// absoluteDocsLinks rewrites every root-relative Markdown link to a docs page
// in src into one on client.DocsOrigin. ogen wraps comments at spaces, and
// `](/docs/` has none, so a wrapped link is still found whole.
func absoluteDocsLinks(src []byte) []byte {
	return bytes.ReplaceAll(src, relativeDocsLink, absoluteDocsLink)
}
