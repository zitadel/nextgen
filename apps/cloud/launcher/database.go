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

	"github.com/zitadel/nextgen/internal/storage/dialect/postgres/migration"
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
// build-launcher.sh. A CLI deployment carries no Git metadata at runtime,
// so the serving function would otherwise not know its preview database;
// with the stamp, the build and the function always agree on it.
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
// when sticky preview databases cannot remigrate (goose out-of-order or a
// renumber that left columns applied under a reused version) so the next
// deploy gets a fresh empty database. The orphaned name is left for later
// cleanup.
const previewSchemaEpoch = "3"

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

// dropDatabase is dropPreviewDatabases; tests replace it.
var dropDatabase = dropPreviewDatabases

// listDatabases is listPreviewDatabases; tests replace it.
var listDatabases = listPreviewDatabases

// connectPreviewCluster opens one connection through a preview's base URL.
func connectPreviewCluster(ctx context.Context, baseDSN string) (*pgx.Conn, error) {
	config, err := pgx.ParseConfig(baseDSN)
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", migratorDatabaseURLVar, err)
	}
	// A pgxpool parameter would reach Postgres as an unknown setting.
	for key := range config.RuntimeParams {
		if strings.HasPrefix(key, "pool_") {
			delete(config.RuntimeParams, key)
		}
	}
	conn, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("connect to the preview cluster: %w", err)
	}
	return conn, nil
}

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

	conn, err := connectPreviewCluster(ctx, baseDSN)
	if err != nil {
		return err
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

// dropPreviewDatabases drops the preview databases named that exist, through
// one connection. runMigrate drops one so the next ensurePreviewDatabase call
// recreates it empty, when goose refuses to migrate because the sticky
// preview still carries an older version set (for example after a migration
// was renumbered on the branch); runDropPreview drops a merged branch's, or
// every idle one, for good. Production never calls this. A failed drop does
// not stop the others; the errors come back together.
//
// Preview databases are often owned by adminRole (createDatabase elevates when
// the migrator lacks CREATEDB), so DROP mirrors that elevation: try as the
// connecting role, then once as adminRole on insufficient_privilege.
func dropPreviewDatabases(ctx context.Context, baseDSN string, names ...string) error {
	connectCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	conn, err := connectPreviewCluster(connectCtx, baseDSN)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()
	if err := checkPreviewClusterBase(connectCtx, conn); err != nil {
		return err
	}

	var errs []error
	for _, name := range names {
		if err := dropPreviewDatabase(ctx, conn, name); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func dropPreviewDatabase(ctx context.Context, conn *pgx.Conn, name string) error {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	var exists bool
	if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", name).Scan(&exists); err != nil {
		return fmt.Errorf("look up preview database %s: %w", name, err)
	}
	if !exists {
		fmt.Fprintf(os.Stderr, "launcher: no preview database %s to drop\n", name)
		return nil
	}
	identifier := pgx.Identifier{name}.Sanitize()
	if err := dropDatabaseAsConnectingOrAdmin(ctx, conn, identifier); err != nil {
		return fmt.Errorf("drop preview database %s: %w", name, err)
	}
	fmt.Fprintf(os.Stderr, "launcher: dropped preview database %s\n", name)
	return nil
}

// previewDatabase is a preview database and the stamp its last deployment
// left (ensurePreviewDatabase), empty when it has none.
type previewDatabase struct {
	name, stamp string
}

// listPreviewDatabases lists the preview cluster's preview databases with
// their stamps, after the same check a drop makes.
func listPreviewDatabases(ctx context.Context, baseDSN string) ([]previewDatabase, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	conn, err := connectPreviewCluster(ctx, baseDSN)
	if err != nil {
		return nil, err
	}
	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()
	if err := checkPreviewClusterBase(ctx, conn); err != nil {
		return nil, err
	}

	rows, err := conn.Query(ctx, `SELECT datname, coalesce(shobj_description(oid, 'pg_database'), '')
		FROM pg_database WHERE datname LIKE 'preview\_%' ORDER BY datname`)
	if err != nil {
		return nil, fmt.Errorf("list preview databases: %w", err)
	}
	databases, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (previewDatabase, error) {
		var db previewDatabase
		err := row.Scan(&db.name, &db.stamp)
		return db, err
	})
	if err != nil {
		return nil, fmt.Errorf("list preview databases: %w", err)
	}
	return databases, nil
}

// checkPreviewClusterBase refuses a connection to a database that holds the
// server's schema, before anything is listed or dropped through it. A drop has to
// connect to the preview cluster's base database, which holds no deployment;
// production's database holds its schema. The value is easy to take from
// the wrong place: Vercel's Production and Preview targets name the variable
// alike, and the PlanetScale database `preview` has a production branch of
// its own (`main`), which is still the preview cluster.
func checkPreviewClusterBase(ctx context.Context, conn *pgx.Conn) error {
	var deployment bool
	if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1)", migration.SchemaName).Scan(&deployment); err != nil {
		return fmt.Errorf("look up the %s schema: %w", migration.SchemaName, err)
	}
	if deployment {
		return fmt.Errorf("%s reaches database %s, which holds the %s schema: it must name the preview cluster's base database, Vercel's Preview value, never Production's",
			migratorDatabaseURLVar, conn.Config().Database, migration.SchemaName)
	}
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
