package domain_test

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// TestShippedUserSchemasPassServerValidation feeds every user schema shipped
// under packages/config/defaults — the default and every preset — through the
// same validation a schema write goes through. The designation rules are
// Go-side semantics the meta JSON Schema cannot express, so the TypeScript
// meta-schema tests cannot stand in for this: a shipped schema that only they
// accept would fail at upload time, breaking `zitadel setup`.
func TestShippedUserSchemasPassServerValidation(t *testing.T) {
	v := newTestValidator(t)
	roots := []string{
		filepath.Join("..", "..", "packages", "config", "defaults"),
		filepath.Join("..", "..", "api", "openapi", "endpoints", "schemas", "examples"),
	}

	var checked []string
	validate := func(root string) func(string, fs.DirEntry, error) error {
		return func(path string, d fs.DirEntry, walkErr error) error {
			require.NoError(t, walkErr)
			if d.IsDir() || !strings.HasSuffix(path, ".json") {
				return nil
			}
			raw, err := os.ReadFile(path)
			require.NoError(t, err)
			// The ${...} placeholders live inside JSON strings, so the templates
			// parse as-is; select user schemas by their decoded kind, not by a
			// formatting-sensitive substring.
			var parsed map[string]any
			require.NoError(t, json.Unmarshal(raw, &parsed), path)
			if kind, _ := parsed["kind"].(string); kind != domain.SchemaDocumentKindUser {
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
		}
	}
	for _, root := range roots {
		require.NoError(t, filepath.WalkDir(root, validate(root)))
	}
	require.GreaterOrEqual(t, len(checked), 3,
		"expected the default, preset, and example user schemas under %v, found %v", roots, checked)
}
