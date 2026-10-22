//go:build postgres_integration

package migratev4_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/migratev4"
	"github.com/zitadel/nextgen/internal/migratev4/stage"
	v4 "github.com/zitadel/nextgen/internal/migratev4/v4"
	"github.com/zitadel/nextgen/internal/migratev4/v4/v4test"
	"github.com/zitadel/nextgen/internal/policy"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/testdb"
	configdefaults "github.com/zitadel/nextgen/packages/config/defaults"
)

var dsn string

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

// runTests holds the deferred stop, which os.Exit would skip.
func runTests(m *testing.M) int {
	var stop func()
	var err error
	dsn, stop, err = testdb.PostgresDSN(context.Background())
	if err != nil {
		panic(err)
	}
	defer stop()
	return m.Run()
}

// harness is a v4 database and a nextgen database in one Postgres, as the
// migrator runs in production, with the migrator between them.
type harness struct {
	t        *testing.T
	v4       *v4test.Instance
	migrator *migratev4.Migrator
	deps     migratev4.Deps
	store    *stage.Store
	authn    service.AuthAttemptService
	sso      *service.FlowSSOIdentityResolver
	idpKey   []byte
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	ctx := t.Context()
	cfg, err := pgxpool.ParseConfig(dsn)
	require.NoError(t, err)
	v4Pool, err := pgxpool.NewWithConfig(ctx, cfg.Copy())
	require.NoError(t, err)
	t.Cleanup(v4Pool.Close)
	require.NoError(t, v4test.CreateSchema(ctx, v4Pool))
	require.NoError(t, v4test.MarkSetupStep(ctx, v4Pool, v4.StepGapFree))
	idpKey := []byte("0123456789abcdef0123456789abcdef")
	require.NoError(t, v4test.StoreKey(ctx, v4Pool, "idpConfigKey", idpKey))

	dialect, err := postgres.DecodeConfig(dsn)
	require.NoError(t, err)
	pool, err := dialect.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(context.Background()) })
	require.NoError(t, pool.Migrate(ctx))

	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	masterKeys, err := domain.NewMasterKeys([]domain.MasterKey{domain.NewMasterKey("test", *rsaKey, true)})
	require.NoError(t, err)
	hashers, err := (&crypto.HashConfig{
		Verifiers: []crypto.HashName{crypto.HashNameBcrypt},
		Hasher:    crypto.HasherConfig{Algorithm: crypto.HashNameBcrypt, Params: map[string]any{"cost": 10}},
		Limits:    crypto.HashLimitsConfig{Bcrypt: crypto.BcryptLimitsConfig{MinCost: 10, MaxCost: 16}},
	}).NewHasherFactory()
	require.NoError(t, err)
	deps, err := migratev4.NewDeps(pool.(service.Pool), migratev4.DepsConfig{
		MasterKeys:        *masterKeys,
		Hashers:           hashers,
		BuiltinPublicBase: configdefaults.DefaultBuiltinSchemaBase,
		SharedHosts:       domain.DefaultSharedHosts,
	})
	require.NoError(t, err)

	src, err := v4.Open(ctx, cfg.Copy())
	require.NoError(t, err)
	t.Cleanup(src.Close)
	store, err := stage.Open(ctx, cfg.Copy())
	require.NoError(t, err)
	t.Cleanup(store.Close)

	db := service.NewPool(pool.(service.Pool))
	engine, err := policy.New()
	require.NoError(t, err)
	passwords, err := service.NewPasswordPolicy(engine, service.NewPolicyService(db, engine), hashers.Default(), db)
	require.NoError(t, err)

	h := &harness{
		t:        t,
		v4:       v4test.NewInstance(v4Pool, fmt.Sprintf("i%d", time.Now().UnixNano())),
		migrator: migratev4.New(src, store, deps),
		deps:     deps,
		store:    store,
		authn:    service.NewAuthAttemptService(deps.Pool, service.SessionStatementsResolver{Pool: deps.Pool}, service.UserStatementsLookup{Pool: deps.Pool}, hashers.Default()),
		sso:      service.NewFlowSSOIdentityResolver(db, deps.IDPs, deps.Users, deps.SchemaStore, service.NewProjectHasherResolver(db, hashers), passwords),
		idpKey:   idpKey,
	}
	t.Cleanup(func() {
		ctx := context.Background()
		mappings, _ := store.Mappings(ctx, h.v4.ID)
		for key, m := range mappings {
			if key.Kind == "project" {
				_ = deps.Projects.Delete(ctx, m.TargetID)
			}
		}
		_ = store.DropInstance(ctx, h.v4.ID)
		_ = h.v4.Delete(ctx)
	})
	return h
}

