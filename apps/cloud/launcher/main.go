// Command launcher starts the nextgen server on Vercel's Go runtime.
//
// Vercel's Go framework preset runs one binary with no script in front of
// it, so the binary itself turns the environment a Vercel function receives
// into what the server accepts:
//
//   - The database (database.go). CLOUD_DATABASE_URL (pooled, through
//     PgBouncer) and CLOUD_MIGRATOR_DATABASE_URL (direct) name PlanetScale
//     Postgres; a preview gets a database of its own on the preview cluster,
//     created by its build. The server serves from the pooled URL with a small
//     pgx pool, because a burst starts new instances and every instance holds
//     its own pool, shared by the requests the instance has in flight.
//   - The master key. server.master_keys can only come from a config file
//     (the server ignores NEXTGEN_SERVER_MASTER_KEYS_*), so
//     MASTER_KEY_PEM_B64 and MASTER_KEY_ID become <data_dir>/nextgen.yaml.
//     During a rotation MASTER_KEY_PREVIOUS_PEM_B64 and MASTER_KEY_PREVIOUS_ID
//     add the key the data is still wrapped with, marked for decryption only;
//     the server re-wraps every project key to the current one at startup.
//   - The optional bootstrap admin document, BOOTSTRAP_ADMIN_USER_JSON_B64,
//     becomes a --user-file.
//   - The deployment's shape. The listen address follows PORT, the data dir
//     is the function's writable /tmp, and the console is a service of its own
//     (repo-root vercel.json). The platform project is bootstrapped, logs are
//     JSON and the public base is the deployment's URL unless a NEXTGEN_*
//     variable says otherwise.
//
// A deployment migrates at deploy time, never at startup: build.sh calls
// `launcher migrate` after compiling, which creates a preview's database when
// it is missing and runs the server's migrate command against the direct
// URL. The serving invocation refuses --migrate, so a function cannot change
// a schema by starting. The build also parses everything the function needs
// to start (parseServing), so a deployment whose function could not start
// fails its build and never replaces the deployment that serves. A local run
// without CLOUD_DATABASE_URL (`pnpm run cloud`, scripts/run-cloud.mjs) has no
// build step, so it migrates its own database before serving.
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/zitadel/nextgen/cmd/server"
)

const (
	defaultDataDir = "/tmp/nextgen-data"
	defaultPort    = "8080"

	// consolePath is where vercel.json mounts the console service and the
	// base its build is made for (CONSOLE_BASE_PATH), not the self-hosted
	// server's /ui/console. The server derives the console's URLs (claim,
	// dashboard) from it, so the three must agree; a test holds them together.
	consolePath = "/console"
)

// servingParams size the pgx pool of one function instance and keep pgx off
// named prepared statements, so nothing depends on the pooler tracking them
// across its server connections. A parameter the URL already carries wins.
var servingParams = []struct{ key, value string }{
	{"pool_max_conns", "4"},
	{"default_query_exec_mode", "cache_describe"},
}

var keyIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func main() {
	var args []string
	var err error
	if len(os.Args) > 1 && os.Args[1] == "migrate" {
		args, err = prepareMigration(os.Args[2:])
	} else {
		args, err = prepareServer(os.Args[1:])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "launcher:", err)
		os.Exit(64)
	}
	cmd := server.NewCommand()
	cmd.SetArgs(args)
	if err := cmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "launcher:", err)
		os.Exit(1)
	}
}

// productionBranch is the branch production deploys from: main, unless
// CLOUD_PRODUCTION_BRANCH names the pull request branch that is being tested
// as production before it merges. Vercel does not tell a build which branch
// the project tracks for production, hence the variable.
func productionBranch() string {
	if branch := os.Getenv("CLOUD_PRODUCTION_BRANCH"); branch != "" {
		return branch
	}
	return "main"
}

// deployed reports whether the process runs in a Vercel deployment, where a
// missing database URL is a misconfiguration and not a local run that may
// fall back to the server's SQLite default.
func deployed(env string) bool {
	return env == "production" || env == "preview"
}

