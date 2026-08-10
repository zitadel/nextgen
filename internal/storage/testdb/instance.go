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

// instanceEnv names a shared Spanner instance
// (projects/<project>/instances/<instance>). When set, suites provision a
// uniquely named database on that instance instead of starting the emulator.
//
// Nothing sets this today: CI runs the emulator only, because its
// one-transaction-at-a-time limit is what forces the aborts that keep the
// abort-retry path honest (#788). This path is kept, unwired, so the real
// instance can be brought back quickly if the emulator turns out not to hold.
// Re-wiring is CI-side only (restore the Workload Identity Federation auth step
// and set this variable); no Go changes needed. Removal is tracked in #793.
const instanceEnv = "ZITADEL_TEST_SPANNER_INSTANCE"

func provision(ctx context.Context) (string, func(), error) {
	project, instance, err := parseInstancePath(strings.TrimSpace(os.Getenv(instanceEnv)))
	if err != nil {
		return "", func() {}, err
	}

	dbID := uniqueDatabaseID()
	if err := createDatabase(ctx, project, instance, dbID); err != nil {
		return "", func() {}, fmt.Errorf("unable to create Spanner test database %q: %w", dbID, err)
	}

	drop := func() {
		if err := dropDatabase(context.Background(), project, instance, dbID); err != nil {
			slog.Error("unable to drop Spanner test database", "database", dbID, "err", err)
		}
	}

	dsn := fmt.Sprintf("projects/%s/instances/%s/databases/%s", project, instance, dbID)
	slog.Info("provisioned Spanner test database", "dsn", dsn, "run_id", os.Getenv("GITHUB_RUN_ID"))
	return dsn, drop, nil
}

func createDatabase(ctx context.Context, project, instance, dbID string, opts ...option.ClientOption) error {
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

func dropDatabase(ctx context.Context, project, instance, dbID string, opts ...option.ClientOption) error {
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

func parseInstancePath(path string) (project, instance string, err error) {
	parts := strings.Split(path, "/")
	if len(parts) != 4 || parts[0] != "projects" || parts[2] != "instances" || parts[1] == "" || parts[3] == "" {
		return "", "", fmt.Errorf("%s must be of the form projects/<project>/instances/<instance>, got %q", instanceEnv, path)
	}
	return parts[1], parts[3], nil
}

// uniqueDatabaseID builds a Spanner database ID (2–30 chars, [a-z0-9_-], no
// trailing hyphen). Entropy comes first so a 30-char clamp never drops
// uniqueness when GITHUB_RUN_ID is long; a short run-id suffix keeps orphans
// traceable when present.
func uniqueDatabaseID() string {
	id := "itest_" + randomToken()
	if runID := os.Getenv("GITHUB_RUN_ID"); runID != "" {
		budget := 30 - len(id) - 1
		if budget > 0 {
			if len(runID) > budget {
				runID = runID[len(runID)-budget:]
			}
			id = id + "_" + runID
		}
	}
	return strings.TrimRight(id, "-")
}

func randomToken() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	return hex.EncodeToString(b)
}
