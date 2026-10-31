package console

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/securityheaders"
)

// A binary built with -tags noconsole has no dist: both entry points refuse,
// so a server told to serve the console fails at startup instead of serving
// nothing.
func TestWithoutTheConsoleBothEntryPointsRefuse(t *testing.T) {
	embedded := dist
	dist = nil
	t.Cleanup(func() { dist = embedded })

	_, err := Handler("/ui/console")
	require.ErrorIs(t, err, errLeftOut)
	require.ErrorIs(t, ValidateDist(), errLeftOut)
}

// The hosted cloud serves the console from a service of its own, whose
// headers repo-root vercel.json sets: they must be the policies this server
// sends for the same index.html, or the cloud's console runs under a policy
// nothing tests. They may add only what Vercel's toolbar needs on a preview
// (vercelToolbar). Vite copies the inline script into the build as it is, so
// the source page's hashes are the built page's.
func TestTheCloudSendsTheConsolesPolicies(t *testing.T) {
	index, err := os.ReadFile(filepath.Join("..", "..", "..", "apps", "console", "index.html"))
	require.NoError(t, err)
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "vercel.json"))
	require.NoError(t, err)
	var cloud struct {
		Services map[string]struct {
			Headers []struct {
				Source  string `json:"source"`
				Headers []struct {
					Key   string `json:"key"`
					Value string `json:"value"`
				} `json:"headers"`
			} `json:"headers"`
		} `json:"services"`
	}
	require.NoError(t, json.Unmarshal(raw, &cloud))

	sent := map[string]string{}
	for _, rule := range cloud.Services["console"].Headers {
		if rule.Source != "/(.*)" {
			continue
		}
		for _, header := range rule.Headers {
			sent[header.Key] = header.Value
		}
	}
	enforced, reportOnly := Policies(string(index))
	assert.Equal(t, withToolbar(t, enforced, vercelToolbar[:1]), directives(t, sent[securityheaders.PolicyHeader]),
		"vercel.json, services.console.headers: %s", securityheaders.PolicyHeader)
	assert.Equal(t, withToolbar(t, reportOnly, vercelToolbar), directives(t, sent[securityheaders.ReportOnlyPolicyHeader]),
		"vercel.json, services.console.headers: %s", securityheaders.ReportOnlyPolicyHeader)
}

// vercelToolbar is what Vercel's toolbar loads on a preview, by directive
// (https://vercel.com/docs/vercel-toolbar/managing-toolbar#using-a-content-security-policy),
// so reviewers can comment on the console's pages. A directive the policy
// lacks starts from the console's own origin, as default-src would.
var vercelToolbar = []struct{ directive, sources string }{
	{"script-src", "https://vercel.live"},
	{"style-src", "https://vercel.live"},
	{"img-src", "blob:"},
	{"font-src", "'self' https://vercel.live https://assets.vercel.com"},
	{"connect-src", "'self' https://vercel.live wss://ws-us3.pusher.com"},
	{"frame-src", "https://vercel.live"},
}

func withToolbar(t *testing.T, policy string, toolbar []struct{ directive, sources string }) map[string]string {
	t.Helper()
	all := directives(t, policy)
	for _, add := range toolbar {
		all[add.directive] = strings.TrimSpace(all[add.directive] + " " + add.sources)
	}
	return all
}

// directives reads a policy as its sources by directive, so two policies
// compare whatever order they list their directives in.
func directives(t *testing.T, policy string) map[string]string {
	t.Helper()
	all := map[string]string{}
	for _, directive := range strings.Split(policy, ";") {
		name, sources, _ := strings.Cut(strings.TrimSpace(directive), " ")
		require.NotContains(t, all, name, "a directive twice in %q", policy)
		all[name] = sources
	}
	return all
}
