package domain_test

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestShippedUserSchemasPassServerValidation feeds every user schema shipped
// under packages/config/defaults — the default and every preset — through the
// same validation a schema write goes through. The designation rules are
// Go-side semantics the meta JSON Schema cannot express, so the TypeScript
// meta-schema tests cannot stand in for this: a shipped schema that only they
// accept would fail at upload time, breaking `zitadel setup`.
func TestShippedUserSchemasPassServerValidation(t *testing.T) {
	v := newTestValidator(t)
	root := filepath.Join("..", "..", "packages", "config", "defaults")

	var checked []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		require.NoError(t, walkErr)
		if d.IsDir() || !strings.HasSuffix(path, ".json") {
			return nil
		}
		raw, err := os.ReadFile(path)
		require.NoError(t, err)
		if !strings.Contains(string(raw), `"kind": "user-schema"`) {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		require.NoError(t, err)
		checked = append(checked, rel)

		// The templates substitute the serving instance; point metaSchema at
		// the same base the test validator compiled its builtins under.
		doc := strings.NewReplacer(
			"${SERVER_URL}", testBuiltinBase,
			"${USER_SCHEMA_URL}", "https://server.test/schemas/user.json",
		).Replace(string(raw))

		t.Run(filepath.ToSlash(rel), func(t *testing.T) {
			require.NoError(t, v.ValidateAgainstMetaSchema([]byte(doc)))
		})
		return nil
	})
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(checked), 2,
		"expected the default and preset user schemas under %s, found %v", root, checked)
}
