//go:build postgres_integration || spanner_integration

package testdb

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// serverURLEnv names a Postgres server on which every PostgresDSN call gets a
// new, empty database of its own instead of a container of its own: a
// postgres:// URL of a role that may create databases.
//
// CI sets it and starts that server while the job installs
// (.github/scripts/postgres-lane-server.sh). Started from the lane, the
// containers waited for Docker's container create, which waits until the root
// filesystem's dirty pages are on disk: on Depot's EC2 runners 14-22 s, after
// the graph's builds (#1835).
const serverURLEnv = "ZITADEL_TEST_POSTGRES_SERVER_URL"

// serverWait bounds the wait for that server to accept connections: CI starts
// it in the background, so a package can get there first.
const serverWait = 2 * time.Minute

// createPostgresDatabase creates a database on the server at serverURL and
// returns its DSN and a stop func that drops it. The copy is of template0,
// which nobody connects to or changes, so it is empty whatever the server's
// template1 holds.
func createPostgresDatabase(ctx context.Context, serverURL string) (string, func(), error) {
	dsn, err := url.Parse(serverURL)
	if err != nil || (dsn.Scheme != "postgres" && dsn.Scheme != "postgresql") {
		return "", nil, fmt.Errorf("%s must be a postgres:// URL", serverURLEnv)
	}

	start := time.Now()
	conn, err := connectPostgresServer(ctx, serverURL)
	if err != nil {
		return "", nil, err
	}
	defer func() { _ = conn.Close(context.Background()) }()
	waited := time.Since(start)

	name := postgresDatabaseName()
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()+" TEMPLATE template0"); err != nil {
		return "", nil, fmt.Errorf("unable to create postgres test database %s: %w", name, err)
	}
	slog.Info("postgres test database created", "database", name, "server_wait", waited.Round(time.Millisecond))

	dsn.Path = "/" + name
	dsn.RawPath = ""
	return dsn.String(), func() { dropPostgresDatabase(serverURL, name) }, nil
}

// connectPostgresServer connects to the server at serverURL, retrying until it
// accepts connections or serverWait has passed. An error the server itself
// returns, other than that it is still starting up, ends the wait: a wrong
// password does not get better by waiting.
func connectPostgresServer(ctx context.Context, serverURL string) (*pgx.Conn, error) {
	deadline := time.Now().Add(serverWait)
	for {
		attemptCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		conn, err := pgx.Connect(attemptCtx, serverURL)
		cancel()
		if err == nil {
			return conn, nil
		}
		// 57P03 is cannot_connect_now: "the database system is starting up".
		if pgErr := (*pgconn.PgError)(nil); errors.As(err, &pgErr) && pgErr.Code != "57P03" {
			return nil, fmt.Errorf("unable to connect to the postgres server %s names: %w", serverURLEnv, err)
		}
		if ctx.Err() != nil {
			return nil, fmt.Errorf("waiting for the postgres server %s names: %w", serverURLEnv, errors.Join(ctx.Err(), err))
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("the postgres server %s names accepted no connection within %s: %w", serverURLEnv, serverWait, err)
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// dropPostgresDatabase drops a database createPostgresDatabase made. WITH
// (FORCE) ends the connections a caller left open.
func dropPostgresDatabase(serverURL, name string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, serverURL)
	if err == nil {
		defer func() { _ = conn.Close(ctx) }()
		_, err = conn.Exec(ctx, "DROP DATABASE IF EXISTS "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)")
	}
	if err != nil {
		slog.Error("unable to drop postgres test database", "database", name, "err", err)
	}
}

// postgresDatabaseName names a test database after the test binary, e.g.
// itest_stmttest_k7x2q9wd4m, so that a database a killed run left on a shared
// server says which package made it. The random part keeps every name new, so
// no run ever finds a database another run left behind.
func postgresDatabaseName() string {
	pkg := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		return '_'
	}, strings.ToLower(strings.TrimSuffix(filepath.Base(os.Args[0]), ".test")))
	if len(pkg) > 30 {
		pkg = pkg[:30]
	}
	return "itest_" + pkg + "_" + strings.ToLower(rand.Text()[:10])
}
