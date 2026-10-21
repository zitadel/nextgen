package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// The database contract, the same variable names in both Vercel targets:
//
//   - CLOUD_DATABASE_URL is the pooled URL (PgBouncer, port 6432) the server
//     serves from.
//   - CLOUD_MIGRATOR_DATABASE_URL is the direct URL (port 5432) the build
//     migrates through: migrations hold a session advisory lock, which a
//     transaction pooler cannot keep.
//
// In production both name the production database. In a preview both name
// the preview cluster's base database (postgres) with a role that may create
// databases, and the launcher swaps in the preview's own database: one per
// Git branch, created by the build when it is missing.
const (
	databaseURLVar         = "CLOUD_DATABASE_URL"
	migratorDatabaseURLVar = "CLOUD_MIGRATOR_DATABASE_URL"
)

// buildRef is the Git branch the binary was built from, stamped in by
// build.sh. A CLI deployment carries no Git metadata at runtime, so the
// serving function would otherwise not know its preview database; with the
// stamp, the build and the function always agree on it.
var buildRef string

// gitRef is the branch this deployment was built from.
func gitRef() string {
	if buildRef != "" {
		return buildRef
	}
	return os.Getenv("VERCEL_GIT_COMMIT_REF")
}

var notIdentifierChar = regexp.MustCompile(`[^a-z0-9_]+`)

// previewSchemaEpoch is mixed into the preview database name hash. Bump it
// when sticky preview databases cannot remigrate (goose out-of-order after a
// migration renumber) so the next deploy gets a fresh empty database. The
// orphaned name is left for later cleanup.
const previewSchemaEpoch = "2"

// previewDatabaseName is the database of a preview: one per Git branch, so a
// branch keeps its data across pushes and from before its pull request
// exists. Postgres names hold 63 bytes; the readable part is cut short and a
// hash of the full branch name keeps two long names apart.
func previewDatabaseName(ref string) (string, error) {
	if ref == "" {
		return "", errors.New("a preview needs its Git branch (VERCEL_GIT_COMMIT_REF) to pick its database")
	}
	slug := strings.Trim(notIdentifierChar.ReplaceAllString(strings.ToLower(ref), "_"), "_")
	if len(slug) > 40 {
		slug = strings.TrimRight(slug[:40], "_")
	}
	sum := sha256.Sum256([]byte(previewSchemaEpoch + "\n" + ref))
	hash := hex.EncodeToString(sum[:4])
	if slug == "" {
		return "preview_" + hash, nil
	}
	return "preview_" + slug + "_" + hash, nil
}

// withDatabase points a postgres:// URL at another database on the same
// server, keeping the credentials and parameters.
func withDatabase(dsn, name string) (string, error) {
	u, err := parsePostgresURL(dsn)
	if err != nil {
		return "", err
	}
	u.Path = "/" + name
	u.RawPath = ""
	return u.String(), nil
}

func parsePostgresURL(dsn string) (*url.URL, error) {
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		return nil, errors.New("database URLs must be postgres:// or postgresql:// URLs")
	}
	return u, nil
}

// checkServedThroughPooler fails a build whose serving URL reaches the same
// endpoint as its migrator URL, which is the direct port: a burst starts new
// instances, every instance holds its own connections, and without the
// pooler a burst exhausts the cluster's connection slots within seconds.
// Instances that find none fail to start.
func checkServedThroughPooler(servingDSN, migratorDSN string) error {
	serving, err := url.Parse(servingDSN)
	if err != nil || servingDSN == "" {
		return nil // prepareServer reports a missing or malformed URL
	}
	migrator, err := url.Parse(migratorDSN)
	if err != nil {
		return nil
	}
	if serving.Host != "" && serving.Host == migrator.Host {
		return fmt.Errorf("%s reaches %s like %s: serve through PgBouncer (PlanetScale: port 6432), migrate on the direct port (5432)",
			databaseURLVar, serving.Host, migratorDatabaseURLVar)
	}
	return nil
}

// ensureDatabase is ensurePreviewDatabase; tests replace it.
var ensureDatabase = ensurePreviewDatabase

// dropDatabase is dropPreviewDatabase; tests replace it.
var dropDatabase = dropPreviewDatabase

