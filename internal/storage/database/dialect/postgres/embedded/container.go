//go:build postgres_integration || spanner_integration

package embedded

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // registers "pgx" driver for wait.ForSQL
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
)

// containerImage pins Postgres to the rate-limit-free public ECR mirror of the
// official image, matching the embedded-postgres version (PG 18.3). Docker Hub
// throttles anonymous pulls per-IP and GitHub runners share IPs, which would
// reintroduce the transient pull failures this testcontainer migration removes.
const containerImage = "public.ecr.aws/docker/library/postgres:18.3"

// StartContainer starts a Postgres testcontainer and returns a connector plus a
// stop function, mirroring the Spanner emulator bring-up in dialect/spanner/embedded.
// It is used by the postgres integration tests; the server's zero-config default
// connector still uses the embedded binary in start.go. This file is build-tagged
// so testcontainers-go never enters the production server binary.
func StartContainer(ctx context.Context) (database.Connector, func(), error) {
	req := testcontainers.ContainerRequest{
		Image:        containerImage,
		ExposedPorts: []string{"5432/tcp"},
		Env: map[string]string{
			"POSTGRES_USER":     "postgres",
			"POSTGRES_PASSWORD": "postgres",
			"POSTGRES_DB":       "postgres",
		},
		// ForSQL opens a real connection until it succeeds, which rides out the
		// transient restart the postgres image performs at the end of initdb.
		// testcontainers passes the mapped port as "<port>/tcp"; strip the proto
		// so it doesn't leak into the DSN path (which would make the database name
		// "tcp/postgres"). The generous timeout covers slow initdb on cold CI disks.
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
		return nil, nil, fmt.Errorf("unable to start postgres container: %w", err)
	}

	stop := func() { _ = container.Terminate(ctx) }

	host, err := container.Host(ctx)
	if err != nil {
		stop()
		return nil, nil, fmt.Errorf("unable to get container host: %w", err)
	}
	port, err := container.MappedPort(ctx, "5432")
	if err != nil {
		stop()
		return nil, nil, fmt.Errorf("unable to get container port: %w", err)
	}

	dsn := fmt.Sprintf("postgresql://postgres:postgres@%s:%s/postgres?sslmode=disable", host, port.Port())
	connector, err := postgres.DecodeConfig(dsn)
	if err != nil {
		stop()
		return nil, nil, fmt.Errorf("unable to decode postgres config: %w", err)
	}

	slog.Info("postgres testcontainer available", "dsn", dsn)
	return connector, stop, nil
}