func (h *harness) push(aggregateType, aggregateID, owner, eventType string, payload any) {
	h.t.Helper()
	require.NoError(h.t, h.v4.Push(h.t.Context(), aggregateType, aggregateID, owner, eventType, payload))
}

func (h *harness) bcrypt(password string) string {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	require.NoError(h.t, err)
	return string(hash)
}

func (h *harness) run() *migratev4.Report {
	h.t.Helper()
	report, err := h.migrator.Run(h.t.Context(), migratev4.Options{InstanceID: h.v4.ID, MasterKey: []byte(v4test.MasterKey)})
	require.NoError(h.t, err)
	return report
}

// signIn runs the sign-in nextgen's API runs: a user proof with the login
// name, then a password proof.
func (h *harness) signIn(projectID, loginName, password string) error {
	ctx := h.t.Context()
	attempt, err := h.authn.Create(ctx, service.CreateAuthAttemptInput{ProjectID: projectID})
	require.NoError(h.t, err)
	prove := func(challenge service.Challenge, checkType domain.AuthCheckType, proof service.Proof) error {
		issued, err := h.authn.IssueChallenge(ctx, service.IssueChallengeInput{ProjectID: projectID, AttemptID: attempt.ID, Challenge: challenge})
		require.NoError(h.t, err)
		ch, ok := issued.ChallengeByType(checkType)
		require.True(h.t, ok)
		_, err = h.authn.VerifyProof(ctx, service.VerifyProofInput{ProjectID: projectID, AttemptID: attempt.ID, ChallengeID: ch.GetID(), Proof: proof})
		return err
	}
	if err := prove(service.UserChallenge{}, domain.AuthCheckTypeUser, service.UserProof{LoginName: loginName}); err != nil {
		return err
	}
	return prove(service.PasswordChallenge{}, domain.AuthCheckTypePassword, service.PasswordProof{Password: password})
}

// signInWithSSO runs what nextgen runs once a provider returns an account:
// the SSO state round trip and callback result, then the identity resolution
// and bind the flow engine performs. Only the OIDC exchange is not real: the
// result carries the subject the provider would have asserted. It returns
// the user the account is linked to, empty when it is linked to none.
func (h *harness) signInWithSSO(projectID, slug, subject string) (string, error) {
	ctx := h.t.Context()
	connections, err := h.deps.IDPs.GetBySlugs(ctx, projectID, []string{slug})
	require.NoError(h.t, err)
	require.Len(h.t, connections, 1)
	connection := connections[0]
	attempt, err := h.authn.Create(ctx, service.CreateAuthAttemptInput{ProjectID: projectID})
	require.NoError(h.t, err)
	state, err := h.authn.IssueSSOState(ctx, service.IssueSSOStateInput{
		ProjectID: projectID, AttemptID: attempt.ID, ProviderSlug: slug, ConnectionRevisionID: connection.RevisionID,
		RedirectURI: "https://app.example.test/__nextgen/idp/" + slug + "/callback", ReturnTarget: "https://app.example.test/",
	})
	require.NoError(h.t, err)
	check, err := h.authn.ConsumeSSOState(ctx, projectID, state.State, state.BindingNonce)
	require.NoError(h.t, err)
	require.NoError(h.t, h.authn.SetSSOCallbackResult(ctx, projectID, check, &domain.SSOCallbackResult{
		Subject: subject, ConnectionRevisionID: connection.RevisionID, Claims: map[string]any{"sub": subject},
	}, domain.EventTypeAuthSSOExchangeSucceeded))

	parked, err := h.sso.LoadParked(ctx, domain.FlowSSOLoadInput{ProjectID: projectID, AttemptID: attempt.ID, UserSchemaURL: h.mapping("schema", "human-user").TargetID})
	if err != nil || parked == nil || parked.Link == nil {
		return "", err
	}
	return parked.Link.UserID, h.sso.BindLinked(ctx, domain.FlowSSOBindInput{
		ProjectID: projectID, AttemptID: attempt.ID, CheckID: parked.CheckID,
		UserID: parked.Link.UserID, ConnectionID: parked.ConnectionID, LinkID: parked.Link.LinkID,
	})
}

