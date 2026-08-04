package profile_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/authz"
	"github.com/zitadel/nextgen/internal/authz/openfga"
	"github.com/zitadel/nextgen/internal/authz/profile"
)

func TestValidateAcceptsSupportedProfile(t *testing.T) {
	t.Parallel()

	model := parse(t, `model
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

	require.NoError(t, profile.Validate(model))
}

func TestValidateRejectsUnsupportedConstructs(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		model string
		want  profile.Diagnostic
	}{
		{
			name: "intersection",
			model: `model
  schema 1.1

type user

type project
  relations
    define viewer: [user]
    define editor: [user]
    define approver: viewer and editor
`,
			want: profile.Diagnostic{
				Code:     profile.CodeUnsupportedOperator,
				Type:     "project",
				Relation: "approver",
				Message:  `operator "and" is not supported, the profile starts with union only`,
			},
		},
		{
			name: "difference",
			model: `model
  schema 1.1

type user

type project
  relations
    define viewer: [user]
    define banned: [user]
    define active_viewer: viewer but not banned
`,
			want: profile.Diagnostic{
				Code:     profile.CodeUnsupportedOperator,
				Type:     "project",
				Relation: "active_viewer",
				Message:  `operator "but not" is not supported, the profile starts with union only`,
			},
		},
		{
			name: "wildcard",
			model: `model
  schema 1.1

type user

type project
  relations
    define viewer: [user:*]
`,
			want: profile.Diagnostic{
				Code:     profile.CodeUnsupportedWildcard,
				Type:     "project",
				Relation: "viewer",
				Message:  `wildcard restriction "user:*" cannot be planned for list endpoints`,
			},
		},
		{
			name: "condition",
			model: `model
  schema 1.1

type user

type project
  relations
    define viewer: [user with non_expired]

condition non_expired(current_time: timestamp, expires_at: timestamp) {
  current_time < expires_at
}
`,
			want: profile.Diagnostic{
				Code:      profile.CodeUnsupportedCondition,
				Condition: "non_expired",
				Message:   "conditions are not supported",
			},
		},
		{
			name: "recursion",
			model: `model
  schema 1.1

type user

type team
  relations
    define member: [user, team#member]
`,
			want: profile.Diagnostic{
				Code:     profile.CodeUnboundedRecursion,
				Type:     "team",
				Relation: "member",
				Message:  "relation resolves to itself, which cannot be expanded within a bounded closure",
			},
		},
		{
			name: "tuple to userset outside the hierarchy",
			model: `model
  schema 1.1

type user

type folder
  relations
    define viewer: [user]

type document
  relations
    define parent: [folder]
    define viewer: viewer from parent
`,
			want: profile.Diagnostic{
				Code:     profile.CodeUnboundedTupleToUserset,
				Type:     "document",
				Relation: "viewer",
				Message:  `type "folder" is not a known hierarchy edge: "app", "app_group", "project", "team", "user"`,
			},
		},
		{
			name: "tuple to userset through a computed tupleset",
			model: `model
  schema 1.1

type user

type team
  relations
    define member: [user]

type project
  relations
    define team: [team]
    define owning_team: team
    define viewer: member from owning_team
`,
			want: profile.Diagnostic{
				Code:     profile.CodeUnboundedTupleToUserset,
				Type:     "project",
				Relation: "viewer",
				Message:  `tupleset relation "owning_team" must be a direct assignment`,
			},
		},
		{
			name: "undefined tupleset relation",
			model: `model
  schema 1.1

type user

type team
  relations
    define member: [user]

type project
  relations
    define viewer: member from team
`,
			want: profile.Diagnostic{
				Code:     profile.CodeRelationNotFound,
				Type:     "project",
				Relation: "viewer",
				Message:  `tupleset references undefined relation "team"`,
			},
		},
		{
			name: "tupleset must restrict to plain types",
			model: `model
  schema 1.1

type user

type team
  relations
    define member: [user]
    define viewer: [user]

type project
  relations
    define parent: [team#member]
    define viewer: viewer from parent
`,
			want: profile.Diagnostic{
				Code:     profile.CodeUnboundedTupleToUserset,
				Type:     "project",
				Relation: "viewer",
				Message:  `tupleset relation "parent" must restrict to plain types`,
			},
		},
		{
			name: "computed relation missing on tupleset target type",
			model: `model
  schema 1.1

type user

type team
  relations
    define member: [user]

type project
  relations
    define team: [team]
    define viewer: viewer from team
`,
			want: profile.Diagnostic{
				Code:     profile.CodeRelationNotFound,
				Type:     "project",
				Relation: "viewer",
				Message:  `type "team" does not define relation "viewer"`,
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			err := profile.Validate(parse(t, test.model))
			require.Error(t, err)

			var diagnostics profile.Diagnostics
			require.ErrorAs(t, err, &diagnostics)
			assert.Contains(t, diagnostics, test.want)
			assert.ErrorIs(t, err, test.want)
		})
	}
}

func TestValidateRejectsUnsupportedSchemaVersion(t *testing.T) {
	t.Parallel()

	model := parse(t, `model
  schema 1.1

type user
`)
	model.SchemaVersion = "1.2"

	err := profile.Validate(model)
	require.Error(t, err)
	assert.ErrorIs(t, err, profile.Diagnostic{
		Code:    profile.CodeUnsupportedSchemaVersion,
		Message: `schema version "1.2" is not supported, expected "1.1"`,
	})
}

func TestValidateReportsEveryViolation(t *testing.T) {
	t.Parallel()

	err := profile.Validate(parse(t, `model
  schema 1.1

type user

type project
  relations
    define viewer: [user:*]
    define editor: [user]
    define banned: [user]
    define active_editor: editor but not banned
`))

	var diagnostics profile.Diagnostics
	require.ErrorAs(t, err, &diagnostics)
	assert.Len(t, diagnostics, 2)
	assert.Equal(t, []profile.Code{profile.CodeUnsupportedOperator, profile.CodeUnsupportedWildcard}, codes(diagnostics))
}

func TestValidateRejectsEmptyUnion(t *testing.T) {
	t.Parallel()

	model, err := openfga.ParseJSON(`{
  "schema_version": "1.1",
  "type_definitions": [
    {"type": "user"},
    {
      "type": "document",
      "relations": {
        "viewer": {"union": {"child": []}}
      }
    }
  ]
}`)
	require.NoError(t, err)

	err = profile.Validate(model)
	require.Error(t, err)
	assert.ErrorIs(t, err, profile.Diagnostic{
		Code:     profile.CodeEmptyRelationDefinition,
		Type:     "document",
		Relation: "viewer",
		Message:  "union has no children",
	})
}

func TestValidateRejectsMissingTypeRestriction(t *testing.T) {
	t.Parallel()

	// Reachable only via crafted JSON / IR: the DSL cannot write a direct
	// relation without a bracket list.
	err := profile.Validate(authz.Model{
		SchemaVersion: profile.SupportedSchemaVersion,
		Types: []authz.Type{
			{Name: "user"},
			{
				Name: "document",
				Relations: []authz.Relation{{
					Name:    "viewer",
					Rewrite: authz.Rewrite{Kind: authz.RewriteDirect},
				}},
			},
		},
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, profile.Diagnostic{
		Code:     profile.CodeMissingTypeRestriction,
		Type:     "document",
		Relation: "viewer",
		Message:  "direct assignment declares no type restrictions",
	})
}

func TestValidateRejectsDanglingReferences(t *testing.T) {
	t.Parallel()

	err := profile.Validate(parse(t, `model
  schema 1.1

type user

type project
  relations
    define team: [team]
    define viewer: editor
`))

	var diagnostics profile.Diagnostics
	require.ErrorAs(t, err, &diagnostics)
	assert.Contains(t, diagnostics, profile.Diagnostic{
		Code:     profile.CodeTypeNotFound,
		Type:     "project",
		Relation: "team",
		Message:  `restriction references undefined type "team"`,
	})
	assert.Contains(t, diagnostics, profile.Diagnostic{
		Code:     profile.CodeRelationNotFound,
		Type:     "project",
		Relation: "viewer",
		Message:  `implies undefined relation "editor"`,
	})
}

func TestValidatorHierarchyTypesAreConfigurable(t *testing.T) {
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

	require.Error(t, profile.Validate(model))

	validator := profile.Validator{HierarchyTypes: []string{"folder", "user"}}
	require.NoError(t, validator.Validate(model))

	denyAll := profile.Validator{HierarchyTypes: []string{}}
	err := denyAll.Validate(model)
	require.Error(t, err)
	assert.ErrorIs(t, err, profile.Diagnostic{
		Code:     profile.CodeUnboundedTupleToUserset,
		Type:     "document",
		Relation: "viewer",
		Message:  `type "folder" is not a known hierarchy edge: (none)`,
	})
}

func TestDiagnosticsUnwrapExposesEachDiagnostic(t *testing.T) {
	t.Parallel()

	err := profile.Validate(parse(t, `model
  schema 1.1

type user

type project
  relations
    define viewer: [user:*]
`))
	require.Error(t, err)

	unwrapped, ok := err.(interface{ Unwrap() []error })
	require.True(t, ok)
	require.Len(t, unwrapped.Unwrap(), 1)
	assert.True(t, errors.Is(err, unwrapped.Unwrap()[0]))
}

func parse(t *testing.T, dsl string) authz.Model {
	t.Helper()

	model, err := openfga.ParseDSL(dsl)
	require.NoError(t, err)
	return model
}

func codes(diagnostics profile.Diagnostics) []profile.Code {
	result := make([]profile.Code, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		result = append(result, diagnostic.Code)
	}
	return result
}
