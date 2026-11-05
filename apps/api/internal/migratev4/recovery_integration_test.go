//go:build postgres_integration

package migratev4_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/migratev4"
	"github.com/zitadel/nextgen/internal/migratev4/v4/v4test"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func (h *harness) options() migratev4.Options {
	return migratev4.Options{InstanceID: h.v4.ID, MasterKey: []byte(v4test.MasterKey), SourceStopped: true, TargetStopped: true}
}

func TestRun_PreservesLoginRehashAndLoginNames(t *testing.T) {
	h := newHarness(t)
	h.seedSafe(false)
	h.push("user", "bob", "org", "user.human.added", map[string]any{"userName": "bob", "email": "alice@example.test", "encodedHash": h.bcrypt("Bob-Passw0rd!")})
	opts := h.options()
	opts.Identifier = migratev4.IdentifierLoginName
	_, err := h.migrator.Run(t.Context(), opts)
	require.NoError(t, err, "login-name mode accepts shared emails")
	projectID, userID := h.mapping("project", h.v4.ID).TargetID, h.mapping("user", "alice").TargetID
	password := func() *domain.UserPassword {
		pw, err := h.deps.Pool.Statements().GetUserPassword(t.Context(), database.And(
			database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID),
			database.Equal(database.Col(domain.UserPasswordFieldUserID), userID)))
		require.NoError(t, err)
		return pw
	}
	before := password()
	require.NoError(t, h.signIn(projectID, "alice", "Alice-Passw0rd!"))
	require.NoError(t, h.signIn(projectID, "bob", "Bob-Passw0rd!"))
	after := password()
	require.Equal(t, before.ID, after.ID)
	require.NotEqual(t, before.EncodedHash, after.EncodedHash, "the target upgrades cost 10 to 11 at login")
	_, err = h.migrator.Run(t.Context(), opts)
	require.NoError(t, err)
	require.Equal(t, after.EncodedHash, password().EncodedHash, "unchanged v4 hash must not overwrite the upgraded hash")
	_, err = h.migrator.Verify(t.Context(), opts)
	require.NoError(t, err)
	h.push("user", "alice", "org", "user.human.password.changed", map[string]any{"encodedHash": h.bcrypt("Changed-Passw0rd!"), "changeRequired": false})
	_, err = h.migrator.Run(t.Context(), opts)
	require.NoError(t, err)
	require.NotEqual(t, after.ID, password().ID, "a source password change creates a new credential version")
	require.NoError(t, h.signIn(projectID, "alice", "Changed-Passw0rd!"))
}

func TestCleanup_IsScopedAndRequiresVerification(t *testing.T) {
	first, second := newHarness(t), newHarness(t)
	first.seedSafe(false)
	second.seedSafe(false)
	first.run()
	second.run()
	projectID := first.mapping("project", first.v4.ID).TargetID
	t.Cleanup(func() { _ = first.deps.Projects.Delete(context.Background(), projectID) })
	require.ErrorContains(t, first.migrator.Cleanup(t.Context(), first.v4.ID, false), "verify")
	_, err := first.migrator.Verify(t.Context(), first.options())
	require.NoError(t, err)
	require.NoError(t, first.migrator.Cleanup(t.Context(), first.v4.ID, false))
	_, err = first.deps.Projects.Get(t.Context(), projectID, service.ProjectQueryOptions{})
	require.NoError(t, err, "cleanup leaves target resources intact")
	second.mapping("user", "alice")
	_, err = second.migrator.Verify(t.Context(), second.options())
	require.NoError(t, err, "cleanup must not touch another instance's ledger")
}

