package api

import (
	"go/ast"
	"go/parser"
	"go/token"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// The reserved platform project holds who may use the platform, never an
// application's end users (Console ADR 0004 §1), so writing its configuration
// is for its admins: the gate asks the admin relation of every such write,
// where another project asks editor. These tests pin which resources that is,
// from the gate's own declarations, so a resource the API gains has to be
// classed here before it ships.

// The resources a project deploys or registers: what a release ships, a
// deployment serves, an origin admits, and the applications whose clients sign
// in to it. Keyed by the variable each is declared as.
var platformConfigurationAccess = map[string]resourceAccess{
	"applicationAccess":    applicationAccess,
	"brandingAccess":       brandingAccess,
	"deploymentAccess":     deploymentAccess,
	"flowDefinitionAccess": flowDefinitionAccess,
	"idpAccess":            idpAccess,
	"originAccess":         originAccess,
	"policyAccess":         policyAccess,
	"releaseAccess":        releaseAccess,
	"schemaAccess":         schemaAccess,
	"variableAccess":       variableAccess,
}

// The resources that say who may use the platform, what they hold, and its
// own record: written on the platform project as on any other.
var platformOwnAccess = map[string]resourceAccess{
	"eventsAccess":     eventsAccess,
	"grantAccess":      grantAccess,
	"invitationAccess": invitationAccess,
	"projectAccess":    projectAccess,
	"sessionAccess":    sessionAccess,
	"teamAccess":       teamAccess,
	"userAccess":       userAccess,
}

// deniedCodes names resources by their denial, as the contract's rows do.
func deniedCodes(resources map[string]resourceAccess) []string {
	var codes []string
	for _, res := range resources {
		codes = append(codes, res.denied().Code)
	}
	return codes
}

// CreateApplication is gated, and the contract's table has no row for it: it
// still lists the operation as not implemented. This row holds it to the
// platform project's admins until the table has one.
var platformUnlistedWrites = []gateRow{
	{op: "CreateApplication", relation: editor, target: onProject, denied: domain.ErrApplicationPermissionDenied().Code},
}

// The configuration writes that ask editor on a project, and so ask admin on
// top of it on the reserved platform project. RemoveOrigin asks admin anywhere.
var platformAdminOnlyOperations = []string{
	"CreateApplication",
	"CreateBranding",
	"CreateDeployment", "RollbackDeployment", "RemovePreview",
	"CreateFlowDefinition",
	"CreateIdp",
	"PublishPolicy",
	"AddOrigin",
	"CreateRelease", "BuildRelease", "RevokeRelease",
	"CreateSchema",
	"UpdateVariables", "DeleteVariable",
}

// declaredResourceAccess reads the package for every resourceAccess it
// declares, and whether each sets `configuration`.
func declaredResourceAccess(t *testing.T) map[string]bool {
	t.Helper()
	files, err := filepath.Glob("*.go")
	require.NoError(t, err)
	fset := token.NewFileSet()
	declared := map[string]bool{}
	literals := 0
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, name, nil, parser.SkipObjectResolution)
		require.NoError(t, err)
		ast.Inspect(file, func(n ast.Node) bool {
			if lit, ok := n.(*ast.CompositeLit); ok && isResourceAccess(lit) {
				literals++
			}
			return true
		})
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.VAR {
				continue
			}
			for _, spec := range gen.Specs {
				value := spec.(*ast.ValueSpec)
				for i, v := range value.Values {
					if lit, ok := v.(*ast.CompositeLit); ok && isResourceAccess(lit) && i < len(value.Names) {
						declared[value.Names[i].Name] = setsConfiguration(lit)
					}
				}
			}
		}
	}
	require.Len(t, declared, literals, "a resourceAccess built outside a package variable cannot be classed")
	return declared
}

func isResourceAccess(lit *ast.CompositeLit) bool {
	typ, ok := lit.Type.(*ast.Ident)
	return ok && typ.Name == "resourceAccess"
}

func setsConfiguration(lit *ast.CompositeLit) bool {
	for _, elt := range lit.Elts {
		field, ok := elt.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		key, _ := field.Key.(*ast.Ident)
		value, _ := field.Value.(*ast.Ident)
		if key != nil && key.Name == "configuration" {
			return value != nil && value.Name == "true"
		}
	}
	return false
}

func TestEveryGatedResourceIsClassedForThePlatformProject(t *testing.T) {
	t.Parallel()
	const class = "class it as configuration, which only an admin writes on the reserved platform project, or as the platform project's own (Console ADR 0004 §1)"

	// The resources the gate declares, read from its source: one whose
	// operations have no row in the contract's table is classed as well.
	declared := declaredResourceAccess(t)
	require.NotEmpty(t, declared)
	for name, flagged := range declared {
		res, configuration := platformConfigurationAccess[name]
		own, isOwn := platformOwnAccess[name]
		if !assert.True(t, configuration != isOwn, "%s: %s", name, class) {
			continue
		}
		if isOwn {
			res = own
		}
		assert.Equal(t, configuration, flagged, "%s: its `configuration` says otherwise", name)
		assert.Equal(t, configuration, res.configuration, "%s is classed under another resource's name", name)
	}
	classed := slices.Concat(slices.Collect(maps.Keys(platformConfigurationAccess)), slices.Collect(maps.Keys(platformOwnAccess)))
	for _, name := range classed {
		assert.Contains(t, declared, name, "%s is classed and no longer declared", name)
	}

	// Each has a denial of its own, which is how a row of the contract names it.
	configurationDenied, ownDenied := deniedCodes(platformConfigurationAccess), deniedCodes(platformOwnAccess)
	denials := slices.Sorted(slices.Values(slices.Concat(configurationDenied, ownDenied)))
	assert.Len(t, slices.Compact(denials), len(classed), "two resources share a denial")

	for _, row := range gateRows {
		if row.denied == "" {
			// A list gate narrows instead of refusing; its resource has other rows.
			continue
		}
		configuration := slices.Contains(configurationDenied, row.denied)
		own := slices.Contains(ownDenied, row.denied)
		assert.True(t, configuration != own, "%s: its resource: %s", rowName(row), class)
	}
}

