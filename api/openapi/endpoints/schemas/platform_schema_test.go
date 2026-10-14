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

// The platform schema is seeded into a project at startup, so a document the
// server would refuse would stop the platform bootstrap. It has to pass the
// same meta-schema and designation checks any uploaded schema does — `x-display`
// naming a property that does not exist is exactly the kind of mistake those
// catch.
func TestPlatformHumanUserSchemaIsValid(t *testing.T) {
	validator, err := domain.NewSchemaValidator(testBase)
	require.NoError(t, err)

	doc, err := schemas.PlatformHumanUserSchema(testBase)
	require.NoError(t, err)
	require.NoError(t, validator.ValidateAgainstMetaSchema(doc))
}

// It is the default plus an optional name, nothing else: the same `$id` the
// admin seed documents point at, and email still the only required attribute.
func TestPlatformHumanUserSchemaExtendsTheDefault(t *testing.T) {
	var platform, base map[string]any
	doc, err := schemas.PlatformHumanUserSchema(testBase)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(doc, &platform))
	require.NoError(t, json.Unmarshal(schemas.DefaultHumanUserSchema(testBase), &base))

	assert.Equal(t, base["$id"], platform["$id"])
	assert.Equal(t, base["required"], platform["required"])
	assert.Equal(t, []any{schemas.PlatformDisplayNameProperty}, platform["x-display"])

	props := platform["properties"].(map[string]any)
	assert.Contains(t, props, "email")
	assert.Contains(t, props, schemas.PlatformDisplayNameProperty)
	assert.Len(t, props, len(base["properties"].(map[string]any))+1)
	assert.NotContains(t, base, "x-display", "customer projects keep the default untouched")
}
