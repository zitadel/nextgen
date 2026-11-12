package api

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// The reserved platform project holds who may use the platform, never an
// application's end users (Console ADR 0004 §1), so its configuration is the
// server's: the gate refuses every write of it, whatever the caller holds
// there. These tests pin which resources that is, by the gate contract's
// table, so a resource the API gains has to be classed here before it ships.

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

// The resources the platform project holds as any project does: who may use
// the platform, what they hold, and its own record.
var platformOwnDenied = []string{
	eventCodes.denied,
	grantCodes.denied,
	invitationCodes.denied,
	projectCodes.denied,
	sessionCodes.denied,
	teamCodes.denied,
	userCodes.denied,
}

// The operations the reserved platform project refuses: every write of a
// configuration resource.
var platformRefusedOperations = []string{
	"CreateBranding",
	"CreateDeployment", "RollbackDeployment", "RemovePreview",
	"CreateFlowDefinition",
	"CreateIdp",
	"PublishPolicy",
	"AddOrigin", "RemoveOrigin",
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
			"%s: class its resource as configuration, which the reserved platform project refuses to have written, or as the platform project's own (Console ADR 0004 §1)", rowName(row))
	}
}

func TestPlatformProjectRefusesConfigurationWrites(t *testing.T) {
	t.Parallel()
	ops := bundledOperations(t)
	var refused []string

	for _, row := range gateRows {
		if row.relation == viewer || !slices.Contains(platformConfigurationDenied, row.denied) {
			continue
		}
		refused = append(refused, row.op)
		spec, ok := ops[row.op]
		require.True(t, ok, "row %s names no operation in the spec", row.op)
		for _, p := range gatePrincipals {
			if !spec.schemes[p.scheme] {
				continue
			}
			t.Run(rowName(row)+"/"+p.name, func(t *testing.T) {
				t.Parallel()
				// The caller's own access is checked first, and allowed.
				f := newGateFixture(t, false, true)
				f.handler.platformProjectID = domain.PlatformProjectID
				call := gateCall{project: domain.PlatformProjectID, id: contractPathID}

				err := callOperation(t, f.handler, row.op, buildArgs(t, row, call), p.scope, nil)

				assertDomainCode(t, err, row.denied)
				assert.Contains(t, err.Error(), "platform project", "the refusal says why")
				assert.Len(t, f.stmts.recordedChecks(), 1, "the gate asks the caller's access before it refuses")
				f.assertNoFakeReached(t)
			})
		}
	}

	assert.ElementsMatch(t, platformRefusedOperations, refused)
}

func TestRefusePlatformConfiguration(t *testing.T) {
	t.Parallel()
	const customer = "proj_customer"
	reserved := &Handler{platformProjectID: domain.PlatformProjectID}

	configuration := []resourceAccess{
		brandingAccess, deploymentAccess, flowDefinitionAccess, idpAccess, originAccess,
		policyAccess, releaseAccess, schemaAccess, variableAccess,
	}
	own := []resourceAccess{
		eventsAccess, grantAccess, invitationAccess, projectAccess, sessionAccess, teamAccess, userAccess,
	}

	for _, res := range configuration {
		denied := res.denied().Code
		t.Run(denied, func(t *testing.T) {
			t.Parallel()
			assertDomainCode(t, reserved.refusePlatformConfiguration(domain.PlatformProjectID, res, opWrite), denied)
			assertDomainCode(t, reserved.refusePlatformConfiguration(domain.PlatformProjectID, res, opDelete), denied)
			// Reading it stays: the console draws the platform project's sign-in from it.
			assert.NoError(t, reserved.refusePlatformConfiguration(domain.PlatformProjectID, res, opRead))
			// Every other project keeps its configuration.
			assert.NoError(t, reserved.refusePlatformConfiguration(customer, res, opWrite))
		})
	}
	for _, res := range own {
		t.Run(res.denied().Code, func(t *testing.T) {
			t.Parallel()
			assert.NoError(t, reserved.refusePlatformConfiguration(domain.PlatformProjectID, res, opWrite))
			assert.NoError(t, reserved.refusePlatformConfiguration(domain.PlatformProjectID, res, opDelete))
		})
	}

	t.Run("a pinned ordinary project is not reserved", func(t *testing.T) {
		t.Parallel()
		// platform.project_id names an ordinary project, a self-hoster's only
		// one: it keeps its origins, deployments and the rest.
		pinned := &Handler{platformProjectID: customer}
		assert.NoError(t, pinned.refusePlatformConfiguration(customer, originAccess, opWrite))
		assert.NoError(t, pinned.refusePlatformConfiguration(customer, deploymentAccess, opWrite))
	})

	t.Run("a deployment without a platform project refuses nothing", func(t *testing.T) {
		t.Parallel()
		none := &Handler{}
		assert.NoError(t, none.refusePlatformConfiguration(domain.PlatformProjectID, originAccess, opWrite))
	})
}
