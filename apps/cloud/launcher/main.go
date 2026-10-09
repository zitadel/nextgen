// Command launcher starts the nextgen server on Vercel's Go runtime.
//
// The Go framework preset runs a bare binary with no script in front of it,
// so the binary itself has to turn the environment a Vercel function
// receives into what the server accepts. server.master_keys
// can only be loaded from a YAML file (the server ignores the
// NEXTGEN_SERVER_MASTER_KEYS_* env form), so MASTER_KEY_PEM_B64 and
// MASTER_KEY_ID become <data_dir>/nextgen.yaml, the optional bootstrap admin
// document becomes <data_dir>/admin-user.json passed as --user-file, and the
// listen address follows Vercel's PORT. Every other setting stays a NEXTGEN_*
// variable.
//
// Migrations run at deploy time, never at startup: vercel-build.sh calls
// `launcher migrate` after compiling, which resolves the same database URL
// the function will use and runs the server's migrate command. The serving
// invocation passes no --migrate and refuses one, so a function cannot
// change a schema by starting.
//
// The database URL is resolved by one rule in both modes (see
// resolveDatabaseURL): production uses it as configured, a preview
// deployment appends the schema of its pull request or branch, so every
// preview owns a schema of the shared preview database.
package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/zitadel/nextgen/cmd/server"
	pgschema "github.com/zitadel/nextgen/internal/storage/dialect/postgres/schema"
)

const (
	defaultDataDir = "/tmp/nextgen-data"
	defaultKeyID   = "preview"
	defaultPort    = "8080"
)

var keyIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func main() {
	var args []string
	var err error
	if len(os.Args) > 1 && os.Args[1] == "migrate" {
		args, err = prepareMigration(os.Args[2:])
	} else {
		args, err = prepare(os.Args[1:])
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

// prepareMigration is the deploy-time mode: it resolves the database URL the
// deployment will serve from and returns the arguments of the server's
// migrate command. Production migrates only from main, so a `vercel deploy
// --prod` from another branch fails its build instead of changing the
// production schema. The migrator role (CLOUD_MIGRATOR_DATABASE_URL) is used
// when configured, else the serving role.
func prepareMigration(extra []string) ([]string, error) {
	env := os.Getenv("VERCEL_ENV")
	if env == "production" {
		if ref := os.Getenv("VERCEL_GIT_COMMIT_REF"); ref != "main" {
			return nil, fmt.Errorf("refusing to migrate production from %q; only main deploys to production", ref)
		}
	}
	base := os.Getenv("CLOUD_MIGRATOR_DATABASE_URL")
	if base == "" {
		base = os.Getenv("NEXTGEN_DATABASE_POSTGRES")
	}
	dsn, schema, err := resolveDatabaseURL(base, env)
	if err != nil {
		return nil, err
	}
	if err := os.Setenv("NEXTGEN_DATABASE_POSTGRES", dsn); err != nil {
		return nil, err
	}
	_ = os.Unsetenv("CLOUD_MIGRATOR_DATABASE_URL")
	if os.Getenv("NEXTGEN_SERVER_DATA_DIR") == "" {
		// migrate mints a throwaway master key here; keep it out of the tree.
		if err := os.Setenv("NEXTGEN_SERVER_DATA_DIR", defaultDataDir); err != nil {
			return nil, err
		}
	}
	fmt.Fprintf(os.Stderr, "launcher: migrating schema %s (%s)\n", schema, env)
	return append([]string{"migrate"}, extra...), nil
}

// resolveDatabaseURL applies the one schema rule of the cloud: a URL that
// already names a search_path is used as is, production and local runs use
// the URL as configured, and a preview deployment appends the schema of its
// pull request (pr_<id>) or, without one, of its branch (br_<name>). The
// server appends public to the search_path itself.
func resolveDatabaseURL(base, env string) (dsn, schema string, err error) {
	if base == "" {
		if env == "production" || env == "preview" {
			return "", "", errors.New("NEXTGEN_DATABASE_POSTGRES must be set for a " + env + " deployment")
		}
		return "", pgschema.Default, nil
	}
	if strings.Contains(base, "search_path=") {
		return base, "<from search_path>", nil
	}
	if env != "preview" {
		return base, pgschema.Default, nil
	}
	switch {
	case os.Getenv("VERCEL_GIT_PULL_REQUEST_ID") != "":
		schema = "pr_" + os.Getenv("VERCEL_GIT_PULL_REQUEST_ID")
	case os.Getenv("VERCEL_GIT_COMMIT_REF") != "":
		schema = "br_" + sanitizeSchemaPart(os.Getenv("VERCEL_GIT_COMMIT_REF"))
	default:
		return "", "", errors.New("preview deployment without VERCEL_GIT_PULL_REQUEST_ID or VERCEL_GIT_COMMIT_REF: cannot pick a schema")
	}
	if err := pgschema.Validate(schema); err != nil {
		return "", "", err
	}
	separator := "?"
	if strings.Contains(base, "?") {
		separator = "&"
	}
	return base + separator + "search_path=" + schema, schema, nil
}

var notSchemaChar = regexp.MustCompile(`[^a-z0-9_]+`)

// sanitizeSchemaPart turns a branch name into the tail of a schema name:
// lowercase, every other character run becomes one underscore, trimmed and
// cut to what fits a 63-byte identifier behind the br_ prefix.
func sanitizeSchemaPart(ref string) string {
	part := notSchemaChar.ReplaceAllString(strings.ToLower(ref), "_")
	part = strings.Trim(part, "_")
	if part == "" {
		part = "x"
	}
	if len(part) > 60 {
		part = strings.TrimRight(part[:60], "_")
	}
	return part
}

// prepare renders the config and bootstrap files from the environment and
// returns the server arguments. Secrets are removed from the environment
// once they are on disk, so the server process does not carry them.
func prepare(extra []string) ([]string, error) {
	for _, arg := range extra {
		if arg == "--migrate" || strings.HasPrefix(arg, "--migrate=") {
			return nil, errors.New("refusing --migrate; migrations run in the build step (launcher migrate), never in the serving function")
		}
	}

	keyB64 := os.Getenv("MASTER_KEY_PEM_B64")
	if keyB64 == "" {
		return nil, errors.New("MASTER_KEY_PEM_B64 must be set (base64 of the master key PEM)")
	}
	keyID := os.Getenv("MASTER_KEY_ID")
	if keyID == "" {
		keyID = defaultKeyID
	}
	if !keyIDPattern.MatchString(keyID) {
		return nil, fmt.Errorf("MASTER_KEY_ID must match %s, got %q", keyIDPattern, keyID)
	}

	dataDir := os.Getenv("NEXTGEN_SERVER_DATA_DIR")
	if dataDir == "" {
		dataDir = defaultDataDir
	}
	if err := os.Setenv("NEXTGEN_SERVER_DATA_DIR", dataDir); err != nil {
		return nil, err
	}
	// Never write under <data_dir>/master-keys/: anything there is adopted as a key.
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}

	pem, err := decodePEM(keyB64)
	if err != nil {
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

	// Vercel routes to $PORT; the server reads its listen address from config.
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}
	if err := os.Setenv("NEXTGEN_SERVER_ADDRESS", ":"+port); err != nil {
		return nil, err
	}

	// The same database URL the build migrated, schema included.
	dsn, _, err := resolveDatabaseURL(os.Getenv("NEXTGEN_DATABASE_POSTGRES"), os.Getenv("VERCEL_ENV"))
	if err != nil {
		return nil, err
	}
	if dsn != "" {
		if err := os.Setenv("NEXTGEN_DATABASE_POSTGRES", dsn); err != nil {
			return nil, err
		}
	}
	return append(args, extra...), nil
}

// decodePEM returns the key's PEM lines, normalized the way the shell
// entrypoint does: no carriage returns, no blank lines, no stray indentation.
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
