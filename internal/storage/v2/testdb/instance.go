//go:build spanner_integration

package testdb

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"strings"

	database_admin "cloud.google.com/go/spanner/admin/database/apiv1"
	"cloud.google.com/go/spanner/admin/database/apiv1/databasepb"
	"google.golang.org/api/option"
)

// InstanceEnv is the environment variable that points the integration suites at
// a shared Spanner test instance. Its value is an instance path of the form
// projects/<project>/instances/<instance>. When set, the suites provision a
// uniquely named database on that instance (created before, dropped after)
// instead of starting the emulator.
const InstanceEnv = "ZITADEL_TEST_SPANNER_INSTANCE"

// Provision creates a fresh, uniquely named database on the instance named by
// InstanceEnv and returns its DSN plus a teardown func that drops the database.
// Authentication uses Application Default Credentials (the caller is expected
// to have run `gcloud auth application-default login` locally or be
// authenticated via Workload Identity Federation in CI). The returned drop func
// is always non-nil and safe to defer.
func Provision(ctx context.Context) (string, func(), error) {
	project, instance, err := parseInstancePath(os.Getenv(InstanceEnv))
	if err != nil {
		return "", func() {}, err
	}

	dbID := uniqueDatabaseID()
	if err := CreateDatabase(ctx, project, instance, dbID); err != nil {
		return "", func() {}, fmt.Errorf("unable to create Spanner test database %q: %w", dbID, err)
	}

	drop := func() {
		// context.Background so teardown still runs when the test context is done.
		if err := DropDatabase(context.Background(), project, instance, dbID); err != nil {
			slog.Error("unable to drop Spanner test database", slog.String("database", dbID), slog.Any("err", err))
		}
	}

	dsn := fmt.Sprintf("projects/%s/instances/%s/databases/%s", project, instance, dbID)
	slog.Info("provisioned Spanner test database", "dsn", dsn, "run_id", os.Getenv("GITHUB_RUN_ID"))
	return dsn, drop, nil
}

// CreateDatabase creates an empty database on the given instance. opts are
// passed to the admin client; pass none to use Application Default Credentials
// (real instance), or the emulator's insecure/no-auth options for the emulator.
func CreateDatabase(ctx context.Context, project, instance, dbID string, opts ...option.ClientOption) error {
	client, err := database_admin.NewDatabaseAdminClient(ctx, opts...)
	if err != nil {
		return fmt.Errorf("database admin client: %w", err)
	}
	defer client.Close()

	op, err := client.CreateDatabase(ctx, &databasepb.CreateDatabaseRequest{
		Parent:          fmt.Sprintf("projects/%s/instances/%s", project, instance),
		CreateStatement: "CREATE DATABASE `" + dbID + "`",
	})
	if err != nil {
		return fmt.Errorf("create database: %w", err)
	}
	if _, err = op.Wait(ctx); err != nil {
		return fmt.Errorf("wait for database: %w", err)
	}
	return nil
}

// DropDatabase drops the database on the given instance. opts follow the same
// convention as CreateDatabase.
func DropDatabase(ctx context.Context, project, instance, dbID string, opts ...option.ClientOption) error {
	client, err := database_admin.NewDatabaseAdminClient(ctx, opts...)
	if err != nil {
		return fmt.Errorf("database admin client: %w", err)
	}
	defer client.Close()

	err = client.DropDatabase(ctx, &databasepb.DropDatabaseRequest{
		Database: fmt.Sprintf("projects/%s/instances/%s/databases/%s", project, instance, dbID),
	})
	if err != nil {
		return fmt.Errorf("drop database: %w", err)
	}
	return nil
}

// parseInstancePath validates and splits an instance path of the form
// projects/<project>/instances/<instance>.
func parseInstancePath(path string) (project, instance string, err error) {
	parts := strings.Split(path, "/")
	if len(parts) != 4 || parts[0] != "projects" || parts[2] != "instances" || parts[1] == "" || parts[3] == "" {
		return "", "", fmt.Errorf("%s must be of the form projects/<project>/instances/<instance>, got %q", InstanceEnv, path)
	}
	return parts[1], parts[3], nil
}

// uniqueDatabaseID returns a Spanner database ID unique to this test process.
// Spanner database IDs must be 2-30 chars, start with a lowercase letter, and
// contain only [a-z0-9_-] with no trailing hyphen. A random suffix is always
// included so parallel test binaries in the same CI run never collide; the run
// id is embedded when present to make orphaned databases traceable for cleanup.
func uniqueDatabaseID() string {
	suffix := randomToken()
	if runID := os.Getenv("GITHUB_RUN_ID"); runID != "" {
		return clampDatabaseID(fmt.Sprintf("itest_%s_%s", runID, suffix))
	}
	return fmt.Sprintf("itest_%s", suffix)
}

// randomToken returns 8 lowercase hex characters.
func randomToken() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand should never fail; fall back to a fixed token so the run
		// surfaces a create-database conflict rather than a panic here.
		return "00000000"
	}
	return hex.EncodeToString(b)
}

// clampDatabaseID trims to the 30-char Spanner limit without leaving a trailing
// hyphen.
func clampDatabaseID(id string) string {
	if len(id) > 30 {
		id = id[:30]
	}
	return strings.TrimRight(id, "-")
}
