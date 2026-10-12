// Command launcher starts the nextgen server on Vercel's Go runtime.
//
// Vercel's Go framework preset runs one binary with no script in front of
// it, so the binary itself turns the environment a Vercel function receives
// into what the server accepts:
//
//   - The database. Neon's Vercel integration injects DATABASE_URL (pooled,
//     through PgBouncer) and DATABASE_URL_UNPOOLED (direct); a preview
//     deployment gets the URLs of its own Neon branch. The server serves from
//     the pooled URL with a small pgx pool, because Vercel starts an instance
//     per concurrent request from cold and every instance holds its own pool.
//   - The master key. server.master_keys can only come from a config file
//     (the server ignores NEXTGEN_SERVER_MASTER_KEYS_*), so
//     MASTER_KEY_PEM_B64 and MASTER_KEY_ID become <data_dir>/nextgen.yaml.
//   - The optional bootstrap admin document, BOOTSTRAP_ADMIN_USER_JSON_B64,
//     becomes a --user-file.
//   - The deployment's shape. The listen address follows PORT, the data dir
//     is the function's writable /tmp, and the console is a service of its own
//     (repo-root vercel.json). The platform project is bootstrapped, logs are
//     JSON and the public base is the deployment's URL unless a NEXTGEN_*
//     variable says otherwise.
//
// Migrations run at deploy time, never at startup: build.sh calls
// `launcher migrate` after compiling, which runs the server's migrate command
// against the direct URL. The serving invocation refuses --migrate, so a
// function cannot change a schema by starting.
package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/zitadel/nextgen/cmd/server"
)

const (
	defaultDataDir = "/tmp/nextgen-data"
	defaultPort    = "8080"

	// consolePath is where vercel.json mounts the console service. The server
	// derives the console's URLs (claim, dashboard) from it, so the two must
	// agree.
	consolePath = "/ui/console"
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

// deployed reports whether the process runs in a Vercel deployment, where a
// missing database URL is a misconfiguration and not a local run that may
// fall back to the server's SQLite default.
func deployed(env string) bool {
	return env == "production" || env == "preview"
}

// prepareMigration is the deploy-time mode: it points the server's migrate
// command at the direct URL of the deployment's database. Migrations hold a
// session advisory lock, which a transaction pooler cannot keep. Production
// migrates only from main, so a production build of any other branch (a
// promoted preview, a CLI deploy) fails instead of changing the schema.
func prepareMigration(extra []string) ([]string, error) {
	env := os.Getenv("VERCEL_ENV")
	if env == "production" {
		if ref := os.Getenv("VERCEL_GIT_COMMIT_REF"); ref != "main" {
			return nil, fmt.Errorf("refusing to migrate production from %q: only main deploys to production", ref)
		}
	}
	dsn := os.Getenv("DATABASE_URL_UNPOOLED")
	if dsn == "" && deployed(env) {
		return nil, fmt.Errorf("DATABASE_URL_UNPOOLED must be set for a %s deployment (Neon's Vercel integration sets it)", env)
	}
	if dsn != "" {
		if err := os.Setenv("NEXTGEN_DATABASE_POSTGRES", dsn); err != nil {
			return nil, err
		}
	}
	if err := setDefault("NEXTGEN_SERVER_DATA_DIR", defaultDataDir); err != nil {
		return nil, err
	}
	fmt.Fprintf(os.Stderr, "launcher: migrating the %s database\n", describeEnv(env))
	return append([]string{"migrate"}, extra...), nil
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

	keyB64 := os.Getenv("MASTER_KEY_PEM_B64")
	if keyB64 == "" {
		return nil, errors.New("MASTER_KEY_PEM_B64 must be set (base64 of the master key PEM)")
	}
	keyID := os.Getenv("MASTER_KEY_ID")
	if !keyIDPattern.MatchString(keyID) {
		return nil, fmt.Errorf("MASTER_KEY_ID must be set and match %s, got %q", keyIDPattern, keyID)
	}
	pem, err := decodePEM(keyB64)
	if err != nil {
		return nil, err
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" && deployed(env) {
		return nil, fmt.Errorf("DATABASE_URL must be set for a %s deployment (Neon's Vercel integration sets it)", env)
	}
	if dsn != "" {
		pooled, err := withParams(dsn, servingParams)
		if err != nil {
			return nil, err
		}
		if err := os.Setenv("NEXTGEN_DATABASE_POSTGRES", pooled); err != nil {
			return nil, err
		}
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
	if err := os.WriteFile(configPath, renderConfig(keyID, pem), 0o600); err != nil {
		return nil, err
	}
	_ = os.Unsetenv("MASTER_KEY_PEM_B64")

	args := []string{"server", "--config", configPath}

	if adminB64 := os.Getenv("BOOTSTRAP_ADMIN_USER_JSON_B64"); adminB64 != "" {
		doc, err := base64.StdEncoding.DecodeString(adminB64)
		if err != nil {
			return nil, fmt.Errorf("BOOTSTRAP_ADMIN_USER_JSON_B64 is not base64: %w", err)
		}
		if !strings.Contains(string(doc), `"header"`) || !strings.Contains(string(doc), `"authenticators"`) {
			return nil, errors.New("BOOTSTRAP_ADMIN_USER_JSON_B64 does not decode to a bootstrap user document")
		}
		adminPath := filepath.Join(dataDir, "admin-user.json")
		if err := os.WriteFile(adminPath, doc, 0o600); err != nil {
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
	} {
		if err := setDefault(key, value); err != nil {
			return nil, err
		}
	}
	return append(args, extra...), nil
}

// withParams adds each parameter the URL does not set yet. The integration's
// URLs are postgresql:// URLs; the server also accepts the key=value form,
// but nothing here produces it, so anything else is refused rather than
// guessed at.
func withParams(dsn string, params []struct{ key, value string }) (string, error) {
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		return "", errors.New("DATABASE_URL must be a postgres:// or postgresql:// URL")
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

// setDefault sets a variable only when the environment leaves it unset or
// empty, so an explicit value keeps winning.
func setDefault(key, value string) error {
	if value == "" || os.Getenv(key) != "" {
		return nil
	}
	return os.Setenv(key, value)
}

// decodePEM returns the key's PEM lines, normalized: no carriage returns, no
// blank lines, no stray indentation, as pasted keys arrive.
func decodePEM(b64 string) ([]string, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("MASTER_KEY_PEM_B64 is not base64: %w", err)
	}
	var lines []string
	for _, line := range strings.Split(strings.ReplaceAll(string(raw), "\r", ""), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) < 2 || !strings.HasPrefix(lines[0], "-----BEGIN ") || !strings.HasPrefix(lines[len(lines)-1], "-----END ") {
		return nil, errors.New("MASTER_KEY_PEM_B64 does not decode to a PEM block")
	}
	return lines, nil
}

// renderConfig writes the one setting that cannot come from the environment:
// the master key as a YAML block scalar under its key id.
func renderConfig(keyID string, pem []string) []byte {
	var b strings.Builder
	b.WriteString("server:\n")
	b.WriteString("  generate_master_key: false\n")
	b.WriteString("  master_keys:\n")
	fmt.Fprintf(&b, "    %s:\n", keyID)
	b.WriteString("      use_for_encryption: true\n")
	b.WriteString("      private_key: |\n")
	for _, line := range pem {
		b.WriteString("        " + line + "\n")
	}
	return []byte(b.String())
}
