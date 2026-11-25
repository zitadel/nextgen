package idp_test

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/idp"
)

// An example connection is the first thing a reader copies, and the OpenAPI
// lint checks it only against the mirror the spec exposes. This runs every
// connection document in the idps endpoint examples through what a create
// runs: the connection schema, then the engine's parse. An example the
// server would refuse fails here instead of shipping.
func TestIDPEndpointExamplesAreAccepted(t *testing.T) {
	validator, err := domain.NewSchemaValidator("https://example.com/api/schemas")
	require.NoError(t, err)
	uri, err := validator.LatestSchemaURI(domain.SchemaKindIDPConnection)
	require.NoError(t, err)
	schema, err := validator.GetBuiltinSchema(uri)
	require.NoError(t, err)

	root := filepath.Join("..", "..", "api", "openapi", "endpoints", "idps")
	var documents []example
	require.NoError(t, filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || !strings.HasSuffix(path, "methods.yaml") {
			return err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var doc any
		if err := yaml.Unmarshal(raw, &doc); err != nil {
			return err
		}
		documents = collectConnections(path, doc, documents)
		return nil
	}))
	require.NotEmpty(t, documents, "the idps endpoints should carry example connections")

	for _, connection := range documents {
		t.Run(connection.name, func(t *testing.T) {
			require.NoError(t, schema.Validate(connection.document), "the connection schema refuses an example")
			body, err := json.Marshal(connection.document)
			require.NoError(t, err)
			_, err = idp.ParseConnection("", body)
			require.NoError(t, err, "the engine refuses an example")
		})
	}
}

type example struct {
	name     string
	document map[string]any
}

// collectConnections appends every connection document under doc: an object
// carrying slug, protocol, and display_name. Each is named by its file and
// slug, so a failure names both.
func collectConnections(path string, doc any, into []example) []example {
	switch v := doc.(type) {
	case map[string]any:
		_, hasSlug := v["slug"]
		_, hasProtocol := v["protocol"]
		_, hasDisplayName := v["display_name"]
		if hasSlug && hasProtocol && hasDisplayName {
			// A round trip through JSON gives the validator the types it
			// expects, the same as a decoded request body.
			raw, _ := json.Marshal(v)
			var normalized map[string]any
			_ = json.Unmarshal(raw, &normalized)
			return append(into, example{name: fmt.Sprintf("%s %v", path, v["slug"]), document: normalized})
		}
		for _, child := range v {
			into = collectConnections(path, child, into)
		}
	case []any:
		for _, child := range v {
			into = collectConnections(path, child, into)
		}
	}
	return into
}
