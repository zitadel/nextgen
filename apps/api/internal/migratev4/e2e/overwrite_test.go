//go:build postgres_integration

package e2e_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/migratev4"
	"github.com/zitadel/nextgen/internal/service"
)

// v4 is the truth until cutover. Whatever was changed in nextgen since the
// last run, a user's email, a password set there, an IdP connection, its
// client secret, a team's name, the next run puts v4's back, and only that:
// every user signs in with what they have in v4, and a further run writes
// nothing.
func TestRecordedV4_NextgenEditsAreOverwrittenByV4(t *testing.T) {
	m := newMigration(t, profileSupported)
	opts := m.options(migratev4.IdentifierEmail)
	_, err := m.migrator.Run(t.Context(), opts)
	require.NoError(t, err)
	ctx := t.Context()
	projectID := m.projectID()
	alice, bob := m.user("alice@Acme"), m.user("bob@Acme")

	_, err = m.deps.Users.PatchUser(ctx, service.PatchUserInput{ProjectID: projectID, UserID: m.targetID("user", alice.ID), Attributes: map[string]any{"email": "alice@edited-in-nextgen.test"}})
	require.NoError(t, err)

	hash, err := bcrypt.GenerateFromPassword([]byte("Set-In-Nextgen-1!"), 10)
	require.NoError(t, err)
	require.NoError(t, m.deps.Pool.Statements().SetUserPassword(ctx, &domain.SetUserPassword{ProjectID: projectID, UserID: m.targetID("user", bob.ID), EncodedHash: string(hash)}))

	corporate := m.idp("Corporate SSO")
	connections, err := m.deps.IDPs.GetBySlugs(ctx, projectID, []string{"corporate-sso"})
	require.NoError(t, err)
	require.Len(t, connections, 1)
	var document map[string]any
	require.NoError(t, json.Unmarshal(connections[0].Document, &document))
	document["display_name"] = "Renamed in nextgen"
	edited, err := json.Marshal(document)
	require.NoError(t, err)
	_, err = m.deps.IDPs.CreateOrRevise(ctx, projectID, edited)
	require.NoError(t, err)

	require.NoError(t, m.deps.Variables.SetVariables(ctx, domain.VariableOwner{ProjectID: projectID}, nil,
		[]service.VariableToSet{{Name: m.targetID("idp_secret", corporate.ID), Value: "edited-in-nextgen", IsSecret: true}}))

	teamID := m.targetID("team", alice.OrgID)
	team, err := m.deps.Pool.Statements().GetTeamByID(ctx, projectID, teamID)
	require.NoError(t, err)
	team.Name = "Renamed in nextgen"
	require.NoError(t, m.deps.Pool.Statements().UpdateTeam(ctx, team))

	_, err = m.migrator.Verify(ctx, opts)
	require.Error(t, err, "verify compares nextgen with v4 and sees the edits")

	report, err := m.migrator.Run(ctx, opts)
	require.NoError(t, err, "an edit in nextgen is not a conflict: %+v", report.Issues)
	assert.Equal(t, 2, report.Applied["user"].Updated, "alice's email, bob's password")
	assert.Equal(t, 1, report.Applied["idp"].Updated)
	assert.Equal(t, 1, report.Applied["idp_secret"].Updated)
	assert.Equal(t, 1, report.Applied["team"].Updated)

	verified, err := m.migrator.Verify(ctx, opts)
	require.NoError(t, err)
	requireVerified(t, verified)
	for _, u := range m.summary.Users {
		got, stopped := m.signIn(opts.Identifier, u.identifier(opts.Identifier), u.Password.Plaintext)
		assert.Equal(t, m.targetID("user", u.ID), got, "%s signs in with v4's email and password; stopped on %q", u.Key, stopped)
	}
	got, _ := m.signIn(opts.Identifier, bob.identifier(opts.Identifier), "Set-In-Nextgen-1!")
	assert.Empty(t, got, "the password set in nextgen is gone")

	again, err := m.migrator.Run(ctx, opts)
	require.NoError(t, err)
	requireNoWrites(t, again)
}
