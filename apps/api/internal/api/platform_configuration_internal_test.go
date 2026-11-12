package api

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// The reserved platform project holds who may use the platform, never an
// application's end users (Console ADR 0004 §1), so writing its configuration
// is for its admins: the gate asks the admin relation of every such write,
// where another project asks editor. These tests pin which resources that is,
// by the gate contract's table, so a resource the API gains has to be classed
// here before it ships.

// The resources a project deploys: what a release ships, a deployment serves
// or an origin admits. Named by their denial, as the contract's rows are.
var platformConfigurationDenied = []string{
	brandingCodes.denied,
	deploymentCodes.denied,
	flowDefCodes.denied,
	idpCodes.denied,
	originCodes.denied,
	policyCodes.denied,
	releaseCodes.denied,
	schemaCodes.denied,
	variableCodes.denied,
}

// The resources that say who may use the platform, what they hold, and its
// own record: written on the platform project as on any other.
var platformOwnDenied = []string{
	eventCodes.denied,
	grantCodes.denied,
	invitationCodes.denied,
	projectCodes.denied,
	sessionCodes.denied,
	teamCodes.denied,
	userCodes.denied,
}

// The configuration writes that ask editor on a project, and so ask admin on
// top of it on the reserved platform project. RemoveOrigin asks admin anywhere.
var platformAdminOnlyOperations = []string{
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

func TestEveryGatedResourceIsClassedForThePlatformProject(t *testing.T) {
	t.Parallel()
	for _, row := range gateRows {
		if row.denied == "" {
			// A list gate narrows instead of refusing; its resource has other rows.
			continue
		}
		configuration := slices.Contains(platformConfigurationDenied, row.denied)
		own := slices.Contains(platformOwnDenied, row.denied)
		assert.True(t, configuration != own,
			"%s: class its resource as configuration, which only an admin writes on the reserved platform project, or as the platform project's own (Console ADR 0004 §1)", rowName(row))
	}
}

// An editor of the reserved platform project is refused every configuration
// write, operation by operation, before any service is reached.
func TestPlatformProjectConfigurationWritesRefuseAnEditor(t *testing.T) {
	t.Parallel()
	ops := bundledOperations(t)
	var held []string

	for _, row := range gateRows {
		if row.relation == viewer || !slices.Contains(platformConfigurationDenied, row.denied) {
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

	configuration := []resourceAccess{
		brandingAccess, deploymentAccess, flowDefinitionAccess, idpAccess, originAccess,
		policyAccess, releaseAccess, schemaAccess, variableAccess,
	}
	own := []resourceAccess{
		eventsAccess, grantAccess, invitationAccess, projectAccess, sessionAccess, teamAccess, userAccess,
	}
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

	for _, res := range configuration {
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
	for _, res := range own {
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