func TestRun_RecomputesInheritedDomainWithoutUserEvents(t *testing.T) {
	h := newHarness(t)
	h.seedSafe(false)
	h.run()
	before := h.mapping("user", "alice")
	loginName := func() any {
		user, err := h.deps.Users.GetUserByID(t.Context(), service.GetUserInput{ProjectID: h.mapping("project", h.v4.ID).TargetID, UserID: before.TargetID})
		require.NoError(t, err)
		for _, attr := range user.Attributes {
			if attr.Key == migratev4.IdentifierLoginName {
				return attr.Value
			}
		}
		return nil
	}
	was := loginName()
	h.push("org", "org", "org", "org.domain.added", map[string]any{"domain": "example.test"})
	h.push("org", "org", "org", "org.domain.primary.set", map[string]any{"domain": "example.test"})
	h.push("org", "org", "org", "org.policy.domain.added", map[string]any{"userLoginMustBeDomain": true})
	h.run()
	after := h.mapping("user", "alice")
	require.Equal(t, before.TargetID, after.TargetID)
	require.Equal(t, before.AppliedSequence, after.AppliedSequence, "no user event was needed")
	require.NotEqual(t, was, loginName(), "the derived login name changes")
	_, err := h.migrator.Verify(t.Context(), h.options())
	require.NoError(t, err)
}

func (h *harness) seedSafe(withSSO bool) {
	h.push("instance", h.v4.ID, h.v4.ID, "instance.added", map[string]any{"name": "Recovery test"})
	h.push("instance", h.v4.ID, h.v4.ID, "instance.default.org.set", map[string]any{"orgId": "org"})
	h.push("instance", h.v4.ID, h.v4.ID, "instance.policy.login.added", map[string]any{"allowUsernamePassword": true, "allowRegister": true, "allowExternalIdp": withSSO})
	h.push("org", "org", "org", "org.added", map[string]any{"name": "Default"})
	h.push("user", "alice", "org", "user.human.added", map[string]any{"userName": "alice", "email": "alice@example.test", "encodedHash": h.bcrypt("Alice-Passw0rd!")})
	if withSSO {
		secret, err := v4test.Encrypt("idpConfigKey", h.idpKey, "test-secret")
		require.NoError(h.t, err)
		h.push("instance", h.v4.ID, h.v4.ID, "instance.idp.oidc.added", map[string]any{"id": "sso", "name": "Company SSO", "issuer": "https://sso.example.test", "clientId": "test", "clientSecret": secret})
		h.push("instance", h.v4.ID, h.v4.ID, "instance.policy.login.idpprovider.added", map[string]any{"idpConfigId": "sso"})
		h.push("user", "alice", "org", "user.human.externalidp.added", map[string]any{"idpConfigId": "sso", "userId": "subject"})
	}
}

