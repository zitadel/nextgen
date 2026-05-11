//go:build spanner_integration

// Package embedded starts a Cloud Spanner GoogleSQL emulator testcontainer for integration tests.
package embedded

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	database_admin "cloud.google.com/go/spanner/admin/database/apiv1"
	"cloud.google.com/go/spanner/admin/database/apiv1/databasepb"
	instance_admin "cloud.google.com/go/spanner/admin/instance/apiv1"
	"cloud.google.com/go/spanner/admin/instance/apiv1/instancepb"
	_ "github.com/jackc/pgx/v5/stdlib" // registers "pgx" driver for wait.ForSQL
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"github.com/zitadel/nextgen/internal/storage/database"
	spannerdb "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	"google.golang.org/api/option"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const (
	testProject  = "test-project"
	testInstance = "test-instance"
	testDatabase = "test-database"
)

// StartEmbedded starts a container running the Cloud Spanner GoogleSQL emulator,
// creates the test instance and database via the admin API, and returns a connector.
func StartEmbedded(ctx context.Context) (database.Connector, func(), error) {
	req := testcontainers.ContainerRequest{
		Image:        "gcr.io/cloud-spanner-emulator/emulator:latest",
		ExposedPorts: []string{"9010/tcp", "9020/tcp"},
		WaitingFor:   wait.ForListeningPort("9010/tcp"),
	}
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("unable to start Spanner emulator container: %w", err)
	}

	stop := func() { _ = container.Terminate(ctx) }

	host, err := container.Host(ctx)
	if err != nil {
		stop()
		return nil, nil, fmt.Errorf("unable to get container host: %w", err)
	}
	grpcPort, err := container.MappedPort(ctx, "9010")
	if err != nil {
		stop()
		return nil, nil, fmt.Errorf("unable to get container gRPC port: %w", err)
	}

	emulatorHost := fmt.Sprintf("%s:%s", host, grpcPort.Port())

	if err := createInstanceAndDatabase(ctx, emulatorHost); err != nil {
		stop()
		return nil, nil, fmt.Errorf("unable to create Spanner instance/database: %w", err)
	}

	// go-sql-spanner reads SPANNER_EMULATOR_HOST to route to the local emulator.
	if err := os.Setenv("SPANNER_EMULATOR_HOST", emulatorHost); err != nil {
		stop()
		return nil, nil, fmt.Errorf("unable to set SPANNER_EMULATOR_HOST: %w", err)
	}
	stopWithEnv := func() {
		_ = os.Unsetenv("SPANNER_EMULATOR_HOST")
		stop()
	}

	dsn := fmt.Sprintf("projects/%s/instances/%s/databases/%s", testProject, testInstance, testDatabase)
	connector, err := spannerdb.DecodeConfig(dsn)
	if err != nil {
		stopWithEnv()
		return nil, nil, fmt.Errorf("unable to decode Spanner config: %w", err)
	}

	slog.Info("Spanner emulator available", "dsn", dsn, "emulator", emulatorHost)
	return connector, stopWithEnv, nil
}

func createInstanceAndDatabase(ctx context.Context, emulatorHost string) error {
	opts := []option.ClientOption{
		option.WithEndpoint(emulatorHost),
		option.WithoutAuthentication(), // TODO(IAM-Marco): In prod should use authentication, maybe read from env vars
		option.WithGRPCDialOption(grpc.WithTransportCredentials(insecure.NewCredentials())), // TODO(IAM-Marco): For prod, should use authentication
	}

	// The TCP port becomes reachable before the gRPC server finishes initializing.
	// Retry with backoff until the instance admin call succeeds.
	var lastErr error
	for attempt := range 10 {
		lastErr = tryCreateInstanceAndDatabase(ctx, opts)
		if lastErr == nil {
			return nil
		}
		delay := time.Duration(attempt+1) * 200 * time.Millisecond
		slog.Info("Spanner emulator not ready, retrying", "attempt", attempt+1, "delay", delay, "err", lastErr)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
	return lastErr
}

func tryCreateInstanceAndDatabase(ctx context.Context, opts []option.ClientOption) error {
	// Create instance
	instClient, err := instance_admin.NewInstanceAdminClient(ctx, opts...)
	if err != nil {
		return fmt.Errorf("instance admin client: %w", err)
	}
	defer instClient.Close()

	instOp, err := instClient.CreateInstance(ctx, &instancepb.CreateInstanceRequest{
		Parent:     "projects/" + testProject,
		InstanceId: testInstance,
		Instance: &instancepb.Instance{
			Config:      "projects/" + testProject + "/instanceConfigs/emulator-config",
			DisplayName: testInstance,
			NodeCount:   1,
		},
	})
	if err != nil {
		return fmt.Errorf("create instance: %w", err)
	}
	if _, err = instOp.Wait(ctx); err != nil {
		return fmt.Errorf("wait for instance: %w", err)
	}

	// Create database
	dbClient, err := database_admin.NewDatabaseAdminClient(ctx, opts...)
	if err != nil {
		return fmt.Errorf("database admin client: %w", err)
	}
	defer dbClient.Close()

	dbOp, err := dbClient.CreateDatabase(ctx, &databasepb.CreateDatabaseRequest{
		// TODO(IAM-Marco): This should be read from config
		Parent:          "projects/" + testProject + "/instances/" + testInstance,
		CreateStatement: "CREATE DATABASE `" + testDatabase + "`",
	})
	if err != nil {
		return fmt.Errorf("create database: %w", err)
	}
	if _, err = dbOp.Wait(ctx); err != nil {
		return fmt.Errorf("wait for database: %w", err)
	}

	return nil
}
