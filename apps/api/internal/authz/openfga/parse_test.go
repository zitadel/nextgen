package openfga_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/authz"
	"github.com/zitadel/nextgen/internal/authz/openfga"
)

func TestParseDSL(t *testing.T) {
	t.Parallel()

	model, err := openfga.ParseDSL(`model
  schema 1.1

type user

type team
  relations
    define member: [user]

type project
  relations
    define team: [team]
    define viewer: [user, team#member] or member from team
    define editor: viewer
`)
	require.NoError(t, err)

	assert.Equal(t, "1.1", model.SchemaVersion)
	require.Len(t, model.Types, 3)
	assert.Equal(t, []string{"project", "team", "user"}, typeNames(model.Types))

	project := model.Types[0]
	require.Len(t, project.Relations, 3)
	assert.Equal(t, []string{"editor", "team", "viewer"}, relationNames(project.Relations))

	assert.Equal(t, authz.Rewrite{
		Kind:     authz.RewriteComputedUserset,
		Relation: "viewer",
	}, project.Relations[0].Rewrite)
	assert.Equal(t, authz.RewriteDirect, project.Relations[1].Rewrite.Kind)
	assert.Equal(t, []authz.RelationReference{{Type: "team"}}, project.Relations[1].DirectlyRelatedTypes)
	assert.Equal(t, authz.Rewrite{
		Kind: authz.RewriteUnion,
		Children: []authz.Rewrite{
			{Kind: authz.RewriteDirect},
			{Kind: authz.RewriteTupleToUserset, Relation: "member", Tupleset: "team"},
		},
	}, project.Relations[2].Rewrite)
	assert.Equal(t, []authz.RelationReference{
		{Type: "team", Relation: "member"},
		{Type: "user"},
	}, project.Relations[2].DirectlyRelatedTypes)
}

func TestParseJSON(t *testing.T) {
	t.Parallel()

	model, err := openfga.ParseJSON(`{
  "schema_version": "1.1",
  "type_definitions": [
    {"type": "user"},
    {
      "type": "document",
      "relations": {"viewer": {"this": {}}},
      "metadata": {
        "relations": {
          "viewer": {
            "directly_related_user_types": [{"type": "user"}]
          }
        }
      }
    }
  ]
}`)
	require.NoError(t, err)

	assert.Equal(t, "1.1", model.SchemaVersion)
	assert.Equal(t, []string{"document", "user"}, typeNames(model.Types))
	require.Len(t, model.Types[0].Relations, 1)
	assert.Equal(t, authz.RewriteDirect, model.Types[0].Relations[0].Rewrite.Kind)
	assert.Equal(t, []authz.RelationReference{{Type: "user"}}, model.Types[0].Relations[0].DirectlyRelatedTypes)
}

func TestParseDSLPreservesConditionsForProfileValidation(t *testing.T) {
	t.Parallel()

	model, err := openfga.ParseDSL(`model
  schema 1.1

type user

type document
  relations
    define viewer: [user with non_expired]

condition non_expired(current_time: timestamp, expires_at: timestamp) {
  current_time < expires_at
}
`)
	require.NoError(t, err)

	require.Len(t, model.Conditions, 1)
	assert.Equal(t, authz.Condition{
		Name:       "non_expired",
		Expression: "current_time < expires_at",
		Parameters: []authz.ConditionParameter{
			{Name: "current_time", Type: authz.ConditionParameterType{Name: "timestamp"}},
			{Name: "expires_at", Type: authz.ConditionParameterType{Name: "timestamp"}},
		},
	}, model.Conditions[0])

	document := model.Types[0]
	require.Len(t, document.Relations, 1)
	assert.Equal(t, "non_expired", document.Relations[0].DirectlyRelatedTypes[0].Condition)
}

func TestParseDSLReturnsSyntaxErrors(t *testing.T) {
	t.Parallel()

	_, err := openfga.ParseDSL("not a model")
	require.Error(t, err)
	assert.ErrorContains(t, err, "parse OpenFGA DSL")
	assert.ErrorContains(t, err, "syntax error")
}

func TestParseJSONReturnsSyntaxErrors(t *testing.T) {
	t.Parallel()

	_, err := openfga.ParseJSON("{")
	require.Error(t, err)
	assert.ErrorContains(t, err, "parse OpenFGA JSON")
}

func typeNames(types []authz.Type) []string {
	names := make([]string, 0, len(types))
	for _, typ := range types {
		names = append(names, typ.Name)
	}
	return names
}

func relationNames(relations []authz.Relation) []string {
	names := make([]string, 0, len(relations))
	for _, relation := range relations {
		names = append(names, relation.Name)
	}
	return names
}
