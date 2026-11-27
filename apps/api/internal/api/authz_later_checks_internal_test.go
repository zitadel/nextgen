package api

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// The checks a handler asks after its gate allowed. TestGateContract refuses
// every first Check, so it never reaches these. Nothing finds a handler that
// gains such a check: a new one needs a row here by hand.

// gateAnswer is how the gate's Check answers before a later check.
type gateAnswer int

const (
	// projectWide: the Check allows on the whole project.
	projectWide gateAnswer = iota
	// partialList: a foothold without the grant; a list narrows to it.
	partialList
)

// laterCheckRow is one later check, for one principal and one answer of the gate.
type laterCheckRow struct {
	op, variant string
	principal   gatePrincipal
	gate        gateAnswer
	// expand sets what makes the handler ask the later check.
	expand func(*testing.T, opArgs)
	// second pins that the later check asks the resolver again: read on the
	// whole project of the gate's target. secondAllows is its answer.
	second, secondAllows bool
	// refused is the later check's answer, and mentions what its message must
	// name. Empty when the request passes it and reaches the service (reach).
	refused, mentions string
}

func expandUsers(expand ...api.UserExpand) func(*testing.T, opArgs) {
	return func(t *testing.T, a opArgs) { argOf[api.QueryUsersRequest](t, a).Expand = expand }
}

func filterUsersByTeam(t *testing.T, a opArgs) {
	argOf[api.QueryUsersRequest](t, a).Filter = []api.QueryUsersRequestFilterItem{{Field: api.UserFilterFieldTeamID}}
}

func expandReleases(t *testing.T, a opArgs) {
	argOf[api.ListDeploymentsParams](t, a).Expand = []api.DeploymentExpand{api.DeploymentExpandRelease}
}

func expandSchemasInUse(t *testing.T, a opArgs) {
	argOf[api.ListSchemasParams](t, a).Expand = []api.SchemaExpand{api.SchemaExpandInUse}
}

func askTeamMembership(t *testing.T, a opArgs) {
	argOf[api.GetUserParams](t, a).TeamID = api.NewOptTeamID("team_asked")
}

// A session mints no scopes: a project-wide gate stands in for them, and a
// partial one does not. A project secret's project.write stands in for every
// granular scope until #420.
var laterCheckRows = []laterCheckRow{
	{op: "QueryUsers", variant: "teams", principal: sessionPrincipal, gate: partialList, expand: expandUsers(api.UserExpandTeams), refused: userCodes.denied, mentions: "team_membership.read"},
	{op: "QueryUsers", variant: "team_id filter", principal: sessionPrincipal, gate: partialList, expand: filterUsersByTeam, refused: userCodes.denied, mentions: "team_membership.read"},
	{op: "QueryUsers", variant: "lifecycle owner team", principal: sessionPrincipal, gate: partialList, expand: expandUsers(api.UserExpandLifecycleOwnerTeam), refused: userCodes.denied, mentions: "team.read"},
	{op: "QueryUsers", variant: "teams and owner team", principal: sessionPrincipal, gate: projectWide, expand: expandUsers(api.UserExpandTeams, api.UserExpandLifecycleOwnerTeam)},
	{op: "QueryUsers", variant: "teams and owner team", principal: secretPrincipal, gate: projectWide, expand: expandUsers(api.UserExpandTeams, api.UserExpandLifecycleOwnerTeam)},
	{op: "QueryUsers", variant: "teams and owner team", principal: secretPrincipal, gate: partialList, expand: expandUsers(api.UserExpandTeams, api.UserExpandLifecycleOwnerTeam)},

	{op: "ListDeployments", variant: "release", principal: sessionPrincipal, gate: partialList, expand: expandReleases, refused: deploymentCodes.denied, mentions: "release.read"},
	{op: "ListDeployments", variant: "release", principal: sessionPrincipal, gate: projectWide, expand: expandReleases},
	{op: "ListDeployments", variant: "release", principal: secretPrincipal, gate: projectWide, expand: expandReleases},
	{op: "ListDeployments", variant: "release", principal: secretPrincipal, gate: partialList, expand: expandReleases},

	// in_use reads every user of the project, so a partial view refuses it
	// whatever the credential.
	{op: "ListSchemas", variant: "in_use", principal: sessionPrincipal, gate: partialList, expand: expandSchemasInUse, refused: schemaCodes.denied, mentions: "whole project"},
	{op: "ListSchemas", variant: "in_use", principal: secretPrincipal, gate: partialList, expand: expandSchemasInUse, refused: schemaCodes.denied, mentions: "whole project"},
	{op: "ListSchemas", variant: "in_use", principal: sessionPrincipal, gate: projectWide, expand: expandSchemasInUse},
	{op: "ListSchemas", variant: "in_use", principal: secretPrincipal, gate: projectWide, expand: expandSchemasInUse},

	// Reading a user's memberships asks a session for read on the user's
	// whole project (requireMembershipReadIn); a secret is not asked again.
	{op: "GetUser", variant: "team_id", principal: sessionPrincipal, expand: askTeamMembership, second: true, refused: userCodes.denied, mentions: "team_membership.read"},
	{op: "GetUser", variant: "team_id", principal: sessionPrincipal, expand: askTeamMembership, second: true, secondAllows: true},
	{op: "GetUser", variant: "team_id", principal: secretPrincipal, expand: askTeamMembership},
	{op: "ListUserTeams", principal: sessionPrincipal, second: true, refused: userCodes.denied, mentions: "team_membership.read"},
	{op: "ListUserTeams", principal: sessionPrincipal, second: true, secondAllows: true},
	{op: "ListUserTeams", principal: secretPrincipal},
}

