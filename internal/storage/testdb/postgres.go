//go:build postgres_integration || spanner_integration

// Package testdb starts databases for v2 storage integration tests and returns
// DSNs only. It must not import dialect packages — those packages' TestMains
// need this bring-up without creating an import cycle.
package testdb

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver used by wait.ForSQL
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// containerImage pins Postgres to the rate-limit-free public ECR mirror of the
// official postgres:18.3 image. Docker Hub throttles anonymous pulls per-IP
// and GitHub runners share IPs.
const containerImage = "public.ecr.aws/docker/library/postgres:18.3"

const containerStartAttempts = 3

// PostgresDSN returns a Postgres DSN and stop func. Prefer
// ZITADEL_TEST_POSTGRES_URL; otherwise start a testcontainer.
func PostgresDSN(ctx context.Context) (string, func(), error) {
	if url := os.Getenv("ZITADEL_TEST_POSTGRES_URL"); url != "" {
		return url, func() {}, nil
	}

	var err error
	for attempt := 1; attempt <= containerStartAttempts; attempt++ {
		var dsn string
		var stop func()
		dsn, stop, err = startPostgresContainerOnce(ctx)
		if err == nil {
			return dsn, stop, nil
		}
		if attempt == containerStartAttempts {
			break
		}
		delay := time.Duration(attempt) * 2 * time.Second
		slog.Info("postgres testcontainer start failed, retrying",
			"attempt", attempt, "max_attempts", containerStartAttempts, "delay", delay, "err", err)
		select {
		case <-ctx.Done():
			return "", nil, fmt.Errorf("postgres container start interrupted: %w", ctx.Err())
		case <-time.After(delay):
		}
	}
	return "", nil, fmt.Errorf("postgres container failed after %d attempts: %w", containerStartAttempts, err)
}

func startPostgresContainerOnce(ctx context.Context) (string, func(), error) {
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
		return "", nil, fmt.Errorf("unable to start postgres container: %w", err)
	}

	stop := func() { _ = container.Terminate(context.Background()) }

	host, err := container.Host(ctx)
	if err != nil {
		stop()
		return "", nil, fmt.Errorf("unable to get container host: %w", err)
	}
	port, err := container.MappedPort(ctx, "5432")
	if err != nil {
		stop()
		return "", nil, fmt.Errorf("unable to get container port: %w", err)
	}

	dsn := fmt.Sprintf("postgresql://postgres:postgres@%s:%s/postgres?sslmode=disable", host, port.Port())
	slog.Info("postgres testcontainer available", "dsn", dsn)
	return dsn, stop, nil
}
