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
//
// A deployment whose services run in several Vercel regions names one
// database per region instead (CLOUD_DATABASE_URL_<REGION>, see the regional
// database section): the function serves from the database of the region it
// runs in and the build migrates every one of them.
package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
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
		if targets := regionalMigrationTargets(); len(targets) > 0 {
			os.Exit(migrateRegions(targets, os.Args[2:]))
		}
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
// already names a schema (`schema=` or `search_path=`) is used as is,
// production and local runs use the URL as configured, and a preview
// deployment appends the schema of its pull request (pr_<id>) or, without
// one, of its branch (br_<name>) as the `schema` parameter, which the server
// consumes itself and never sends to the database, so the same URL works
// through PlanetScale's PgBouncer.
func resolveDatabaseURL(base, env string) (dsn, schema string, err error) {
	if base == "" {
		if env == "production" || env == "preview" {
			return "", "", errors.New("NEXTGEN_DATABASE_POSTGRES must be set for a " + env + " deployment")
		}
		return "", pgschema.Default, nil
	}
	if namesSchema(base) {
		return base, "<from the URL>", nil
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
	return base + separator + "schema=" + schema, schema, nil
}

// namesSchema reports whether a URL already carries a schema, as the
// server's `schema` parameter or as a `search_path`.
func namesSchema(dsn string) bool {
	for _, key := range []string{"schema=", "search_path="} {
		if strings.Contains(dsn, "?"+key) || strings.Contains(dsn, "&"+key) {
			return true
		}
	}
	return false
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
	if err := applyRole(); err != nil {
		return nil, err
	}
	if err := applyUIMode(); err != nil {
		return nil, err
	}
	configPath := filepath.Join(dataDir, "nextgen.yaml")
	if err := os.WriteFile(configPath, renderConfig(keyID, pem, homeHeaders()), 0o600); err != nil {
		return nil, err
	}
	_ = os.Unsetenv("MASTER_KEY_PEM_B64")
	_ = os.Unsetenv(homeBypassSecretVariable)

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

	// The same database URL the build migrated, schema included: the one of
	// this function's region when the deployment names regional databases.
	base, err := servingDatabaseURL()
	if err != nil {
		return nil, err
	}
	dsn, _, err := resolveDatabaseURL(base, os.Getenv("VERCEL_ENV"))
	if err != nil {
		return nil, err
	}
	if dsn != "" {
		if err := os.Setenv("NEXTGEN_DATABASE_POSTGRES", dsn); err != nil {
			return nil, err
		}
	}
	unsetDatabaseURLs(false)
	return append(args, extra...), nil
}

// Regional databases.
//
// A deployment whose services are pinned to several Vercel regions holds one
// database per region, in the region: CLOUD_DATABASE_URL_<REGION> is the URL
// the functions of that region serve from and CLOUD_MIGRATOR_DATABASE_URL_<REGION>
// the one their migrations use (the migrator role; the serving URL when
// absent), <REGION> being the Vercel region code in upper case, FRA1 or CLE1.
// The serving function picks the database of VERCEL_REGION, or of
// CLOUD_DATABASE_KEY when a service owns a database that is not its region's,
// and drops every other database variable from its environment, so a function
// never carries another region's credentials. The migrate build step runs in no region and
// migrates every regional database, one child launcher per region. As soon as
// one regional variable is set, the plain NEXTGEN_DATABASE_POSTGRES and
// CLOUD_MIGRATOR_DATABASE_URL are ignored: a multi-region deployment names a
// database for every region it serves from, or its function refuses to start.
// Without regional variables the plain pair applies, as before.
const (
	regionalDatabasePrefix = "CLOUD_DATABASE_URL_"
	regionalMigratorPrefix = "CLOUD_MIGRATOR_DATABASE_URL_"
)

// migrationTarget is one regional database and the URL its migrations use.
type migrationTarget struct {
	region string
	url    string
}

// databaseKeyVariable names the database a function serves from when it is
// not the one of its region: a service that shares a region with another but
// owns a database of its own (the identity home next to a regional server)
// sets CLOUD_DATABASE_KEY=home and names CLOUD_DATABASE_URL_HOME.
const databaseKeyVariable = "CLOUD_DATABASE_KEY"

// databaseKey is the variable suffix of the database this function serves
// from: CLOUD_DATABASE_KEY when set, else the region the function runs in
// (VERCEL_REGION); upper case, anything but letters and digits replaced by
// an underscore; empty outside Vercel.
func databaseKey() string {
	key := os.Getenv(databaseKeyVariable)
	if key == "" {
		key = os.Getenv("VERCEL_REGION")
	}
	return strings.Map(func(r rune) rune {
		switch {
		case r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case r >= 'a' && r <= 'z':
			return r - 'a' + 'A'
		}
		return '_'
	}, key)
}

// regionalDatabaseURLs maps every region named by a CLOUD_DATABASE_URL_<REGION>
// variable to its serving URL.
func regionalDatabaseURLs() map[string]string {
	urls := map[string]string{}
	for _, kv := range os.Environ() {
		name, url, ok := strings.Cut(kv, "=")
		if !ok || url == "" || !strings.HasPrefix(name, regionalDatabasePrefix) {
			continue
		}
		urls[strings.TrimPrefix(name, regionalDatabasePrefix)] = url
	}
	return urls
}

// servingDatabaseURL returns the URL this function serves from before the
// schema rule: the database of its region when the deployment names regional
// databases, else NEXTGEN_DATABASE_POSTGRES as configured.
func servingDatabaseURL() (string, error) {
	urls := regionalDatabaseURLs()
	if len(urls) == 0 {
		return os.Getenv("NEXTGEN_DATABASE_POSTGRES"), nil
	}
	key := databaseKey()
	if url, ok := urls[key]; ok {
		return url, nil
	}
	keys := slices.Sorted(maps.Keys(urls))
	return "", fmt.Errorf("no %s%s: this deployment names databases for %s; %s is %q and VERCEL_REGION is %q",
		regionalDatabasePrefix, key, strings.Join(keys, ", "), databaseKeyVariable, os.Getenv(databaseKeyVariable), os.Getenv("VERCEL_REGION"))
}

// regionalMigrationTargets lists the databases a multi-region deployment
// migrates, by region: the region's migrator URL when set, else its serving
// URL. Empty when the deployment names no regional database.
func regionalMigrationTargets() []migrationTarget {
	var targets []migrationTarget
	for region, url := range regionalDatabaseURLs() {
		if migrator := os.Getenv(regionalMigratorPrefix + region); migrator != "" {
			url = migrator
		}
		targets = append(targets, migrationTarget{region: region, url: url})
	}
	slices.SortFunc(targets, func(a, b migrationTarget) int { return strings.Compare(a.region, b.region) })
	return targets
}

// migrateRegions runs the migrations of every regional database, each in a
// child launcher whose environment names that one database as
// NEXTGEN_DATABASE_POSTGRES, so prepareMigration applies unchanged: the
// production guard, the schema rule and the migrate command. It returns the
// process exit code; the first failure stops the run.
func migrateRegions(targets []migrationTarget, extra []string) int {
	self, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, "launcher:", err)
		return 64
	}
	for _, target := range targets {
		fmt.Fprintf(os.Stderr, "launcher: migrating the database of region %s\n", target.region)
		cmd := exec.Command(self, append([]string{"migrate"}, extra...)...)
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		cmd.Env = childEnv(os.Environ(), target.url)
		if err := cmd.Run(); err != nil {
			fmt.Fprintf(os.Stderr, "launcher: migrating the database of region %s failed: %v\n", target.region, err)
			return 1
		}
	}
	return 0
}