// reachService wires the first storage call or service method op reaches
// once its checks pass, and returns the assertion that it was reached.
func reachService(t *testing.T, f *gateFixture, op string) func(*testing.T) {
	t.Helper()
	switch op {
	case "QueryUsers":
		return userServiceReached(f, "ListUsers")
	case "GetUser":
		return userServiceReached(f, "GetUserByID")
	case "ListUserTeams":
		return userServiceReached(f, "ListUserTeams")
	case "ListDeployments":
		f.stmts.MockAllStatements.EXPECT().ListDeployments(gomock.Any(), gomock.Any()).Return(nil, errReachedService)
	case "ListSchemas":
		f.stmts.MockAllStatements.EXPECT().ListJSONSchemas(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, errReachedService)
	default:
		t.Fatalf("no service to reach for %s", op)
	}
	// gomock fails the test at cleanup if the expected statement was not run.
	return func(*testing.T) {}
}

func userServiceReached(f *gateFixture, method string) func(*testing.T) {
	return func(t *testing.T) {
		assert.Equal(t, []string{method}, f.users.calls, "the request reaches the user service once its checks pass")
	}
}

func TestGateContractLaterChecks(t *testing.T) {
	t.Parallel()
	for _, row := range laterCheckRows {
		gate := soleGateRow(t, row.op)
		name := row.op
		if row.variant != "" {
			name += "/" + row.variant
		}
		name += "/" + row.principal.name
		if gate.list {
			name += map[gateAnswer]string{projectWide: "/project-wide", partialList: "/partial list"}[row.gate]
		}
		if row.second {
			name += map[bool]string{true: "/second allows", false: "/second refuses"}[row.secondAllows]
		}
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			answers := []bool{row.gate == projectWide}
			if row.second {
				answers = append(answers, row.secondAllows)
			}
			f := newGateFixture(t, true, answers...)
			call, first := prepareGateCall(t, f, gate, row.principal)
			args := buildArgs(t, gate, call)
			if row.expand != nil {
				row.expand(t, args)
			}
			var reached func(*testing.T)
			if row.refused == "" {
				reached = reachService(t, f, row.op)
			}

			err := callOperation(t, f.handler, row.op, args, row.principal.scope, nil)

			want := []domain.AuthzCheckParams{first}
			if row.second {
				second := first
				second.Relation = viewer
				second.ResourceID, second.ResourceTeamID = "", ""
				want = append(want, second)
			}
			assert.Equal(t, want, f.stmts.recordedChecks(), "the Checks asked, in order")
			if row.refused == "" {
				reached(t)
				return
			}
			assertDomainCode(t, err, row.refused)
			var de domain.Error
			require.True(t, errors.As(err, &de))
			assert.Contains(t, de.Message, row.mentions, "the refusal names what is missing")
			f.assertNoFakeReached(t)
		})
	}
}

// soleGateRow is op's gate row; a later check needs an operation with one.
func soleGateRow(t *testing.T, op string) gateRow {
	t.Helper()
	var found []gateRow
	for _, row := range gateRows {
		if row.op == op {
			found = append(found, row)
		}
	}
	require.Len(t, found, 1, "%s needs exactly one gate row", op)
	return found[0]
}
