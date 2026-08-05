//go:build spanner_integration

package testdb

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	instance_admin "cloud.google.com/go/spanner/admin/instance/apiv1"
	"cloud.google.com/go/spanner/admin/instance/apiv1/instancepb"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"google.golang.org/api/option"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const (
	testProject  = "test-project"
	testInstance = "test-instance"
	testDatabase = "test-database"
)

// SpannerDSN returns a Spanner database DSN for integration tests. Precedence:
// if ZITADEL_TEST_SPANNER_INSTANCE is set it provisions a fresh, uniquely named
// database on that shared instance (the returned stop drops it); else if
// ZITADEL_TEST_SPANNER_URL is set it returns that DSN; otherwise it starts a
// Cloud Spanner emulator testcontainer, creates the test instance/database,
// sets SPANNER_EMULATOR_HOST, and returns the database DSN plus a stop func
// that clears the env var and terminates the container.
func SpannerDSN(ctx context.Context) (string, func(), error) {
	if strings.TrimSpace(os.Getenv(instanceEnv)) != "" {
		return provision(ctx)
	}
	if url := os.Getenv("ZITADEL_TEST_SPANNER_URL"); url != "" {
		return url, func() {}, nil
	}

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
		return "", nil, fmt.Errorf("unable to start Spanner emulator container: %w", err)
	}

	stop := func() { _ = container.Terminate(context.Background()) }

	host, err := container.Host(ctx)
	if err != nil {
		stop()
		return "", nil, fmt.Errorf("unable to get container host: %w", err)
	}
	grpcPort, err := container.MappedPort(ctx, "9010")
	if err != nil {
		stop()
		return "", nil, fmt.Errorf("unable to get container gRPC port: %w", err)
	}

	emulatorHost := fmt.Sprintf("%s:%s", host, grpcPort.Port())
	if err := createInstanceAndDatabase(ctx, emulatorHost); err != nil {
		stop()
		return "", nil, fmt.Errorf("unable to create Spanner instance/database: %w", err)
	}

	if err := os.Setenv("SPANNER_EMULATOR_HOST", emulatorHost); err != nil {
		stop()
		return "", nil, fmt.Errorf("unable to set SPANNER_EMULATOR_HOST: %w", err)
	}

	stopWithEnv := func() {
		_ = os.Unsetenv("SPANNER_EMULATOR_HOST")
		stop()
	}

	dsn := fmt.Sprintf("projects/%s/instances/%s/databases/%s", testProject, testInstance, testDatabase)
	slog.Info("Spanner emulator available", "dsn", dsn, "emulator", emulatorHost)
	return dsn, stopWithEnv, nil
}

func createInstanceAndDatabase(ctx context.Context, emulatorHost string) error {
	opts := []option.ClientOption{
		option.WithEndpoint(emulatorHost),
		option.WithoutAuthentication(),
		option.WithGRPCDialOption(grpc.WithTransportCredentials(insecure.NewCredentials())),
	}

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

	return createDatabase(ctx, testProject, testInstance, testDatabase, opts...)
}