func (h *harness) mapping(kind, id string) *stage.Mapping {
	h.t.Helper()
	mappings, err := h.store.Mappings(h.t.Context(), h.v4.ID)
	require.NoError(h.t, err)
	m := mappings[stage.MappingKey{Kind: kind, ID: id}]
	require.NotNil(h.t, m, "%s %s was not migrated", kind, id)
	return m
}

func TestRun_MigratesSignsInAndConverges(t *testing.T) {
	h := newHarness(t)
	ctx := t.Context()
	instanceID := h.v4.ID
	secret, err := v4test.Encrypt("idpConfigKey", h.idpKey, "corp-secret")
	require.NoError(t, err)

	// A v4 instance: the default org, Acme with org-scoped login names, an OIDC
	// IdP offered at sign-in, four people and a machine.
	h.push("instance", instanceID, instanceID, "instance.added", map[string]any{"name": "Acme Corp"})
	h.push("instance", instanceID, instanceID, "instance.default.org.set", map[string]any{"orgId": "org-default"})
	h.push("instance", instanceID, instanceID, "instance.policy.login.added", map[string]any{"allowUsernamePassword": true, "allowExternalIdp": true})
	h.push("instance", instanceID, instanceID, "instance.idp.oidc.added", map[string]any{
		"id": "idp-sso", "name": "Corporate SSO", "issuer": "https://sso.example.com", "clientId": "corp",
		"clientSecret": secret, "scopes": []string{"openid", "profile", "email"}, "usePKCE": true, "isCreationAllowed": true,
	})
	h.push("instance", instanceID, instanceID, "instance.policy.login.idpprovider.added", map[string]any{"idpConfigId": "idp-sso"})
	h.push("org", "org-default", "org-default", "org.added", map[string]any{"name": "Default"})
	h.push("org", "org-acme", "org-acme", "org.added", map[string]any{"name": "Acme"})
	for _, e := range []string{"org.domain.added", "org.domain.verified", "org.domain.primary.set"} {
		h.push("org", "org-acme", "org-acme", e, map[string]any{"domain": "acme.test"})
	}
	h.push("org", "org-acme", "org-acme", "org.policy.domain.added", map[string]any{"userLoginMustBeDomain": true})
	h.push("user", "u-alice", "org-acme", "user.human.added", map[string]any{
		"userName": "alice", "firstName": "Alice", "lastName": "Doe", "displayName": "Alice Doe",
		"email": "alice@acme.test", "encodedHash": h.bcrypt("Alice-Passw0rd!"),
	})
	h.push("user", "u-alice", "org-acme", "user.human.email.verified", nil)
	h.push("user", "u-alice", "org-acme", "user.human.externalidp.added", map[string]any{"idpConfigId": "idp-sso", "userId": "sso-alice"})
	h.push("user", "u-bob", "org-default", "user.human.added", map[string]any{"userName": "bob", "email": "bob@example.test", "encodedHash": h.bcrypt("Bob-Passw0rd!")})
	h.push("user", "u-carol", "org-acme", "user.human.added", map[string]any{"userName": "carol", "email": "carol@acme.test", "encodedHash": h.bcrypt("Carol-Passw0rd!")})
	h.push("user", "u-carol", "org-acme", "user.locked", nil)
	h.push("user", "u-dup", "org-acme", "user.human.added", map[string]any{"userName": "dup", "email": "ALICE@acme.test"})
	h.push("user", "u-ci", "org-acme", "user.machine.added", map[string]any{"userName": "ci-bot"})

	// ---- first run: everything is created
	report := h.run()
	assert.Equal(t, 1, report.Applied["project"].Created)
	assert.Equal(t, 1, report.Applied["team"].Created, "Acme; the default org's users are self-owned")
	assert.Equal(t, 3, report.Applied["user"].Created, "alice, bob, carol; dup collides with alice's email, ci-bot is a machine")
	assert.Equal(t, 1, report.Applied["idp"].Created)
	assert.Equal(t, 1, report.Applied["idp_secret"].Created)
	assert.Equal(t, 1, report.Applied["link"].Created)
	assert.Equal(t, 1, report.Applied["flow"].Created)

	projectID := h.mapping("project", instanceID).TargetID
	require.NoError(t, h.signIn(projectID, "alice@acme.test", "Alice-Passw0rd!"), "alice signs in with her v4 password")
	require.ErrorIs(t, h.signIn(projectID, "alice@acme.test", "wrong"), domain.ErrAuthAttemptProofRejected(nil))
	require.NoError(t, h.signIn(projectID, "bob@example.test", "Bob-Passw0rd!"))

	alice, err := h.deps.Users.GetUserByID(ctx, service.GetUserInput{ProjectID: projectID, UserID: h.mapping("user", "u-alice").TargetID})
	require.NoError(t, err)
	require.NotNil(t, alice.LifecycleOwnerTeamID)
	assert.Equal(t, h.mapping("team", "org-acme").TargetID, *alice.LifecycleOwnerTeamID)
	attributes := map[string]any{}
	for _, a := range alice.Attributes {
		attributes[string(a.Key)] = a.Value
	}
	assert.Equal(t, "alice@acme.test", attributes["login_name"])
	assert.Equal(t, "u-alice", attributes["zitadel_v4_id"])
	assert.Equal(t, true, attributes["email_verified"])

	bob, err := h.deps.Users.GetUserByID(ctx, service.GetUserInput{ProjectID: projectID, UserID: h.mapping("user", "u-bob").TargetID})
	require.NoError(t, err)
	assert.Nil(t, bob.LifecycleOwnerTeamID)
	carol, err := h.deps.Users.GetUserByID(ctx, service.GetUserInput{ProjectID: projectID, UserID: h.mapping("user", "u-carol").TargetID})
	require.NoError(t, err)
	assert.Equal(t, domain.UserStatusDeactivated, carol.Metadata.Status, "locked in v4")

	variables, err := h.deps.Variables.GetDecryptedVariables(ctx, domain.VariableOwner{ProjectID: projectID}, nil, "V4_IDP_CORPORATE_SSO_CLIENT_SECRET")
	require.NoError(t, err)
	require.Len(t, variables, 1)
	assert.Equal(t, "corp-secret", variables[0].Value, "the IdP secret moved under nextgen's own encryption")

	connection, err := h.deps.IDPs.Get(ctx, projectID, h.mapping("idp", "idp-sso").TargetID)
	require.NoError(t, err)
	link, err := h.deps.Pool.Statements().GetIDPIdentityLink(ctx, database.And(
		database.Equal(database.Col(domain.IDPIdentityLinkFieldProjectID), projectID),
		database.Equal(database.Col(domain.IDPIdentityLinkFieldConnectionID), connection.ID),
		database.Equal(database.Col(domain.IDPIdentityLinkFieldSubject), "sso-alice"),
	))
	require.NoError(t, err)
	assert.Equal(t, alice.ID, link.UserID, "alice's provider account is linked to her migrated user")
	linked, err := h.signInWithSSO(projectID, "corporate-sso", "sso-alice")
	require.NoError(t, err)
	assert.Equal(t, alice.ID, linked, "signing in through the migrated IdP lands on alice's account, no relinking")
	linked, err = h.signInWithSSO(projectID, "corporate-sso", "someone-new")
	require.NoError(t, err)
	assert.Empty(t, linked, "an account v4 never linked goes to registration")

	// ---- second run: nothing changes
	report = h.run()
	assert.Zero(t, report.Ingest.Events)
	assert.Equal(t, migratev4.Counts{Unchanged: 3}, *report.Applied["user"])
	assert.Equal(t, migratev4.Counts{Unchanged: 1}, *report.Applied["link"])

	// ---- v4 moves on: nextgen follows
	h.push("user", "u-alice", "org-acme", "user.human.email.changed", map[string]any{"email": "alice.doe@acme.test"})
	h.push("user", "u-alice", "org-acme", "user.human.password.changed", map[string]any{"encodedHash": h.bcrypt("New-Passw0rd!"), "changeRequired": false})
	h.push("user", "u-bob", "org-default", "user.deactivated", nil)
	h.push("user", "u-dave", "org-default", "user.human.added", map[string]any{"userName": "dave", "email": "dave@example.test", "encodedHash": h.bcrypt("Dave-Passw0rd!")})
	h.push("user", "u-carol", "org-acme", "user.removed", nil)

	report = h.run()
	assert.Equal(t, 2, report.Applied["user"].Created, "dave, and dup: alice's new email resolved the collision that held it back")
	assert.Equal(t, 2, report.Applied["user"].Updated, "alice's email and password, bob's deactivation")
	h.mapping("user", "u-dup")
	require.NoError(t, h.signIn(projectID, "alice.doe@acme.test", "New-Passw0rd!"), "alice signs in with her new email and password")
	require.NoError(t, h.signIn(projectID, "dave@example.test", "Dave-Passw0rd!"))
	bob, err = h.deps.Users.GetUserByID(ctx, service.GetUserInput{ProjectID: projectID, UserID: h.mapping("user", "u-bob").TargetID})
	require.NoError(t, err)
	assert.Equal(t, domain.UserStatusDeactivated, bob.Metadata.Status)

	verify, err := h.migrator.Verify(ctx, migratev4.Options{InstanceID: instanceID})
	require.NoError(t, err)
	for _, check := range verify.Verify {
		assert.True(t, check.OK, "%s: expected %d, got %d", check.Name, check.Expected, check.Actual)
	}

	// ---- an edit in nextgen is reported, not overwritten
	aliceID := h.mapping("user", "u-alice").TargetID
	_, err = h.deps.Users.PatchUser(ctx, service.PatchUserInput{ProjectID: projectID, UserID: aliceID, Attributes: map[string]any{"nickname": "Ali"}})
	require.NoError(t, err)
	h.push("user", "u-alice", "org-acme", "user.human.profile.changed", map[string]any{"displayName": "Alice D."})
	report = h.run()
	assert.Equal(t, 1, report.Applied["user"].Skipped)
	assert.Contains(t, report.Issues, migratev4.Issue{Code: "user_edited_in_nextgen", Severity: migratev4.SeverityConflict, Kind: "user", SourceID: "u-alice"})
	alice, err = h.deps.Users.GetUserByID(ctx, service.GetUserInput{ProjectID: projectID, UserID: aliceID})
	require.NoError(t, err)
	for _, a := range alice.Attributes {
		if a.Key == "display_name" {
			assert.Equal(t, "Alice Doe", a.Value, "v4's change waits until the conflict is resolved")
		}
	}
}