// prepareMigration is the deploy-time mode: it creates a preview's database
// when it is missing and points the server's migrate command at the direct
// URL of the deployment's database. Production migrates only from its
// production branch, so a production build of any other branch (a promoted
// preview, which Vercel rebuilds with production variables, or a CLI deploy)
// fails instead of changing the schema.
func prepareMigration(extra []string) ([]string, error) {
	env := os.Getenv("VERCEL_ENV")
	ref := gitRef()
	if env == "production" {
		if branch := productionBranch(); ref != branch {
			return nil, fmt.Errorf("refusing to migrate production from %q: production deploys from %q (CLOUD_PRODUCTION_BRANCH)", ref, branch)
		}
	}
	dsn := os.Getenv(migratorDatabaseURLVar)
	if dsn == "" && deployed(env) {
		return nil, fmt.Errorf("%s must be set for a %s deployment", migratorDatabaseURLVar, env)
	}
	if deployed(env) {
		if err := checkServedThroughPooler(os.Getenv(databaseURLVar), dsn); err != nil {
			return nil, err
		}
		// The function's own configuration, parsed here without writing
		// anything: a missing database URL or a garbled master key would
		// otherwise pass the build and fail every cold start of the deployment
		// that then replaces the one that serves.
		if _, err := parseServing(env); err != nil {
			return nil, fmt.Errorf("the serving function would refuse to start: %w", err)
		}
	}
	if dsn != "" && env == "preview" {
		name, err := previewDatabaseName(ref)
		if err != nil {
			return nil, err
		}
		if err := ensureDatabase(context.Background(), dsn, name, ref, time.Now()); err != nil {
			return nil, err
		}
		if dsn, err = withDatabase(dsn, name); err != nil {
			return nil, err
		}
	}
	if dsn != "" {
		if err := os.Setenv("NEXTGEN_DATABASE_POSTGRES", dsn); err != nil {
			return nil, err
		}
	}
	if err := setDefault("NEXTGEN_SERVER_DATA_DIR", defaultDataDir); err != nil {
		return nil, err
	}
	fmt.Fprintf(os.Stderr, "launcher: migrating the %s database%s\n", describeEnv(env), describeDatabase(dsn))
	return append([]string{"migrate"}, extra...), nil
}

// serving is what the function needs to start, read from the environment
// and nothing else. prepareServer writes it to disk; prepareMigration only
// parses it, so the build refuses what the function would refuse.
type serving struct {
	keyID string
	pem   []string
	// previousID and previousPEM are the key being rotated out, configured
	// for decryption only so the server can re-wrap what it wrapped. Empty
	// outside a rotation.
	previousID  string
	previousPEM []string
	// dsn is the URL the function serves from: the pooled URL with a
	// preview's own database swapped in and the pool parameters added. Empty
	// in a local run without CLOUD_DATABASE_URL, which keeps the server's
	// own configuration.
	dsn string
	// database names dsn's host and database for the log, no credentials.
	database string
	// admin is the bootstrap admin document, nil when none is configured.
	admin []byte
}

func parseServing(env string) (*serving, error) {
	s := &serving{}
	keyB64 := os.Getenv("MASTER_KEY_PEM_B64")
	if keyB64 == "" {
		return nil, errors.New("MASTER_KEY_PEM_B64 must be set (base64 of the master key PEM)")
	}
	s.keyID = os.Getenv("MASTER_KEY_ID")
	if !keyIDPattern.MatchString(s.keyID) {
		return nil, fmt.Errorf("MASTER_KEY_ID must be set and match %s, got %q", keyIDPattern, s.keyID)
	}
	pem, err := decodePEM("MASTER_KEY_PEM_B64", keyB64)
	if err != nil {
		return nil, err
	}
	s.pem = pem

	previousB64, previousID := os.Getenv("MASTER_KEY_PREVIOUS_PEM_B64"), os.Getenv("MASTER_KEY_PREVIOUS_ID")
	if previousB64 != "" || previousID != "" {
		if previousB64 == "" || previousID == "" {
			return nil, errors.New("MASTER_KEY_PREVIOUS_PEM_B64 and MASTER_KEY_PREVIOUS_ID go together: the key being rotated out and its id")
		}
		if !keyIDPattern.MatchString(previousID) {
			return nil, fmt.Errorf("MASTER_KEY_PREVIOUS_ID must match %s, got %q", keyIDPattern, previousID)
		}
		if previousID == s.keyID {
			return nil, fmt.Errorf("MASTER_KEY_PREVIOUS_ID %q is the current key's id; the previous key is the one being rotated out", previousID)
		}
		if s.previousPEM, err = decodePEM("MASTER_KEY_PREVIOUS_PEM_B64", previousB64); err != nil {
			return nil, err
		}
		s.previousID = previousID
	}

	dsn := os.Getenv(databaseURLVar)
	if dsn == "" && deployed(env) {
		return nil, fmt.Errorf("%s must be set for a %s deployment", databaseURLVar, env)
	}
	if dsn != "" && env == "preview" {
		name, err := previewDatabaseName(gitRef())
		if err != nil {
			return nil, err
		}
		if dsn, err = withDatabase(dsn, name); err != nil {
			return nil, err
		}
	}
	if dsn != "" {
		s.database = describeDatabase(dsn)
		if s.dsn, err = withParams(dsn, servingParams); err != nil {
			return nil, err
		}
	}

	if adminB64 := os.Getenv("BOOTSTRAP_ADMIN_USER_JSON_B64"); adminB64 != "" {
		doc, err := base64.StdEncoding.DecodeString(adminB64)
		if err != nil {
			return nil, fmt.Errorf("BOOTSTRAP_ADMIN_USER_JSON_B64 is not base64: %w", err)
		}
		if !strings.Contains(string(doc), `"header"`) || !strings.Contains(string(doc), `"authenticators"`) {
			return nil, errors.New("BOOTSTRAP_ADMIN_USER_JSON_B64 does not decode to a bootstrap user document")
		}
		s.admin = doc
	}
	return s, nil
}

