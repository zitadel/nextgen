package schemas_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/domain"
)

const testBase = "https://example.com/api/schemas"

// Seeded at startup, so a document the server refuses would stop the
// platform bootstrap: it passes the same checks as an uploaded schema.
func TestPlatformHumanUserSchemaIsValid(t *testing.T) {
	validator, err := domain.NewSchemaValidator(testBase)
	require.NoError(t, err)

	doc, err := schemas.PlatformHumanUserSchema(testBase)
	require.NoError(t, err)
	require.NoError(t, validator.ValidateAgainstMetaSchema(doc))
}

// The default plus an optional name, nothing else.
func TestPlatformHumanUserSchemaExtendsTheDefault(t *testing.T) {
	var platform, base map[string]any
	doc, err := schemas.PlatformHumanUserSchema(testBase)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(doc, &platform))
	require.NoError(t, json.Unmarshal(schemas.DefaultHumanUserSchema(testBase), &base))

	assert.NotContains(t, platform, "$id")
	assert.Equal(t, base["required"], platform["required"])
	assert.Equal(t, []string{schemas.PlatformDisplayNameProperty}, domain.DesignatedDisplay(doc))

	props := platform["properties"].(map[string]any)
	assert.Contains(t, props, "email")
	assert.Contains(t, props, schemas.PlatformDisplayNameProperty)
	assert.Len(t, props, len(base["properties"].(map[string]any))+1)
	assert.Empty(t, domain.DesignatedDisplay(schemas.DefaultHumanUserSchema(testBase)), "customer projects keep the default untouched")
}
