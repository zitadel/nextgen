//go:build postgres_integration

// Package e2e_test replays real Zitadel v4 instances through the migrator and
// checks the result the way an app would see it: through nextgen's HTTP API.
//
// Each scenario gets its own database. The v4 instance in it is a fixture
// that demo/record-fixtures.sh recorded from a real v4 seeded through its own
// APIs (testdata/<version>/<profile>), next to nextgen's schema, as the
// migrator runs in production. After the migration, the API test harness
// serves that database, and the scenario signs in with the users' v4
// passwords, or through a migrated IdP, over HTTP.
package e2e_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	iapi "github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/migratev4"
	"github.com/zitadel/nextgen/internal/migratev4/stage"
	v4 "github.com/zitadel/nextgen/internal/migratev4/v4"
	"github.com/zitadel/nextgen/internal/migratev4/v4/v4test"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/testdb"
)

// v4Version is the recorded v4 release the scenarios replay. A new version
// gets its own directory from record-fixtures.sh.
const v4Version = "v4.19.5"

// The recorded profiles (seed-v4.mjs): full deliberately holds what the
// migrator must refuse; supported migrates completely.
const (
	profileFull      = "full"
	profileSupported = "supported"
)

var baseDSN string

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

// runTests holds the deferred stop, which os.Exit would skip.
func runTests(m *testing.M) int {
	iapi.FullErrorInResponse.Store(true)
	var stop func()
	var err error
	baseDSN, stop, err = testdb.PostgresDSN(context.Background())
	if err != nil {
		panic(err)
	}
	defer stop()
	return m.Run()
}

// summary is what seed-v4.mjs wrote about the instance it seeded: the users
// with their v4 passwords, the IdPs with their client secrets, the links.
type summary struct {
	V4 struct {
		Version    string `json:"version"`
		InstanceID string `json:"instanceId"`
		MasterKey  string `json:"masterKey"`
	} `json:"v4"`
	Users []fixtureUser `json:"users"`
	IDPs  []fixtureIDP  `json:"idps"`
	Links []fixtureLink `json:"links"`
}

type fixtureUser struct {
	Key           string `json:"key"`
	ID            string `json:"id"`
	Email         string `json:"email"`
	LoginName     string `json:"loginName"`
	ExpectedState string `json:"expectedState"`
	Password      *struct {
		Kind      string `json:"kind"`
		Plaintext string `json:"plaintext"`
	} `json:"password"`
}

// identifier is what the user types in the given identifier mode.
func (u fixtureUser) identifier(mode string) string {
	if mode == migratev4.IdentifierLoginName {
		return u.LoginName
	}
	return u.Email
}