// prepareServer renders the config and bootstrap files from the environment
// and returns the server arguments. Secrets leave the environment once they
// are on disk, so the server process does not carry them.
func prepareServer(extra []string) ([]string, error) {
	for _, arg := range extra {
		if arg == "--migrate" || strings.HasPrefix(arg, "--migrate=") {
			return nil, errors.New("refusing --migrate; migrations run in the build step (launcher migrate), never in the serving function")
		}
	}
	env := os.Getenv("VERCEL_ENV")
	s, err := parseServing(env)
	if err != nil {
		return nil, err
	}
	if s.dsn != "" {
		if err := os.Setenv("NEXTGEN_DATABASE_POSTGRES", s.dsn); err != nil {
			return nil, err
		}
		fmt.Fprintf(os.Stderr, "launcher: serving the %s database%s\n", describeEnv(env), s.database)
	}

	if err := setDefault("NEXTGEN_SERVER_DATA_DIR", defaultDataDir); err != nil {
		return nil, err
	}
	dataDir := os.Getenv("NEXTGEN_SERVER_DATA_DIR")
	// Never write under <data_dir>/master-keys/: anything there is adopted as a key.
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	configPath := filepath.Join(dataDir, "nextgen.yaml")
	if err := os.WriteFile(configPath, renderConfig(s), 0o600); err != nil {
		return nil, err
	}
	_ = os.Unsetenv("MASTER_KEY_PEM_B64")
	_ = os.Unsetenv("MASTER_KEY_PREVIOUS_PEM_B64")
	if s.previousID != "" {
		fmt.Fprintf(os.Stderr, "launcher: master key %s, re-wrapping what %s wrapped; delete MASTER_KEY_PREVIOUS_PEM_B64 and MASTER_KEY_PREVIOUS_ID once this deployment has started\n", s.keyID, s.previousID)
	}

	args := []string{"server", "--config", configPath}
	// A local run serves the server's own database (SQLite unless a
	// NEXTGEN_DATABASE_* variable names another) and no build step migrated
	// it, so the server migrates it before serving. A deployment never does.
	if !deployed(env) && s.dsn == "" {
		args = append(args, "--migrate")
	}

	if s.admin != nil {
		adminPath := filepath.Join(dataDir, "admin-user.json")
		if err := os.WriteFile(adminPath, s.admin, 0o600); err != nil {
			return nil, err
		}
		_ = os.Unsetenv("BOOTSTRAP_ADMIN_USER_JSON_B64")
		args = append(args, "--user-file", adminPath)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}
	// Set, not defaulted: these follow from how Vercel runs the function and
	// how vercel.json routes, so a leftover variable must not move them. The
	// login UI stays on because the console service reads
	// /console/runtime.json, which the server only mounts while one of its
	// UIs is enabled.
	for key, value := range map[string]string{
		"NEXTGEN_SERVER_ADDRESS":         ":" + port,
		"NEXTGEN_SERVER_CONSOLE_ENABLED": "false",
		"NEXTGEN_SERVER_CONSOLE_PATH":    consolePath,
		"NEXTGEN_SERVER_LOGIN_ENABLED":   "true",
	} {
		if err := os.Setenv(key, value); err != nil {
			return nil, err
		}
	}
	// Defaults: what makes this deployment a hosted cloud rather than a
	// self-hosted standalone server. The console signs into the platform
	// project instead of whichever project was created first.
	for key, value := range map[string]string{
		"NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT": "true",
		"NEXTGEN_INSTRUMENTATION_LOG_FORMAT": "json",
		"NEXTGEN_SERVER_PUBLIC_BASE":         publicBase(env),
		// The bootstrap admin administers every project (ADR 075), unless
		// the deployment names its platform operators itself.
		"NEXTGEN_PLATFORM_OPERATORS": bootstrapAdminID(s.admin),
	} {
		if err := setDefault(key, value); err != nil {
			return nil, err
		}
	}
	return append(args, extra...), nil
}

