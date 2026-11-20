package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

func TestErrorSchemaYAML(t *testing.T) {
	t.Parallel()

	var schema struct {
		AllOf []struct {
			Properties map[string]struct {
				Const       string `yaml:"const"`
				Description string `yaml:"description"`
			} `yaml:"properties"`
		} `yaml:"allOf"`
	}

	rendered := errorSchemaYAML(errorInfo{code: "tkn.invalid", description: "The token is not valid"})
	require.NoError(t, yaml.Unmarshal([]byte(rendered), &schema))
	require.Len(t, schema.AllOf, 2)

	code := schema.AllOf[1].Properties["code"]
	assert.Equal(t, "tkn.invalid", code.Const)
	assert.Equal(t, "The error code, always `tkn.invalid` for this error.", code.Description)
}

func TestSchemaFileName(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "att-invalid-proof.yaml", schemaFileName("att.invalid_proof"))
	assert.Equal(t, "not-implemented.yaml", schemaFileName("not_implemented"))
	assert.Equal(t, "internal.yaml", schemaFileName("internal"))
}