type fixtureIDP struct {
	Name         string `json:"name"`
	ID           string `json:"id"`
	Type         string `json:"type"`
	Issuer       string `json:"issuer"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

type fixtureLink struct {
	User           string `json:"user"`
	UserID         string `json:"userId"`
	IDPID          string `json:"idpId"`
	ExternalUserID string `json:"externalUserId"`
}

func fixtureDir(profile string) string {
	return filepath.Join("..", "testdata", v4Version, profile)
}

func loadSummary(t *testing.T, profile string) summary {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(fixtureDir(profile), "summary.json"))
	require.NoError(t, err)
	var s summary
	require.NoError(t, json.Unmarshal(raw, &s))
	require.Equal(t, v4Version, s.V4.Version)
	return s
}

// migration is one scenario: a database holding a recorded v4 instance and
// nextgen's schema, the migrator over it, and the API harness serving it.
type migration struct {
	t        *testing.T
	summary  summary
	migrator *migratev4.Migrator
	store    *stage.Store
	deps     migratev4.Deps
	api      *helpers.Harness
}

func newMigration(t *testing.T, profile string) *migration {
	t.Helper()
	ctx := t.Context()
	dsn := scenarioDatabase(t)

	v4Pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(v4Pool.Close)
	require.NoError(t, v4test.LoadFixture(ctx, v4Pool, fixtureDir(profile)))

	dialect, err := postgres.DecodeConfig(dsn)
	require.NoError(t, err)
	pool, err := dialect.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(context.Background()) })
	require.NoError(t, pool.Migrate(ctx))

	// The deployment's verifiers and limits decide which v4 hashes import;
	// the hasher only writes the rehash after a sign-in, so it stays cheap.
	harness := &helpers.Harness{
		DB: service.NewPool(pool.(service.Pool)),
		HashConfig: &crypto.HashConfig{
			Verifiers: crypto.DefaultHashVerifiers(),
			Hasher:    crypto.HasherConfig{Algorithm: crypto.HashNameBcrypt, Params: map[string]any{"cost": 10}},
			Limits:    crypto.DefaultHashLimits(),
		},
	}
	deps, err := migratev4.NewDeps(pool.(service.Pool), migratev4.DepsConfig{
		MasterKeys:        *harness.EnsureMasterKey(t),
		Hashers:           harness.EnsureHasherFactory(t),
		BuiltinPublicBase: helpers.BuiltinSchemaBaseURL,
		SharedHosts:       domain.DefaultSharedHosts,
	})
	require.NoError(t, err)

	cfg, err := pgxpool.ParseConfig(dsn)
	require.NoError(t, err)
	src, err := v4.Open(ctx, cfg.Copy())
	require.NoError(t, err)
	t.Cleanup(src.Close)
	store, err := stage.Open(ctx, cfg.Copy())
	require.NoError(t, err)
	t.Cleanup(store.Close)

	return &migration{
		t:        t,
		summary:  loadSummary(t, profile),
		migrator: migratev4.New(src, store, deps),
		store:    store,
		deps:     deps,
		api:      harness,
	}
}

// scenarioDatabase creates an empty database for one scenario and drops it
// when the test ends. The ledger binds a v4 instance to its first options, so
// each identifier mode needs a database of its own.
func scenarioDatabase(t *testing.T) string {
	t.Helper()
	ctx := t.Context()
	admin, err := pgx.Connect(ctx, baseDSN)
	require.NoError(t, err)
	defer admin.Close(ctx)
	suffix := make([]byte, 6)
	_, err = rand.Read(suffix)
	require.NoError(t, err)
	name := "migrate_v4_e2e_" + hex.EncodeToString(suffix)
	_, err = admin.Exec(ctx, "CREATE DATABASE "+name)
	require.NoError(t, err)
	// Registered first, so it runs after every pool on the database closed.
	t.Cleanup(func() {
		ctx := context.Background()
		conn, err := pgx.Connect(ctx, baseDSN)
		if err != nil {
			return
		}
		defer conn.Close(ctx)
		_, _ = conn.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
	})
	u, err := url.Parse(baseDSN)
	require.NoError(t, err)
	u.Path = "/" + name
	return u.String()
}

// options are the operator's choices for this instance, offline as the POC
// requires.
func (m *migration) options(identifier string) migratev4.Options {
	return migratev4.Options{
		InstanceID:    m.summary.V4.InstanceID,
		Identifier:    identifier,
		MasterKey:     []byte(m.summary.V4.MasterKey),
		SourceStopped: true,
		TargetStopped: true,
	}
}

// targetID is the nextgen id the ledger maps a v4 resource to.
func (m *migration) targetID(kind, v4ID string) string {
	m.t.Helper()
	mappings, err := m.store.Mappings(m.t.Context(), m.summary.V4.InstanceID)
	require.NoError(m.t, err)
	for key, mapping := range mappings {
		if key.Kind == kind && key.ID == v4ID {
			return mapping.TargetID
		}
	}
	return ""
}

// projectID is the project the instance migrated into, "" before a run.
func (m *migration) projectID() string {
	m.t.Helper()
	return m.targetID("project", m.summary.V4.InstanceID)
}

func (m *migration) user(key string) fixtureUser {
	m.t.Helper()
	for _, u := range m.summary.Users {
		if u.Key == key {
			return u
		}
	}
	m.t.Fatalf("no user %q in the fixture", key)
	return fixtureUser{}
}

func (m *migration) idp(name string) fixtureIDP {
	m.t.Helper()
	for _, idp := range m.summary.IDPs {
		if idp.Name == name {
			return idp
		}
	}
	m.t.Fatalf("no IdP %q in the fixture", name)
	return fixtureIDP{}
}

// requireClean fails on an apply that wrote or failed anything.
func requireNoWrites(t *testing.T, report *migratev4.Report) {
	t.Helper()
	for kind, counts := range report.Applied {
		require.Zero(t, counts.Created+counts.Updated+counts.Failed, "%s: %+v", kind, counts)
	}
}

func requireVerified(t *testing.T, report *migratev4.Report) {
	t.Helper()
	require.NotEmpty(t, report.Verify)
	for _, check := range report.Verify {
		require.True(t, check.OK, "verify %s: expected %d, got %d", check.Name, check.Expected, check.Actual)
	}
}