func testConnection(t *testing.T) *pgx.Conn {
	conn, err := pgx.Connect(t.Context(), dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	return conn
}

// failCheckpoint interrupts after the target transaction commits, before its
// ledger acknowledgement. The next process sees exactly this durable state.
func failCheckpoint(t *testing.T, conn *pgx.Conn, instanceID, kind string) func() {
	_, err := conn.Exec(t.Context(), fmt.Sprintf(`CREATE OR REPLACE FUNCTION zitadel_migrate_v4.test_fail_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.instance_id = '%s' AND NEW.source_kind = '%s' AND NEW.status = 'applied' THEN
  RAISE EXCEPTION 'injected ledger checkpoint failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_fail_checkpoint BEFORE UPDATE ON zitadel_migrate_v4.id_map FOR EACH ROW EXECUTE FUNCTION zitadel_migrate_v4.test_fail_checkpoint();`, instanceID, kind))
	require.NoError(t, err)
	stop := func() {
		_, err := conn.Exec(context.Background(), `DROP TRIGGER IF EXISTS test_fail_checkpoint ON zitadel_migrate_v4.id_map; DROP FUNCTION IF EXISTS zitadel_migrate_v4.test_fail_checkpoint()`)
		require.NoError(t, err)
	}
	t.Cleanup(stop)
	return stop
}

func TestRecovery_EveryTargetCheckpoint(t *testing.T) {
	for _, kind := range []string{"project", "schema", "team", "idp_secret", "idp", "flow", "password", "user", "link"} {
		t.Run(kind, func(t *testing.T) {
			h := newHarness(t)
			h.seedSafe(true)
			_, err := h.migrator.Assess(t.Context(), h.options())
			require.NoError(t, err)
			conn := testConnection(t)
			stop := failCheckpoint(t, conn, h.v4.ID, kind)
			_, err = h.migrator.Run(t.Context(), h.options())
			require.ErrorContains(t, err, "injected ledger checkpoint failure")
			pending, err := h.store.Pending(t.Context(), h.v4.ID)
			require.NoError(t, err)
			require.True(t, pending)
			_, err = h.migrator.Assess(t.Context(), h.options())
			require.ErrorContains(t, err, "pending")
			require.ErrorContains(t, h.migrator.Cleanup(t.Context(), h.v4.ID, true), "pending")
			stop()
			report := h.run()
			require.True(t, report.Resumed)
			projectID := h.mapping("project", h.v4.ID).TargetID
			var passwords, schemas, flows, duplicateEvents int
			require.NoError(t, conn.QueryRow(t.Context(), `SELECT count(*) FROM zitadel_nextgen.user_passwords WHERE project_id=$1`, projectID).Scan(&passwords))
			require.NoError(t, conn.QueryRow(t.Context(), `SELECT count(*) FROM zitadel_nextgen.json_schemas WHERE project_id=$1 AND object_type='human-user'`, projectID).Scan(&schemas))
			require.NoError(t, conn.QueryRow(t.Context(), `SELECT count(*) FROM zitadel_nextgen.flow_definitions WHERE project_id=$1`, projectID).Scan(&flows))
			require.NoError(t, conn.QueryRow(t.Context(), `SELECT count(*) FROM (SELECT event_type, entity_id FROM zitadel_nextgen.events WHERE project_id=$1 GROUP BY event_type, entity_id HAVING count(*) > 1) duplicates`, projectID).Scan(&duplicateEvents))
			assert.Equal(t, 1, passwords)
			assert.Equal(t, 2, schemas, "default and imported revisions only")
			assert.Equal(t, 2, flows, "default and imported revisions only")
			assert.Zero(t, duplicateEvents, "retry must not repeat target audit events")
			h.run()
			_, err = h.migrator.Verify(t.Context(), h.options())
			require.NoError(t, err)
		})
	}
}

func TestRecovery_FinishPendingCutBeforeNewerSource(t *testing.T) {
	h := newHarness(t)
	h.seedSafe(false)
	h.run()
	projectID, userID := h.mapping("project", h.v4.ID).TargetID, h.mapping("user", "alice").TargetID
	h.push("user", "alice", "org", "user.human.email.changed", map[string]any{"email": "b@example.test"})
	stop := failCheckpoint(t, testConnection(t), h.v4.ID, "user")
	_, err := h.migrator.Run(t.Context(), h.options())
	require.Error(t, err)
	stop()
	h.push("user", "alice", "org", "user.human.email.changed", map[string]any{"email": "c@example.test"})
	report := h.run()
	require.True(t, report.Resumed)
	user, err := h.deps.Users.GetUserByID(t.Context(), service.GetUserInput{ProjectID: projectID, UserID: userID})
	require.NoError(t, err)
	for _, attr := range user.Attributes {
		if attr.Key == "email" {
			require.Equal(t, "b@example.test", attr.Value)
		}
	}
	_, err = h.migrator.Verify(t.Context(), h.options())
	require.Error(t, err, "verify must see source C independently of the staged B")
	h.run()
	_, err = h.migrator.Verify(t.Context(), h.options())
	require.NoError(t, err)
}

// v4 is the truth: a password or secret changed in nextgen is set back to
// v4's on the next run, and verify sees the difference until then.
func TestRun_OverwritesTargetEditsWithV4(t *testing.T) {
	t.Run("target_password", func(t *testing.T) {
		h := newHarness(t)
		h.seedSafe(true)
		h.run()
		projectID, userID := h.mapping("project", h.v4.ID).TargetID, h.mapping("user", "alice").TargetID
		require.NoError(t, h.deps.Pool.Statements().SetUserPassword(t.Context(), &domain.SetUserPassword{ProjectID: projectID, UserID: userID, EncodedHash: h.bcrypt("Admin-Passw0rd!")}))
		_, err := h.migrator.Verify(t.Context(), h.options())
		require.Error(t, err, "verify sees a password row the migration did not write")

		report := h.run()
		assert.Equal(t, 1, report.Applied["user"].Updated)
		require.NoError(t, h.signIn(projectID, "alice@example.test", "Alice-Passw0rd!"), "v4's password is back")
		require.Error(t, h.signIn(projectID, "alice@example.test", "Admin-Passw0rd!"))
		_, err = h.migrator.Verify(t.Context(), h.options())
		require.NoError(t, err)
		requireNoWrites(t, h.run())
	})
	t.Run("target_secret", func(t *testing.T) {
		h := newHarness(t)
		h.seedSafe(true)
		h.run()
		projectID := h.mapping("project", h.v4.ID).TargetID
		name := h.mapping("idp_secret", "sso").TargetID
		require.NoError(t, h.deps.Variables.SetVariables(t.Context(), domain.VariableOwner{ProjectID: projectID}, nil, []service.VariableToSet{{Name: name, Value: "edited-in-target", IsSecret: true}}))
		_, err := h.migrator.Verify(t.Context(), h.options())
		require.Error(t, err, "verify compares the secret nextgen serves with v4's")

		report := h.run()
		assert.Equal(t, 1, report.Applied["idp_secret"].Updated)
		_, err = h.migrator.Verify(t.Context(), h.options())
		require.NoError(t, err)
		requireNoWrites(t, h.run())
	})
}

// requireNoWrites fails on a run that wrote anything to nextgen.
func requireNoWrites(t *testing.T, report *migratev4.Report) {
	t.Helper()
	for kind, counts := range report.Applied {
		require.Zero(t, counts.Created+counts.Updated+counts.Failed, "%s: %+v", kind, counts)
	}
}

// Changes nextgen has no writer for yet, or that rebind the ledger, are
// refused before any write.
func TestRun_RefusesLifecycleChangesBeforeWrites(t *testing.T) {
	for _, change := range []string{"inactive", "removed_link", "recreated", "binding", "source_rewind"} {
		t.Run(change, func(t *testing.T) {
			h := newHarness(t)
			h.seedSafe(true)
			h.run()
			opts := h.options()
			switch change {
			case "inactive":
				h.push("user", "alice", "org", "user.deactivated", nil)
			case "removed_link":
				h.push("user", "alice", "org", "user.human.externalidp.removed", map[string]any{"idpConfigId": "sso", "userId": "subject"})
			case "recreated":
				h.push("user", "alice", "org", "user.removed", nil)
				h.push("user", "alice", "org", "user.human.added", map[string]any{"userName": "alice", "email": "alice@example.test", "encodedHash": h.bcrypt("New-Passw0rd!")})
			case "binding":
				opts.Identifier = migratev4.IdentifierLoginName
			case "source_rewind":
				_, err := testConnection(t).Exec(t.Context(), `DELETE FROM eventstore.events2 WHERE instance_id=$1 AND aggregate_type='user'`, h.v4.ID)
				require.NoError(t, err)
			}
			report, err := h.migrator.Run(t.Context(), opts)
			require.Error(t, err)
			if report != nil {
				require.Empty(t, report.Applied)
			}
			pending, err := h.store.Pending(t.Context(), h.v4.ID)
			require.NoError(t, err)
			require.False(t, pending)
		})
	}
}
