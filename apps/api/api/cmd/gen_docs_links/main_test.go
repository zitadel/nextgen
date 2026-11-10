package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/api/client"
)

func TestAbsoluteDocsLinks(t *testing.T) {
	t.Parallel()
	src := "// A [claim attaches a project to a team](/docs/concepts/project-team-user#claim),\n" +
		"// a [release](/docs/concepts/repo-config), and\n" +
		"// [the reference](https://example.com/docs/x) and /docs/ in prose stay.\n"
	want := "// A [claim attaches a project to a team](" + client.DocsOrigin + "/docs/concepts/project-team-user#claim),\n" +
		"// a [release](" + client.DocsOrigin + "/docs/concepts/repo-config), and\n" +
		"// [the reference](https://example.com/docs/x) and /docs/ in prose stay.\n"
	assert.Equal(t, want, string(absoluteDocsLinks([]byte(src))))
	// A second pass changes nothing.
	assert.Equal(t, want, string(absoluteDocsLinks([]byte(want))))
}

func TestRewriteDirLeavesOtherFiles(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	link := "// [claim](/docs/concepts/project-team-user#claim)\n"
	require.NoError(t, os.WriteFile(filepath.Join(dir, "oas_client_gen.go"), []byte(link), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "example_test.go"), []byte(link), 0o644))

	require.NoError(t, rewriteDir(dir))

	gen, err := os.ReadFile(filepath.Join(dir, "oas_client_gen.go"))
	require.NoError(t, err)
	assert.Equal(t, "// [claim]("+client.DocsOrigin+"/docs/concepts/project-team-user#claim)\n", string(gen))
	other, err := os.ReadFile(filepath.Join(dir, "example_test.go"))
	require.NoError(t, err)
	assert.Equal(t, link, string(other))
}

func TestRewriteDirFailsWithoutGeneratedFiles(t *testing.T) {
	t.Parallel()
	assert.Error(t, rewriteDir(t.TempDir()))
}
