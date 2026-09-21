package domain_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/zitadel/nextgen/internal/domain"
)

// An environment name is a URL path segment and a CLI argument, so the
// validator is the only thing standing between a caller and a name that
// cannot be addressed once stored.
func TestValidateEnvironmentName(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name  string
		input string
		want  string
	}{
		{name: "simple", input: "prod", want: "prod"},
		{name: "digits", input: "eu1", want: "eu1"},
		{name: "inner hyphen", input: "pr-1", want: "pr-1"},
		{name: "surrounding whitespace is trimmed", input: "  prod\n", want: "prod"},
		{name: "single character", input: "a", want: "a"},
		{name: "max length", input: strings.Repeat("a", 63), want: strings.Repeat("a", 63)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := domain.ValidateEnvironmentName(tc.input)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}

	for _, tc := range []struct {
		name  string
		input string
	}{
		{name: "empty", input: ""},
		{name: "whitespace only", input: "   "},
		{name: "uppercase", input: "Prod"},
		{name: "leading hyphen", input: "-prod"},
		{name: "trailing hyphen", input: "prod-"},
		{name: "only a hyphen", input: "-"},
		{name: "inner space", input: "pro d"},
		{name: "slash would escape the path segment", input: "prod/x"},
		{name: "dot", input: "prod.eu"},
		{name: "underscore", input: "pre_prod"},
		{name: "non-ascii", input: "prodé"},
		{name: "too long", input: strings.Repeat("a", 64)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := domain.ValidateEnvironmentName(tc.input)
			assert.ErrorIs(t, err, domain.ErrEnvironmentNameInvalid())
		})
	}
}

// Every seeded default must survive the validator: a typo in the constant
// would otherwise only surface as a failed project creation at runtime.
func TestDefaultEnvironmentNamesAreValid(t *testing.T) {
	t.Parallel()

	require.NotEmpty(t, domain.DefaultEnvironmentNames)
	seen := make(map[string]bool, len(domain.DefaultEnvironmentNames))
	for _, name := range domain.DefaultEnvironmentNames {
		got, err := domain.ValidateEnvironmentName(name)
		require.NoErrorf(t, err, "default environment name %q is invalid", name)
		assert.Equal(t, name, got, "default environment name %q is not already normalised", name)
		assert.Falsef(t, seen[name], "duplicate default environment name %q", name)
		seen[name] = true
	}
}

// The generated decoder enforces the OpenAPI schema before a request reaches
// the domain, so the two must agree on what a valid name is. Reading the file
// is the only way to know they still do: a pattern edited on one side and not
// the other would otherwise pass every other test in the repo while the API
// accepted names the domain rejects (or the reverse).
func TestEnvironmentNameMatchesOpenAPISchema(t *testing.T) {
	t.Parallel()

	_, filename, _, ok := runtime.Caller(0)
	require.True(t, ok)
	root := filepath.Clean(filepath.Join(filepath.Dir(filename), "../.."))
	schemaPath := filepath.Join(root, "api/openapi/components/schemas/environment-name.yaml")

	raw, err := os.ReadFile(schemaPath)
	require.NoError(t, err, "the domain mirrors this schema; it must exist")

	var schema struct {
		Pattern   string `yaml:"pattern"`
		MaxLength int    `yaml:"maxLength"`
	}
	require.NoError(t, yaml.Unmarshal(raw, &schema))

	assert.Equal(t, schema.Pattern, domain.EnvironmentNamePattern,
		"EnvironmentNamePattern drifted from %s", schemaPath)
	assert.Equal(t, schema.MaxLength, domain.EnvironmentNameMaxLength,
		"EnvironmentNameMaxLength drifted from %s", schemaPath)
}

func TestNewEnvironment(t *testing.T) {
	t.Parallel()

	t.Run("leaves the id for the dialect to mint", func(t *testing.T) {
		env, err := domain.NewEnvironment("proj_1", "prod")
		require.NoError(t, err)
		assert.Empty(t, env.ID, "the id is minted on insert (ADR 047), not in the domain")
		assert.Equal(t, "proj_1", env.ProjectID)
		assert.Equal(t, "prod", env.Name)
	})

	t.Run("rejects an invalid name", func(t *testing.T) {
		_, err := domain.NewEnvironment("proj_1", "Prod")
		assert.ErrorIs(t, err, domain.ErrEnvironmentNameInvalid())
	})
}
