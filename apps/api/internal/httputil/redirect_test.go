package httputil_test

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/httputil"
)

// The accepted and refused targets live in testdata/redirect_targets.json, one
// list read by these tests and by the API mock's tests
// (packages/api-mock/src/redirect-target.spec.ts), so the mock refuses exactly
// what the server refuses. Add a new input there, not in this file.
type redirectTargetRow struct {
	Name   string `json:"name"`
	Raw    string `json:"raw"`
	Repeat *struct {
		Unit  string `json:"unit"`
		Count int    `json:"count"`
	} `json:"repeat"`
	RawAfter string `json:"rawAfter"`
	Host     string `json:"host"`
	Why      string `json:"why"`
}

// target is the row's input: raw, then repeat.unit repeat.count times, then
// rawAfter, so a row can name a target longer than is practical to write out.
func (r redirectTargetRow) target() string {
	if r.Repeat == nil {
		return r.Raw
	}
	return r.Raw + strings.Repeat(r.Repeat.Unit, r.Repeat.Count) + r.RawAfter
}

func loadRedirectTargets(t *testing.T) (accepts, refuses []redirectTargetRow) {
	t.Helper()

	data, err := os.ReadFile("testdata/redirect_targets.json")
	require.NoError(t, err)
	var rows struct {
		Accepts []redirectTargetRow `json:"accepts"`
		Refuses []redirectTargetRow `json:"refuses"`
	}
	require.NoError(t, json.Unmarshal(data, &rows))
	return rows.Accepts, rows.Refuses
}

func TestParseRedirectTarget_Accepts(t *testing.T) {
	t.Parallel()

	accepts, _ := loadRedirectTargets(t)
	require.NotEmpty(t, accepts)
	for _, tt := range accepts {
		t.Run(tt.Name, func(t *testing.T) {
			t.Parallel()

			u, err := httputil.ParseRedirectTarget(tt.target())
			require.NoError(t, err)
			assert.Equal(t, tt.Host, u.Host)
		})
	}
}

func TestParseRedirectTarget_Refuses(t *testing.T) {
	t.Parallel()

	_, refuses := loadRedirectTargets(t)
	require.NotEmpty(t, refuses)
	for _, tt := range refuses {
		t.Run(tt.Name, func(t *testing.T) {
			t.Parallel()

			u, err := httputil.ParseRedirectTarget(tt.target())
			require.ErrorIs(t, err, httputil.ErrInvalidRedirectTarget)
			assert.ErrorContains(t, err, tt.Why)
			assert.Nil(t, u)
		})
	}
}

func TestParseRedirectTarget_ReturnsTheTargetAsWritten(t *testing.T) {
	t.Parallel()

	u, err := httputil.ParseRedirectTarget("HTTPS://app.test/a%2Fb/%2e%2e/c?next=%2Fprofile#/step")
	require.NoError(t, err)
	// Nothing in the path or the query is decoded or resolved: a caller that
	// stores the target stores what the page sent.
	assert.Equal(t, "/a%2Fb/%2e%2e/c", u.EscapedPath())
	assert.Equal(t, "next=%2Fprofile", u.RawQuery)
	assert.Equal(t, "/step", u.Fragment)
	// Only the scheme is folded, as the URL standard does.
	assert.Equal(t, "https", u.Scheme)
}

func TestParseRedirectTarget_WritesAStrayPercentSignAsAnEscape(t *testing.T) {
	t.Parallel()

	u, err := httputil.ParseRedirectTarget("https://app.test/50%off#100%")
	require.NoError(t, err)
	assert.Equal(t, "https://app.test/50%25off#100%25", u.String())
}

func TestParseRedirectTarget_KeepsEscapesWhereGoWouldReEncode(t *testing.T) {
	t.Parallel()

	tests := []struct{ name, raw, want string }{
		{"a path of the longest accepted size", "https://app.test/" + strings.Repeat("a", httputil.MaxRedirectTargetLength-len("https://app.test/")), "https://app.test/" + strings.Repeat("a", httputil.MaxRedirectTargetLength-len("https://app.test/"))},
		{"a double quote before an encoded slash is escaped", `https://app.test/a%2Fb"c`, `https://app.test/a%2Fb%22c`},
		{"a less-than sign before an encoded slash is escaped", `https://app.test/a%2Fb<c`, `https://app.test/a%2Fb%3Cc`},
		{"a greater-than sign before an encoded slash is escaped", `https://app.test/a%2Fb>c`, `https://app.test/a%2Fb%3Ec`},
		{"a caret before an encoded slash is escaped", `https://app.test/a%2Fb^c`, `https://app.test/a%2Fb%5Ec`},
		{"a backtick before an encoded slash is escaped", "https://app.test/a%2Fb`c", `https://app.test/a%2Fb%60c`},
		{"an opening brace before an encoded slash is escaped", `https://app.test/a%2Fb{c`, `https://app.test/a%2Fb%7Bc`},
		{"a bar before an encoded slash is escaped", `https://app.test/a%2Fb|c`, `https://app.test/a%2Fb%7Cc`},
		{"a closing brace before an encoded slash is escaped", `https://app.test/a%2Fb}c`, `https://app.test/a%2Fb%7Dc`},
		{"a bar after an encoded slash", "https://app.test/a%2Fb|c", "https://app.test/a%2Fb%7Cc"},
		{"a caret with a query", "https://app.test/a%2Fb^c?flow=1", "https://app.test/a%2Fb%5Ec?flow=1"},
		{"a bar in the fragment", "https://app.test/x#/a%2Fb|c", "https://app.test/x#/a%2Fb%7Cc"},
		{"a backslash in the fragment", `https://app.test/x#/a%2Fb\c`, "https://app.test/x#/a%2Fb%5Cc"},
		{"a second hash in the fragment", "https://app.test/x#/a%2Fb#c", "https://app.test/x#/a%2Fb%23c"},
		{"a stray percent sign in the query", "https://app.test/x?q=100%", "https://app.test/x?q=100%"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			u, err := httputil.ParseRedirectTarget(tt.raw)
			require.NoError(t, err)
			assert.Equal(t, tt.want, u.String())
		})
	}
}
