//go:build postgres_integration || spanner_integration

package embedded

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver used by wait.ForSQL
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
	v2postgres "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres"
)

// containerImage pins Postgres to the rate-limit-free public ECR mirror of the
// official image, matching embedded-postgres's PG 18.3 version.
const containerImage = "public.ecr.aws/docker/library/postgres:18.3"

const containerStartAttempts = 3

// StartContainer starts a Postgres testcontainer and returns a connected v2
// pool plus a stop function.
func StartContainer(ctx context.Context) (v2database.Pool, func(), error) {
	pool, _, stop, err := StartContainerWithDSN(ctx)
	return pool, stop, err
}

// StartContainerWithDSN is like [StartContainer] but also returns the
// container's connection DSN for database/sql clients.
func StartContainerWithDSN(ctx context.Context) (v2database.Pool, string, func(), error) {
	req := testcontainers.ContainerRequest{
		Image:        containerImage,
		ExposedPorts: []string{"5432/tcp"},
		Env: map[string]string{
			"POSTGRES_USER":     "postgres",
			"POSTGRES_PASSWORD": "postgres",
			"POSTGRES_DB":       "postgres",
		},
		WaitingFor: wait.ForSQL("5432/tcp", "pgx", func(host, port string) string {
			mapped, _, _ := strings.Cut(port, "/")
			return fmt.Sprintf("postgresql://postgres:postgres@%s:%s/postgres?sslmode=disable", host, mapped)
		}).WithStartupTimeout(120 * time.Second),
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		if container != nil {
			_ = container.Terminate(context.Background())
		}
		return nil, "", nil, fmt.Errorf("unable to start postgres container: %w", err)
	}

	stop := func() { _ = container.Terminate(context.Background()) }

	host, err := container.Host(ctx)
	if err != nil {
		stop()
		return nil, "", nil, fmt.Errorf("unable to get container host: %w", err)
	}
	port, err := container.MappedPort(ctx, "5432")
	if err != nil {
		stop()
		return nil, "", nil, fmt.Errorf("unable to get container port: %w", err)
	}

	dsn := fmt.Sprintf("postgresql://postgres:postgres@%s:%s/postgres?sslmode=disable", host, port.Port())
	dialect, err := v2postgres.DecodeConfig(dsn)
	if err != nil {
		stop()
		return nil, "", nil, fmt.Errorf("unable to decode postgres config: %w", err)
	}
	pool, err := dialect.Connect(ctx)
	if err != nil {
		stop()
		return nil, "", nil, err
	}
	slog.Info("postgres testcontainer available", "dsn", dsn)
	return pool, dsn, stop, nil
}
