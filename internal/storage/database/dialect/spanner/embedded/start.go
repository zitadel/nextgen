//go:build spanner_integration

// Package embedded starts a Spanner emulator + PGAdapter testcontainer for integration tests.
package embedded

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib" // registers "pgx" driver for wait.ForSQL
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

// StartEmbedded starts a container running the Spanner emulator bundled with PGAdapter.
// The image exposes the PostgreSQL wire protocol on port 5432 and pre-creates a
// test project/instance/database so no separate admin setup is required.
//
// Returns a connector, a stop function, and any startup error.
func StartEmbedded(ctx context.Context) (database.Connector, func(), error) {
	req := testcontainers.ContainerRequest{
		Image:        "gcr.io/cloud-spanner-pg-adapter/pgadapter-emulator:latest",
		ExposedPorts: []string{"5432/tcp"},
		WaitingFor: wait.ForSQL("5432/tcp", "pgx", func(host, port string) string {
			// port is "NNNN/tcp" — strip the protocol suffix before building the URL
			port, _, _ = strings.Cut(port, "/")
			return fmt.Sprintf(
				"postgresql://user:secret@%s:%s/projects/test-project/instances/test-instance/databases/test-database?sslmode=disable",
				host, port,
			)
		}),
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
	port, err := container.MappedPort(ctx, "5432")
	if err != nil {
		stop()
		return nil, nil, fmt.Errorf("unable to get container port: %w", err)
	}

	// The pgadapter-emulator image pre-creates a Spanner database reachable at this path.
	url := fmt.Sprintf(
		"postgresql://user:secret@%s:%s/projects/test-project/instances/test-instance/databases/test-database?sslmode=disable",
		host, port.Port(),
	)
	connector, err := spanner.DecodeConfig(url)
	if err != nil {
		stop()
		return nil, nil, fmt.Errorf("unable to decode Spanner config: %w", err)
	}
	slog.Info("Test DB available at", "url", url)
	return connector, stop, nil
}
