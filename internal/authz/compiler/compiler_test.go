package compiler_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/authz"
	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/authz/openfga"
	"github.com/zitadel/nextgen/internal/authz/profile"
)

func TestCompileProducesCatalogMutationsAndPlans(t *testing.T) {
	t.Parallel()

	output, err := compiler.Compile(parse(t, `model
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
    define admin: [user] or editor
`))
	require.NoError(t, err)

	assert.Equal(t, "1.1", output.Catalog.SchemaVersion)
	assert.Equal(t, []compiler.TypeDefinition{
		{Name: "project"},
		{Name: "team"},
		{Name: "user"},
	}, output.Catalog.Types)
	assert.Equal(t, []compiler.RelationDefinition{
		{Relation: relation("project", "admin")},
		{Relation: relation("project", "editor")},
		{Relation: relation("project", "team")},
		{Relation: relation("project", "viewer")},
		{Relation: relation("team", "member")},
	}, output.Catalog.Relations)

	assert.Equal(t, []compiler.RelationReference{
		{
			Relation:  relation("project", "admin"),
			Reference: authz.RelationReference{Type: "user"},
			Position:  0,
		},
		{
			Relation:  relation("project", "team"),
			Reference: authz.RelationReference{Type: "team"},
			Position:  0,
		},
		{
			Relation:  relation("project", "viewer"),
			Reference: authz.RelationReference{Type: "team", Relation: "member"},
			Position:  0,
		},
		{
			Relation:  relation("project", "viewer"),
			Reference: authz.RelationReference{Type: "user"},
			Position:  1,
		},
		{
			Relation:  relation("team", "member"),
			Reference: authz.RelationReference{Type: "user"},
			Position:  0,
		},
	}, output.Catalog.RelationReferences)

	assert.Equal(t, []compiler.ExpressionEdge{
		{
			Target:   relation("project", "admin"),
			Kind:     compiler.TermDirect,
			Position: 0,
		},
		{
			Target:   relation("project", "admin"),
			Kind:     compiler.TermComputedUserset,
			Source:   relation("project", "editor"),
			Position: 1,
		},
		{
			Target:   relation("project", "editor"),
			Kind:     compiler.TermComputedUserset,
			Source:   relation("project", "viewer"),
			Position: 0,
		},
		{
			Target:   relation("project", "team"),
			Kind:     compiler.TermDirect,
			Position: 0,
		},
		{
			Target:   relation("project", "viewer"),
			Kind:     compiler.TermDirect,
			Position: 0,
		},
		{
			Target:   relation("project", "viewer"),
			Kind:     compiler.TermTupleToUserset,
			Source:   relation("team", "member"),
			Tupleset: relation("project", "team"),
			Position: 1,
		},
		{
			Target:   relation("team", "member"),
			Kind:     compiler.TermDirect,
			Position: 0,
		},
	}, output.Catalog.ExpressionEdges)

	assert.Equal(t, []compiler.QueryTerm{
		{
			Kind: compiler.TermDirect,
			DirectReferences: []authz.RelationReference{
				{Type: "team", Relation: "member"},
				{Type: "user"},
			},
		},
		{
			Kind:     compiler.TermTupleToUserset,
			Source:   relation("team", "member"),
			Tupleset: relation("project", "team"),
		},
	}, plan(t, output, relation("project", "viewer")).Terms)
}

func TestCompileComputesShortestReflexiveTransitiveClosure(t *testing.T) {
	t.Parallel()

	output, err := compiler.Compile(parse(t, `model
  schema 1.1

type user

type project
  relations
    define viewer: [user]
    define editor: viewer
    define admin: [user] or viewer or editor
`))
	require.NoError(t, err)

	assert.Equal(t, []compiler.Implication{
		{Source: relation("project", "admin"), Implied: relation("project", "admin"), Depth: 0},
		{Source: relation("project", "editor"), Implied: relation("project", "admin"), Depth: 1},
		{Source: relation("project", "editor"), Implied: relation("project", "editor"), Depth: 0},
		{Source: relation("project", "viewer"), Implied: relation("project", "admin"), Depth: 1},
		{Source: relation("project", "viewer"), Implied: relation("project", "editor"), Depth: 1},
		{Source: relation("project", "viewer"), Implied: relation("project", "viewer"), Depth: 0},
	}, output.Catalog.Closure)
}

