//go:build postgres_integration

package e2e_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/migratev4"
)

// The full fixture holds what nextgen cannot carry over yet: locked and
// inactive accounts, required password changes, MFA, duplicate identifiers.
// The migration refuses it as a whole and writes nothing.
func TestRecordedV4_FullFixtureIsRefused(t *testing.T) {
	m := newMigration(t, profileFull)
	opts := m.options(migratev4.IdentifierEmail)

	assessed, err := m.migrator.Assess(t.Context(), opts)
	require.Error(t, err, "assess reports blockers as an error")
	require.NotNil(t, assessed)
	codes := map[string]bool{}
	for _, issue := range assessed.Issues {
		codes[issue.Code] = true
	}
	for _, code := range []string{"user_state_unsupported", "identifier_conflict"} {
		assert.True(t, codes[code], "assess reports %s; got %v", code, codes)
	}

	report, err := m.migrator.Run(t.Context(), opts)
	require.Error(t, err)
	require.NotNil(t, report)
	assert.Empty(t, m.projectID(), "a refused run creates no project")
	requireNoWrites(t, report)
}

// The supported fixture migrates completely in either identifier mode: every
// user signs in through nextgen's login flow with the password they had in
// v4, whatever hash format v4 stored it in, and lands on the user the ledger
// maps them to. A wrong password is refused. A second run writes nothing, and
// the users still sign in after their first sign-in rehashed the password.
func TestRecordedV4_SupportedFixtureSignsIn(t *testing.T) {
	for _, mode := range []string{migratev4.IdentifierEmail, migratev4.IdentifierLoginName} {
		t.Run(mode, func(t *testing.T) {
			m := newMigration(t, profileSupported)
			opts := m.options(mode)

			assessed, err := m.migrator.Assess(t.Context(), opts)
			require.NoError(t, err)
			for _, issue := range assessed.Issues {
				assert.NotEqual(t, migratev4.SeverityConflict, issue.Severity, "assess blocks on %+v", issue)
			}

			report, err := m.migrator.Run(t.Context(), opts)
			require.NoError(t, err, "issues: %+v", report)
			require.NotEmpty(t, m.projectID())
			require.Equal(t, len(m.summary.Users), report.Applied["user"].Created)

			verified, err := m.migrator.Verify(t.Context(), opts)
			require.NoError(t, err)
			requireVerified(t, verified)

			for _, u := range m.summary.Users {
				require.NotNil(t, u.Password, u.Key)
				want := m.targetID("user", u.ID)
				require.NotEmpty(t, want, "%s is mapped", u.Key)

				got, stopped := m.signIn(mode, u.identifier(mode), u.Password.Plaintext)
				assert.Equal(t, want, got, "%s (%s) signs in with the v4 password; stopped on %q", u.Key, u.Password.Kind, stopped)

				got, stopped = m.signIn(mode, u.identifier(mode), u.Password.Plaintext+"-wrong")
				assert.Empty(t, got, "%s: a wrong password is refused", u.Key)
				assert.Equal(t, "password", stopped)
			}

			rerun, err := m.migrator.Run(t.Context(), opts)
			require.NoError(t, err)
			requireNoWrites(t, rerun)
			verified, err = m.migrator.Verify(t.Context(), opts)
			require.NoError(t, err)
			requireVerified(t, verified)

			for _, u := range m.summary.Users {
				got, _ := m.signIn(mode, u.identifier(mode), u.Password.Plaintext)
				assert.Equal(t, m.targetID("user", u.ID), got, "%s still signs in after the rerun", u.Key)
			}
		})
	}
}
