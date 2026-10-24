package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/zitadel/nextgen/internal/api"
)

// browser is the Accept header of a navigation; program, a fetch's or curl's.
const (
	browser = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
	program = "*/*"
)

// vercel.json sends a person on a path nothing serves to the website, whose
// 404 page answers, and a program to the server, whose req.not_found envelope
// does (ADR 076). That only holds while every path the server serves is
// routed to it by name, so a browser reaches it too: the API's paths, the
// login and the sign-in provider callbacks.
func TestVercelJSONRoutesTheServersPathsByName(t *testing.T) {
	rewrites := readRewrites(t)

	var paths []string
	for _, segment := range apiPathSegments(t) {
		paths = append(paths, "/"+segment, "/"+segment+"/x")
	}
	paths = append(paths, loginPath, loginPath+"/", loginPath+"/step")
	for _, prefix := range api.IDPCallbackPathPrefixes() {
		paths = append(paths, prefix+"/google/callback")
	}

	var wrong []string
	for _, path := range paths {
		for _, accept := range []string{browser, program} {
			if got := route(t, rewrites, path, accept); got != "server" {
				wrong = append(wrong, fmt.Sprintf("%s (Accept %s) → %s", path, accept, got))
			}
		}
	}
	assert.Empty(t, wrong, "a path the server serves must be routed to it by name; add its first segment to the server rewrite in vercel.json")
}

func TestVercelJSONSendsAPathNothingServesByWhoAsks(t *testing.T) {
	rewrites := readRewrites(t)

	for _, tt := range []struct {
		path, accept, want string
	}{
		{"/no-such-page", browser, "website"},
		{"/no-such-page", program, "server"},
		{"/no-such-page", "application/json", "server"},
		{"/changelog/no-such-release", browser, "website"},
		// The services' own paths keep their own 404s.
		{"/docs/no-such-page", browser, "docs"},
		{"/console/no-such-page", browser, "console"},
		{"/", browser, "website"},
		{"/console/runtime.json", program, "server"},
		{"/schemas/v1/user-schema.json", program, "schemas"},
		// Proxied to another host before any rule here looks at Accept.
		{"/telemetry/mixpanel/track", browser, "https://api-eu.mixpanel.com/:path"},
		{"/telemetry/mixpanel/track", program, "https://api-eu.mixpanel.com/:path"},
	} {
		assert.Equal(t, tt.want, route(t, rewrites, tt.path, tt.accept), "%s (Accept %s)", tt.path, tt.accept)
	}
}

type vercelRewrite struct {
	Source string `json:"source"`
	Has    []struct {
		Type  string `json:"type"`
		Key   string `json:"key"`
		Value string `json:"value"`
	} `json:"has"`
	Destination json.RawMessage `json:"destination"`
}

func readRewrites(t *testing.T) []vercelRewrite {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "vercel.json"))
	require.NoError(t, err)
	var config struct {
		Rewrites []vercelRewrite `json:"rewrites"`
	}
	require.NoError(t, json.Unmarshal(raw, &config))
	return config.Rewrites
}

// route is the service the first matching rewrite names, as Vercel picks it,
// or the URL of one that proxies to another host.
func route(t *testing.T, rewrites []vercelRewrite, path, accept string) string {
	t.Helper()
	header := http.Header{"Accept": {accept}}
	for _, rewrite := range rewrites {
		if !sourcePattern(t, rewrite.Source).MatchString(path) {
			continue
		}
		matched := true
		for _, condition := range rewrite.Has {
			require.Equal(t, "header", condition.Type, "only header conditions are modelled here")
			value := regexp.MustCompile("^(?:" + condition.Value + ")$")
			matched = matched && value.MatchString(header.Get(condition.Key))
		}
		if !matched {
			continue
		}
		var url string
		if json.Unmarshal(rewrite.Destination, &url) == nil {
			return url
		}
		var destination struct{ Service string }
		require.NoError(t, json.Unmarshal(rewrite.Destination, &destination), rewrite.Source)
		return destination.Service
	}
	return "(no rewrite)"
}

// paramName is a path-to-regexp parameter's name, after its colon.
var paramName = regexp.MustCompile(`^[A-Za-z0-9_]+`)

// sourcePattern reads a rewrite's source the way path-to-regexp does for the
// forms vercel.json uses: literal text, groups that are regular expressions,
// named parameters (`:path`, or `:path(.*)` with a pattern of its own), and
// the `?`, `*` or `+` modifier after a group or a parameter.
func sourcePattern(t *testing.T, source string) *regexp.Regexp {
	t.Helper()
	var pattern strings.Builder
	depth := 0
	afterToken := false
	for i := 0; i < len(source); i++ {
		c := source[i]
		switch {
		case depth == 0 && c == ':':
			name := paramName.FindString(source[i+1:])
			require.NotEmpty(t, name, "a parameter without a name: %s", source)
			i += len(name)
			// A parameter without a pattern of its own matches one segment.
			if i+1 >= len(source) || source[i+1] != '(' {
				pattern.WriteString(`([^/]+)`)
				afterToken = true
			}
			continue
		case c == '(':
			depth++
		case c == ')':
			depth--
			pattern.WriteByte(c)
			afterToken = depth == 0
			continue
		case depth == 0 && afterToken && strings.IndexByte("?*+", c) >= 0:
		case depth == 0:
			pattern.WriteString(regexp.QuoteMeta(string(c)))
			afterToken = false
			continue
		}
		pattern.WriteByte(c)
	}
	return regexp.MustCompile("^" + pattern.String() + "$")
}

// apiPathSegments are the first segments of the API's paths, from the
// OpenAPI document the server is generated from.
func apiPathSegments(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "api", "openapi", "openapi-spec.yaml"))
	require.NoError(t, err)
	var spec struct {
		Paths map[string]any `yaml:"paths"`
	}
	require.NoError(t, yaml.Unmarshal(raw, &spec))
	require.NotEmpty(t, spec.Paths)

	var segments []string
	for path := range spec.Paths {
		segment, _, _ := strings.Cut(strings.TrimPrefix(path, "/"), "/")
		if !slices.Contains(segments, segment) {
			segments = append(segments, segment)
		}
	}
	slices.Sort(segments)
	return segments
}