func TestCompileDoesNotTreatObjectBoundTraversalAsGlobalImplication(t *testing.T) {
	t.Parallel()

	output, err := compiler.Compile(parse(t, `model
  schema 1.1

type user

type team
  relations
    define member: [user]

type project
  relations
    define team: [team]
    define viewer: member from team
`))
	require.NoError(t, err)

	assert.NotContains(t, output.Catalog.Closure, compiler.Implication{
		Source:  relation("team", "member"),
		Implied: relation("project", "viewer"),
		Depth:   1,
	})
	assert.Contains(t, plan(t, output, relation("project", "viewer")).Terms, compiler.QueryTerm{
		Kind:     compiler.TermTupleToUserset,
		Source:   relation("team", "member"),
		Tupleset: relation("project", "team"),
	})
}

func TestCompileReturnsProfileDiagnosticsWithoutPartialOutput(t *testing.T) {
	t.Parallel()

	output, err := compiler.Compile(parse(t, `model
  schema 1.1

type user

type project
  relations
    define viewer: [user:*]
`))
	require.Error(t, err)
	assert.Empty(t, output)

	var diagnostics profile.Diagnostics
	require.ErrorAs(t, err, &diagnostics)
	assert.Contains(t, diagnostics, profile.Diagnostic{
		Code:     profile.CodeUnsupportedWildcard,
		Type:     "project",
		Relation: "viewer",
		Message:  `wildcard restriction "user:*" cannot be planned for list endpoints`,
	})
}

func TestCompileDedupesIdenticalUnionTerms(t *testing.T) {
	t.Parallel()

	model, err := openfga.ParseJSON(`{
  "schema_version": "1.1",
  "type_definitions": [
    {"type": "user"},
    {
      "type": "document",
      "relations": {
        "viewer": {
          "union": {
            "child": [{"this": {}}, {"this": {}}]
          }
        }
      },
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

	output, err := compiler.Compile(model)
	require.NoError(t, err)

	assert.Equal(t, []compiler.QueryTerm{{
		Kind:             compiler.TermDirect,
		DirectReferences: []authz.RelationReference{{Type: "user"}},
	}}, plan(t, output, relation("document", "viewer")).Terms)
	assert.Len(t, output.Catalog.ExpressionEdges, 1)
}

func TestCompilerUsesConfiguredHierarchyTypes(t *testing.T) {
	t.Parallel()

	model := parse(t, `model
  schema 1.1

type user

type folder
  relations
    define viewer: [user]

type document
  relations
    define parent: [folder]
    define viewer: viewer from parent
`)

	_, err := compiler.Compile(model)
	require.Error(t, err)

	configured := compiler.Compiler{
		Validator: profile.Validator{HierarchyTypes: []string{"folder"}},
	}
	output, err := configured.Compile(model)
	require.NoError(t, err)
	assert.Contains(t, plan(t, output, relation("document", "viewer")).Terms, compiler.QueryTerm{
		Kind:     compiler.TermTupleToUserset,
		Source:   relation("folder", "viewer"),
		Tupleset: relation("document", "parent"),
	})
}

func parse(t *testing.T, dsl string) authz.Model {
	t.Helper()

	model, err := openfga.ParseDSL(dsl)
	require.NoError(t, err)
	return model
}

func relation(objectType, name string) compiler.Relation {
	return compiler.Relation{Type: objectType, Name: name}
}

func plan(t *testing.T, output compiler.Output, target compiler.Relation) compiler.QueryPlan {
	t.Helper()

	for _, plan := range output.Plans {
		if plan.Target == target {
			return plan
		}
	}
	require.FailNow(t, "query plan not found", "target: %#v", target)
	return compiler.QueryPlan{}
}
