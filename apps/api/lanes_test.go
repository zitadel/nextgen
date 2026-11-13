package main

import (
	"bufio"
	"encoding/json"
	"go/build/constraint"
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
				"the %s script must list exactly the packages with %s tests", script, tag)
		})
	}
}

// taggedTestPackages returns the directories, relative to the module root,
// that hold a _test.go file built under tag and not without it.
func taggedTestPackages(t *testing.T, tag string) []string {
	t.Helper()
	var dirs []string
	err := filepath.WalkDir(".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			name := d.Name()
			if path != "." && (name == "node_modules" || name == "testdata" || name == "vendor" ||
				strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_")) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, "_test.go") {
			return nil
		}
		expr, err := buildConstraint(path)
		if err != nil || expr == nil {
			return err
		}
		if expr.Eval(func(name string) bool { return name == tag }) && !expr.Eval(func(string) bool { return false }) {
			dir := filepath.Dir(path)
			if !slices.Contains(dirs, dir) {
				dirs = append(dirs, dir)
			}
		}
		return nil
	})
	require.NoError(t, err)
	slices.Sort(dirs)
	return dirs
}

// buildConstraint reads the //go:build line of a Go file's header, if any.
func buildConstraint(path string) (constraint.Expr, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "package ") {
			break
		}
		if constraint.IsGoBuild(line) {
			return constraint.Parse(line)
		}
	}
	return nil, scanner.Err()
}