// ensurePreviewDatabase creates the preview's database unless it exists and
// stamps it with the branch and the time of this deployment, so a cleanup can
// later drop what no deployment touched for a while. The connecting role
// needs CREATEDB or membership in PlanetScale's default role (see
// createDatabase); either way it may change the database, which the
// migrations need (they set options on it). A failed stamp is logged, not
// fatal: it only feeds the cleanup.
func ensurePreviewDatabase(ctx context.Context, baseDSN, name, ref string, now time.Time) error {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	config, err := pgx.ParseConfig(baseDSN)
	if err != nil {
		return fmt.Errorf("parse %s: %w", migratorDatabaseURLVar, err)
	}
	// A pgxpool parameter would reach Postgres as an unknown setting.
	for key := range config.RuntimeParams {
		if strings.HasPrefix(key, "pool_") {
			delete(config.RuntimeParams, key)
		}
	}
	conn, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return fmt.Errorf("connect to the preview cluster: %w", err)
	}
	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var exists bool
	if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", name).Scan(&exists); err != nil {
		return fmt.Errorf("look up preview database %s: %w", name, err)
	}
	identifier := pgx.Identifier{name}.Sanitize()
	if !exists {
		err := createDatabase(ctx, conn, identifier)
		var pgErr *pgconn.PgError
		switch {
		case err == nil:
			fmt.Fprintf(os.Stderr, "launcher: created preview database %s\n", name)
		case errors.As(err, &pgErr) && pgErr.Code == "42P04":
			// duplicate_database: a concurrent build of the same branch won.
		default:
			return fmt.Errorf("create preview database %s: %w", name, err)
		}
	}

	stamp, err := json.Marshal(map[string]string{"branch": ref, "deployed_at": now.UTC().Format(time.RFC3339)})
	if err != nil {
		return err
	}
	if _, err := conn.Exec(ctx, "COMMENT ON DATABASE "+identifier+" IS "+quoteLiteral(string(stamp))); err != nil {
		fmt.Fprintf(os.Stderr, "launcher: could not stamp preview database %s: %v\n", name, err)
	}
	return nil
}

// dropPreviewDatabase drops a preview database so the next ensurePreviewDatabase
// call recreates it empty. Used when goose refuses to migrate because the
// sticky preview still carries an older version set (for example after a
// migration was renumbered on the branch). Production never calls this.
//
// Preview databases are often owned by adminRole (createDatabase elevates when
// the migrator lacks CREATEDB), so DROP mirrors that elevation: try as the
// connecting role, then once as adminRole on insufficient_privilege.
func dropPreviewDatabase(ctx context.Context, baseDSN, name string) error {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	config, err := pgx.ParseConfig(baseDSN)
	if err != nil {
		return fmt.Errorf("parse %s: %w", migratorDatabaseURLVar, err)
	}
	for key := range config.RuntimeParams {
		if strings.HasPrefix(key, "pool_") {
			delete(config.RuntimeParams, key)
		}
	}
	conn, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return fmt.Errorf("connect to the preview cluster: %w", err)
	}
	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	identifier := pgx.Identifier{name}.Sanitize()
	if err := dropDatabaseAsConnectingOrAdmin(ctx, conn, identifier); err != nil {
		return fmt.Errorf("drop preview database %s: %w", name, err)
	}
	fmt.Fprintf(os.Stderr, "launcher: dropped preview database %s to remigrate from an empty schema\n", name)
	return nil
}

func dropDatabaseAsConnectingOrAdmin(ctx context.Context, conn *pgx.Conn, identifier string) error {
	drop := "DROP DATABASE IF EXISTS " + identifier + " WITH (FORCE)"
	// Prefer adminRole first: createDatabase often owns the DB as postgres.
	if _, setErr := conn.Exec(ctx, "SET ROLE "+pgx.Identifier{adminRole}.Sanitize()); setErr == nil {
		_, err := conn.Exec(ctx, drop)
		_, _ = conn.Exec(context.WithoutCancel(ctx), "RESET ROLE")
		if err == nil {
			return nil
		}
		// Fall through and try as the connecting role.
	}
	_, err := conn.Exec(ctx, drop)
	return err
}

// adminRole is PlanetScale's default role. A dashboard role that inherits it
// may create databases through that membership.
const adminRole = "postgres"

// createDatabase runs CREATE DATABASE as the connecting role and, when that
// role lacks the CREATEDB attribute, once more as adminRole. Postgres never
// passes attributes on through membership, so a role that may create
// databases only as a member of the default role has to act as it for this
// one statement. Either way the connecting role can reach the result: it owns
// the database or is a member of its owner.
func createDatabase(ctx context.Context, conn *pgx.Conn, identifier string) error {
	_, err := conn.Exec(ctx, "CREATE DATABASE "+identifier)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "42501" { // insufficient_privilege
		return err
	}
	if _, setErr := conn.Exec(ctx, "SET ROLE "+pgx.Identifier{adminRole}.Sanitize()); setErr != nil {
		return fmt.Errorf("%w; the role has no CREATEDB and cannot act as %s: %v", err, adminRole, setErr)
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), "RESET ROLE") }()
	_, err = conn.Exec(ctx, "CREATE DATABASE "+identifier)
	return err
}

// quoteLiteral quotes a string as a SQL literal for a statement that takes no
// parameters, such as COMMENT. Postgres reads backslashes literally under
// standard_conforming_strings, its default since 9.1.
func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}
