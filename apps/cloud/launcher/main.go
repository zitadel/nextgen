// Command launcher starts the nextgen server on Vercel's Go runtime.
//
// It is entrypoint.sh in Go: the Go framework preset runs a bare binary with
// no script in front of it, so the binary itself has to turn the environment
// a Vercel function receives into what the server accepts. server.master_keys
// can only be loaded from a YAML file (the server ignores the
// NEXTGEN_SERVER_MASTER_KEYS_* env form), so MASTER_KEY_PEM_B64 and
// MASTER_KEY_ID become <data_dir>/nextgen.yaml, the optional bootstrap admin
// document becomes <data_dir>/admin-user.json passed as --user-file, and the
// listen address follows Vercel's PORT. Every other setting stays a NEXTGEN_*
// variable. Migrations never run here: the launcher passes no --migrate and
// refuses one, so a serving function cannot change a schema by starting.
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
)

const (
	defaultDataDir = "/tmp/nextgen-data"
	defaultKeyID   = "preview"
	defaultPort    = "8080"
)

var keyIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func main() {
	args, err := prepare(os.Args[1:])
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

// prepare renders the config and bootstrap files from the environment and
// returns the server arguments. Secrets are removed from the environment
// once they are on disk, so the server process does not carry them.
func prepare(extra []string) ([]string, error) {
	for _, arg := range extra {
		if arg == "--migrate" || strings.HasPrefix(arg, "--migrate=") {
			return nil, errors.New("refusing --migrate; migrations run in cloud-deploy.yml, not in the function")
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
