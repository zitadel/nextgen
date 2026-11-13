//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// answer serves one canned response through the validator.
func answer(v *SpecValidator, method, target string, status int, contentType, body string) {
	handler := v.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(method, target, nil))
}

const teamNotFound = `{"code":"team.team_not_found","message":"Team not found."}`

func TestSpecValidatorPassesWhatTheSpecDeclares(t *testing.T) {
	v, err := NewSpecValidator(nil)
	require.NoError(t, err)

	answer(v, http.MethodGet, "/api/v1/livez", http.StatusOK, "text/plain; charset=utf-8", "ok")
	answer(v, http.MethodGet, "/livez", http.StatusOK, "text/plain; charset=utf-8", "ok")
	answer(v, http.MethodGet, "/api/v1/teams/team_1", http.StatusNotFound, "application/json", teamNotFound)
	// A path the spec lacks, answered as one.
	answer(v, http.MethodGet, "/api/v1/no-such-path", http.StatusNotFound, "application/json", `{"code":"req.not_found","message":"x"}`)
	// Mounts that are no operation.
	answer(v, http.MethodGet, "/api/v1/openapi.json", http.StatusOK, "application/json", `{}`)
	answer(v, http.MethodGet, "/idp/google/callback", http.StatusFound, "", "")

	assert.NoError(t, v.CheckSpecConformance())
}

func TestSpecValidatorCatchesWhatTheSpecDoesNotDeclare(t *testing.T) {
	for _, tc := range []struct {
		name        string
		method      string
		target      string
		status      int
		contentType string
		body        string
		reason      string
	}{
		{"body against the schema", http.MethodGet, "/api/v1/teams/team_1", http.StatusOK, "application/json", `{"bogus":true}`, "doesn't match schema"},
		{"error code outside the operation's error set", http.MethodGet, "/api/v1/teams/team_1", http.StatusForbidden, "application/json", `{"code":"user.user_not_found","message":"x"}`, "doesn't match schema"},
		{"undeclared status", http.MethodGet, "/api/v1/teams/team_1", http.StatusCreated, "application/json", `{}`, "status 201 is not declared"},
		{"undeclared content type", http.MethodGet, "/api/v1/teams/team_1", http.StatusNotFound, "text/html", "<p>no</p>", `content type "text/html" is not declared`},
		{"a path the spec lacks, answered", http.MethodGet, "/api/v1/no-such-path", http.StatusOK, "application/json", `{}`, "names no operation"},
		{"a method the path lacks, answered", http.MethodPut, "/api/v1/livez", http.StatusOK, "text/plain", "ok", "names no operation"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v, err := NewSpecValidator(nil)
			require.NoError(t, err)
			answer(v, tc.method, tc.target, tc.status, tc.contentType, tc.body)
			err = v.CheckSpecConformance()
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.reason)
		})
	}
}

func TestSpecValidatorKnownMismatchesOnlyShrink(t *testing.T) {
	known := []KnownSpecMismatch{{Operation: "getTeam", Status: http.StatusOK, Reason: "test"}}

	t.Run("a mismatch it lists is tolerated", func(t *testing.T) {
		v, err := NewSpecValidator(known)
		require.NoError(t, err)
		answer(v, http.MethodGet, "/api/v1/teams/team_1", http.StatusOK, "application/json", `{"bogus":true}`)
		assert.NoError(t, v.CheckSpecConformance())
	})

	t.Run("an entry fails once the answer matches", func(t *testing.T) {
		v, err := NewSpecValidator([]KnownSpecMismatch{{Operation: "getTeam", Status: http.StatusNotFound, Reason: "test"}})
		require.NoError(t, err)
		answer(v, http.MethodGet, "/api/v1/teams/team_1", http.StatusNotFound, "application/json", teamNotFound)
		err = v.CheckSpecConformance()
		require.Error(t, err)
		assert.Contains(t, err.Error(), "remove it from the known spec mismatches")
	})

	t.Run("an entry no exchange reaches is left alone", func(t *testing.T) {
		v, err := NewSpecValidator(known)
		require.NoError(t, err)
		assert.NoError(t, v.CheckSpecConformance())
	})

	t.Run("an entry listed twice", func(t *testing.T) {
		_, err := NewSpecValidator(append(known, known...))
		assert.ErrorContains(t, err, "listed twice")
	})
}

func TestSpecValidatorKnownMismatchesNameRealOperations(t *testing.T) {
	v, err := NewSpecValidator(nil)
	require.NoError(t, err)
	operations := map[string]bool{}
	for _, path := range v.doc.Paths.Map() {
		for _, op := range path.Operations() {
			operations[op.OperationID] = true
		}
	}
	for _, entry := range knownSpecMismatches {
		assert.True(t, operations[entry.Operation], "known spec mismatch names no operation: %s", entry.Operation)
		assert.NotEmpty(t, entry.Reason, "known spec mismatch %s %d gives no reason", entry.Operation, entry.Status)
	}
}