// An editor of the reserved platform project is refused every configuration
// write, operation by operation, before any service is reached.
func TestPlatformProjectConfigurationWritesRefuseAnEditor(t *testing.T) {
	t.Parallel()
	ops := bundledOperations(t)
	configurationDenied := deniedCodes(platformConfigurationAccess)
	var held []string

	for _, row := range slices.Concat(gateRows, platformUnlistedWrites) {
		if row.relation == viewer || !slices.Contains(configurationDenied, row.denied) {
			continue
		}
		if row.relation == admin {
			// Asks admin on every project already, so there is nothing to add.
			continue
		}
		held = append(held, row.op)
		spec, ok := ops[row.op]
		require.True(t, ok, "row %s names no operation in the spec", row.op)
		for _, p := range gatePrincipals {
			if !spec.schemes[p.scheme] {
				continue
			}
			t.Run(rowName(row)+"/"+p.name, func(t *testing.T) {
				t.Parallel()
				// The operation's own relation is allowed, the admin one is not.
				f := newGateFixture(t, true, true, false)
				f.handler.platformProjectID = domain.PlatformProjectID
				call := gateCall{project: domain.PlatformProjectID, id: contractPathID}

				err := callOperation(t, f.handler, row.op, buildArgs(t, row, call), p.scope, nil)

				assertDomainCode(t, err, row.denied)
				assert.Contains(t, err.Error(), "admin role", "the refusal says what is missing")
				checks := f.stmts.recordedChecks()
				require.Len(t, checks, 2, "the operation's own relation, then admin")
				assert.Equal(t, row.relation, checks[0].Relation)
				assert.Equal(t, admin, checks[1].Relation)
				assert.Equal(t, domain.PlatformProjectID, checks[1].ProjectID)
				f.assertNoFakeReached(t)
			})
		}
	}

	assert.ElementsMatch(t, platformAdminOnlyOperations, held)
}

func TestRequirePlatformConfigurationAdmin(t *testing.T) {
	t.Parallel()
	const customer = "proj_customer"
	ctx := WithScopeContext(t.Context(), sessionPrincipal.scope)

	// gate runs one access check on a handler whose platform project is
	// `platform`, answering the i-th Check with answers[i], and returns the
	// relations asked and the error.
	gate := func(t *testing.T, platform, project string, res resourceAccess, op accessOp, answers ...bool) ([]string, error) {
		t.Helper()
		f := newGateFixture(t, true, answers...)
		f.handler.platformProjectID = platform
		err := f.handler.requireProjectAccess(ctx, project, res, op)
		var asked []string
		for _, check := range f.stmts.recordedChecks() {
			asked = append(asked, check.Relation)
		}
		return asked, err
	}

	for _, res := range platformConfigurationAccess {
		denied := res.denied().Code
		t.Run(denied, func(t *testing.T) {
			t.Parallel()
			reserved := domain.PlatformProjectID

			asked, err := gate(t, reserved, reserved, res, opWrite, true, true)
			assert.NoError(t, err, "an admin of the platform project writes its configuration")
			assert.Equal(t, []string{editor, admin}, asked)

			asked, err = gate(t, reserved, reserved, res, opWrite, true, false)
			assertDomainCode(t, err, denied)
			assert.Equal(t, []string{editor, admin}, asked)

			asked, err = gate(t, reserved, reserved, res, opWrite, false)
			assertDomainCode(t, err, denied)
			assert.Equal(t, []string{editor}, asked, "someone the operation refuses is asked nothing more")

			// A removal asks admin anywhere, and a read asks nothing more.
			asked, err = gate(t, reserved, reserved, res, opDelete, true)
			assert.NoError(t, err)
			assert.Equal(t, []string{admin}, asked)
			asked, err = gate(t, reserved, reserved, res, opRead, true)
			assert.NoError(t, err)
			assert.Equal(t, []string{viewer}, asked)

			// Every other project keeps the relation the operation asks.
			asked, err = gate(t, reserved, customer, res, opWrite, true)
			assert.NoError(t, err)
			assert.Equal(t, []string{editor}, asked)
		})
	}
	for _, res := range platformOwnAccess {
		t.Run(res.denied().Code, func(t *testing.T) {
			t.Parallel()
			asked, err := gate(t, domain.PlatformProjectID, domain.PlatformProjectID, res, opWrite, true)
			assert.NoError(t, err)
			assert.Equal(t, []string{editor}, asked, "who may use the platform is written as on any project")
		})
	}

	t.Run("a pinned ordinary project is not reserved", func(t *testing.T) {
		t.Parallel()
		// platform.project_id names an ordinary project, a self-hoster's only
		// one: an editor keeps writing its origins, deployments and the rest.
		asked, err := gate(t, customer, customer, originAccess, opWrite, true)
		assert.NoError(t, err)
		assert.Equal(t, []string{editor}, asked)
	})

	t.Run("a deployment without a platform project asks nothing more", func(t *testing.T) {
		t.Parallel()
		asked, err := gate(t, "", domain.PlatformProjectID, originAccess, opWrite, true)
		assert.NoError(t, err)
		assert.Equal(t, []string{editor}, asked)
	})
}
