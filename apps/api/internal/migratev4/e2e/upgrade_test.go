//go:build postgres_integration

package e2e_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/migratev4"
)

// A migration continues across migrator upgrades. A ledger that an earlier
// build wrote, with its binding form, its reducer version and fingerprints in
// formats this build no longer writes, reruns without a single write to
// nextgen: no password is reinstalled over the rehash a sign-in made, and
// every user still signs in.
func TestRecordedV4_LedgerFromAnEarlierBuildRerunsWithoutWrites(t *testing.T) {
	m := newMigration(t, profileSupported)
	opts := m.options(migratev4.IdentifierEmail)
	_, err := m.migrator.Run(t.Context(), opts)
	require.NoError(t, err)

	// A sign-in rehashes the imported legacy hash in place.
	niaj := m.user("niaj@Globex")
	got, _ := m.signIn(opts.Identifier, niaj.identifier(opts.Identifier), niaj.Password.Plaintext)
	require.Equal(t, m.targetID("user", niaj.ID), got)

	m.rewindLedgerToEarlierBuild(opts)

	rerun, err := m.migrator.Run(t.Context(), opts)
	require.NoError(t, err, "the earlier binding is adopted: %+v", rerun)
	assert.True(t, rerun.Ingest.Restaged, "the earlier reducer version restages the source")
	requireNoWrites(t, rerun)

	verified, err := m.migrator.Verify(t.Context(), opts)
	require.NoError(t, err)
	requireVerified(t, verified)
	for _, u := range m.summary.Users {
		got, stopped := m.signIn(opts.Identifier, u.identifier(opts.Identifier), u.Password.Plaintext)
		assert.Equal(t, m.targetID("user", u.ID), got, "%s signs in after the upgrade; stopped on %q", u.Key, stopped)
	}

	again, err := m.migrator.Run(t.Context(), opts)
	require.NoError(t, err)
	requireNoWrites(t, again)
}

// rewindLedgerToEarlierBuild leaves the ledger as the build before this
// change did: bound in its format (2, with reducer version 2 in it), staged
// by reducer version 2, and every fingerprint in a form this build does not
// write.
func (m *migration) rewindLedgerToEarlierBuild(opts migratev4.Options) {
	m.t.Helper()
	ctx := m.t.Context()
	identity, err := m.source.Identity(ctx, opts.InstanceID)
	require.NoError(m.t, err)
	// The earlier build's binding, spelled out: a hex SHA-256 of the JSON of
	// its format, its reducer version, the source identity and the options.
	raw, err := json.Marshal([]any{2, 2, identity, opts.ProjectID, opts.Identifier, migratev4.DefaultOrgUsersTeam, helpers.BuiltinSchemaBaseURL})
	require.NoError(m.t, err)
	sum := sha256.Sum256(raw)
	for _, stmt := range []string{
		`UPDATE zitadel_migrate_v4.bindings SET binding = $2 WHERE instance_id = $1`,
		`UPDATE zitadel_migrate_v4.cursors SET reducer_version = 2 WHERE instance_id = $1`,
		`UPDATE zitadel_migrate_v4.id_map SET fingerprint = 'written-by-an-earlier-build' WHERE instance_id = $1 AND fingerprint <> ''`,
	} {
		args := []any{opts.InstanceID}
		if stmt == `UPDATE zitadel_migrate_v4.bindings SET binding = $2 WHERE instance_id = $1` {
			args = append(args, hex.EncodeToString(sum[:]))
		}
		tag, err := m.db.Exec(ctx, stmt, args...)
		require.NoError(m.t, err, stmt)
		require.NotZero(m.t, tag.RowsAffected(), stmt)
	}
}
