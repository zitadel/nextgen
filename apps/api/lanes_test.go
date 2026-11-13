package main

import (
	"encoding/json"
	"errors"
	"go/build"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDatabaseLanesListEveryTaggedPackage keeps the Postgres and SQLite lanes
// of apps/server/package.json in step with the build tags. A lane runs only
// the packages that hold tests of its tag, so the untagged tests run once, in
// test:unit; a package missing from the list would silently skip its tagged
// tests.
func TestDatabaseLanesListEveryTaggedPackage(t *testing.T) {
	manifest, err := os.ReadFile(filepath.Join("..", "server", "package.json"))
	require.NoError(t, err)
	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	require.NoError(t, json.Unmarshal(manifest, &pkg))

	for _, tag := range []string{"postgres_integration", "sqlite_integration"} {
		script := "test:" + strings.TrimSuffix(tag, "_integration")
		t.Run(script, func(t *testing.T) {
			command, ok := pkg.Scripts[script]
			require.True(t, ok, "apps/server/package.json has no %s script", script)
			var listed []string
			for field := range strings.FieldsSeq(command) {
				if strings.HasPrefix(field, "./") {
					listed = append(listed, filepath.Clean(field))
				}
			}
			slices.Sort(listed)
			assert.Equal(t, taggedTestPackages(t, tag), listed,
				"the %s script in apps/server/package.json must list exactly the packages with %s tests, as ./<dir>/", script, tag)
		})
	}
}

// taggedTestPackages returns the directories, relative to the module root,
// whose tests go/build selects under tag but not without it.
func taggedTestPackages(t *testing.T, tag string) []string {
	t.Helper()
	tagged := build.Default
	tagged.BuildTags = []string{tag}
	testFiles := func(ctx build.Context, dir string) int {
		pkg, err := ctx.ImportDir(dir, 0)
		var noGo *build.NoGoError
		if errors.As(err, &noGo) {
			return 0
		}
		require.NoError(t, err)
		return len(pkg.TestGoFiles) + len(pkg.XTestGoFiles)
	}
	var dirs []string
	err := filepath.WalkDir(".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return err
		}
		name := d.Name()
		if path != "." && (name == "node_modules" || name == "testdata" || name == "vendor" ||
			strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_")) {
			return filepath.SkipDir
		}
		if testFiles(tagged, path) > testFiles(build.Default, path) {
			dirs = append(dirs, path)
		}
		return nil
	})
	require.NoError(t, err)
	slices.Sort(dirs)
	return dirs
}