// childEnv is env without any database variable, plus url as the one
// database the child works with.
func childEnv(env []string, url string) []string {
	out := make([]string, 0, len(env)+1)
	for _, kv := range env {
		if name, _, _ := strings.Cut(kv, "="); !isDatabaseURLVariable(name, true) {
			out = append(out, kv)
		}
	}
	return append(out, "NEXTGEN_DATABASE_POSTGRES="+url)
}

// unsetDatabaseURLs removes the regional database variables from the
// environment, and with plain also NEXTGEN_DATABASE_POSTGRES and
// CLOUD_MIGRATOR_DATABASE_URL.
func unsetDatabaseURLs(plain bool) {
	for _, kv := range os.Environ() {
		if name, _, _ := strings.Cut(kv, "="); isDatabaseURLVariable(name, plain) {
			_ = os.Unsetenv(name)
		}
	}
}

func isDatabaseURLVariable(name string, plain bool) bool {
	if plain && (name == "NEXTGEN_DATABASE_POSTGRES" || name == "CLOUD_MIGRATOR_DATABASE_URL") {
		return true
	}
	return strings.HasPrefix(name, regionalDatabasePrefix) || strings.HasPrefix(name, regionalMigratorPrefix)
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

// homeBypassSecretVariable carries the deployment-protection bypass secret
// a regional function needs on its calls to the identity home
// (platform.home.url) while the home is a protected Vercel deployment. It
// becomes the x-vercel-protection-bypass request header of
// platform.home.headers, a map the server only reads from its YAML.
const homeBypassSecretVariable = "CLOUD_HOME_BYPASS_SECRET"

// Roles.
//
// A deployment of several services on one host names each service's role and
// mount point in the function's environment (apps/cloud/build-output.sh
// writes them): CLOUD_ROLE is "home" for the identity home and "region" for
// a regional server, CLOUD_PATH_PREFIX the path the service is mounted under
// ("/eu"; empty at the root). From them the launcher derives what the server
// needs and a build cannot know: the public base (the host plus the prefix)
// and, for a region, the URL of the home (the host's root). The host is
// CLOUD_HOST when set, else the project's production domain in production,
// else the deployment's branch URL, else its deployment URL. An explicit
// NEXTGEN_SERVER_PUBLIC_BASE or NEXTGEN_PLATFORM_HOME_URL is left alone.
const (
	roleVariable   = "CLOUD_ROLE"
	prefixVariable = "CLOUD_PATH_PREFIX"
	hostVariable   = "CLOUD_HOST"
)

// deploymentHost is the host this deployment is reached at, without scheme.
func deploymentHost() string {
	if host := os.Getenv(hostVariable); host != "" {
		return host
	}
	if os.Getenv("VERCEL_ENV") == "production" {
		if host := os.Getenv("VERCEL_PROJECT_PRODUCTION_URL"); host != "" {
			return host
		}
	}
	if host := os.Getenv("VERCEL_BRANCH_URL"); host != "" {
		return host
	}
	return os.Getenv("VERCEL_URL")
}

// applyRole sets the public base and the home URL from the role, when there
// is one and they are not set explicitly.
func applyRole() error {
	role := os.Getenv(roleVariable)
	if role == "" {
		return nil
	}
	if role != "home" && role != "region" {
		return fmt.Errorf("%s must be home or region, got %q", roleVariable, role)
	}
	prefix := os.Getenv(prefixVariable)
	if prefix != "" && (!strings.HasPrefix(prefix, "/") || strings.HasSuffix(prefix, "/")) {
		return fmt.Errorf("%s must start and not end with a slash, got %q", prefixVariable, prefix)
	}
	host := deploymentHost()
	if host == "" {
		return fmt.Errorf("%s is %s but no host is known: set %s, or expose VERCEL_URL", roleVariable, role, hostVariable)
	}
	if os.Getenv("NEXTGEN_SERVER_PUBLIC_BASE") == "" {
		if err := os.Setenv("NEXTGEN_SERVER_PUBLIC_BASE", "https://"+host+prefix); err != nil {
			return err
		}
	}
	if role == "region" && os.Getenv("NEXTGEN_PLATFORM_HOME_URL") == "" {
		if err := os.Setenv("NEXTGEN_PLATFORM_HOME_URL", "https://"+host); err != nil {
			return err
		}
	}
	return nil
}

// uiModeVariable is the server's UI mode (server.ui). The cloud embeds no
// UI (build.sh compiles with the noui tag; the UIs are services next to the
// server), so the default is external, the runtime document alone, and a
// region, whose console is the home's, runs headless. An explicit value
// wins.
const uiModeVariable = "NEXTGEN_SERVER_UI"

func applyUIMode() error {
	if os.Getenv(uiModeVariable) != "" {
		return nil
	}
	mode := server.UIExternal
	if os.Getenv(roleVariable) == "region" {
		mode = server.UIHeadless
	}
	return os.Setenv(uiModeVariable, mode)
}

// homeHeaders returns the request headers for the identity home: the
// deployment-protection bypass when a home is configured and the secret is
// set, else none.
func homeHeaders() map[string]string {
	secret := os.Getenv(homeBypassSecretVariable)
	if secret == "" || os.Getenv("NEXTGEN_PLATFORM_HOME_URL") == "" {
		return nil
	}
	return map[string]string{"x-vercel-protection-bypass": secret}
}

// renderConfig writes the settings that cannot come from the environment:
// the master key as a YAML block scalar under its key id, and the request
// headers for the identity home when there are any.
func renderConfig(keyID string, pem []string, homeHeaders map[string]string) []byte {
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
	if len(homeHeaders) > 0 {
		b.WriteString("platform:\n")
		b.WriteString("  home:\n")
		b.WriteString("    headers:\n")
		for _, name := range slices.Sorted(maps.Keys(homeHeaders)) {
			fmt.Fprintf(&b, "      %s: %q\n", name, homeHeaders[name])
		}
	}
	return []byte(b.String())
}