// bootstrapAdminID is the user id the bootstrap admin document declares, or
// empty when there is no document or it names no id.
func bootstrapAdminID(doc []byte) string {
	if doc == nil {
		return ""
	}
	var parsed struct {
		Header struct {
			ID string `json:"id"`
		} `json:"header"`
	}
	if err := json.Unmarshal(doc, &parsed); err != nil {
		return ""
	}
	return parsed.Header.ID
}

// withParams adds each parameter the URL does not set yet. The server also
// accepts the key=value form, but nothing here produces it, so anything but a
// postgres:// URL is refused rather than guessed at.
func withParams(dsn string, params []struct{ key, value string }) (string, error) {
	u, err := parsePostgresURL(dsn)
	if err != nil {
		return "", err
	}
	query := u.Query()
	for _, param := range params {
		if !query.Has(param.key) {
			query.Set(param.key, param.value)
		}
	}
	u.RawQuery = query.Encode()
	return u.String(), nil
}

// publicBase is the origin a browser reaches the deployment at: the
// production domain in production, the branch's stable URL in a preview,
// else the deployment's own URL. It only feeds user-facing links; CSRF and
// WebAuthn derive the origin from the request.
func publicBase(env string) string {
	var host string
	switch env {
	case "production":
		host = os.Getenv("VERCEL_PROJECT_PRODUCTION_URL")
	case "preview":
		host = os.Getenv("VERCEL_BRANCH_URL")
	}
	if host == "" {
		host = os.Getenv("VERCEL_URL")
	}
	if host == "" {
		return ""
	}
	return "https://" + host
}

func describeEnv(env string) string {
	if env == "" {
		return "local"
	}
	return env
}

// describeDatabase names the host and database of a URL, never its
// credentials, so the build and runtime logs show which database a
// deployment uses.
func describeDatabase(dsn string) string {
	u, err := url.Parse(dsn)
	if err != nil || u.Host == "" {
		return ""
	}
	return " at " + u.Host + u.Path
}

// setDefault sets a variable only when the environment leaves it unset or
// empty, so an explicit value keeps winning.
func setDefault(key, value string) error {
	if value == "" || os.Getenv(key) != "" {
		return nil
	}
	return os.Setenv(key, value)
}

// decodePEM returns the key's PEM lines, normalized: no carriage returns, no
// blank lines, no stray indentation, as pasted keys arrive. name is the
// variable the key came from, for the error.
func decodePEM(name, b64 string) ([]string, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("%s is not base64: %w", name, err)
	}
	var lines []string
	for _, line := range strings.Split(strings.ReplaceAll(string(raw), "\r", ""), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) < 2 || !strings.HasPrefix(lines[0], "-----BEGIN ") || !strings.HasPrefix(lines[len(lines)-1], "-----END ") {
		return nil, fmt.Errorf("%s does not decode to a PEM block", name)
	}
	return lines, nil
}

// renderConfig writes the one setting that cannot come from the environment:
// the master keys as YAML block scalars under their ids. The current key
// encrypts; a previous key, during a rotation, only decrypts until the
// server has re-wrapped everything it wrapped.
func renderConfig(s *serving) []byte {
	var b strings.Builder
	b.WriteString("server:\n")
	b.WriteString("  generate_master_key: false\n")
	b.WriteString("  master_keys:\n")
	writeKey := func(id string, pem []string, encrypts bool) {
		fmt.Fprintf(&b, "    %s:\n", id)
		fmt.Fprintf(&b, "      use_for_encryption: %t\n", encrypts)
		b.WriteString("      private_key: |\n")
		for _, line := range pem {
			b.WriteString("        " + line + "\n")
		}
	}
	writeKey(s.keyID, s.pem, true)
	if s.previousID != "" {
		writeKey(s.previousID, s.previousPEM, false)
	}
	return []byte(b.String())
}
