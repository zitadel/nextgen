//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fixtureSpec has the shapes the real spec uses: a schema with a $ref and no
// keyword of JSON Schema 2020-12 alone (which kin checks with its OpenAPI 3.0
// validator), an error envelope, a default error set of const codes (which
// kin checks with its 2020-12 validator), a status without a body but with a
// required header, and a text answer.
const fixtureSpec = `{
  "openapi": "3.1.0",
  "info": {"title": "fixture", "version": "1"},
  "paths": {
    "/things/{id}": {
      "parameters": [{"name": "id", "in": "path", "required": true, "schema": {"type": "string"}}],
      "get": {"operationId": "getThing", "responses": {
        "200": {"description": "The thing.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/thing"}}}},
        "404": {"description": "No thing.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/error"}}}},
        "default": {"description": "The error set.", "content": {"application/json": {"schema": {"oneOf": [
          {"$ref": "#/components/schemas/thing-not-found"}, {"$ref": "#/components/schemas/internal"}]}}}}
      }},
      "delete": {"operationId": "deleteThing", "responses": {
        "204": {"description": "Gone.", "headers": {"X-Thing-Version": {"required": true, "schema": {"type": "integer"}}}}
      }}
    },
    "/flows/{flow_id}": {
      "parameters": [{"name": "flow_id", "in": "path", "required": true, "schema": {"type": "string"}}],
      "get": {"operationId": "getFlowStep", "responses": {
        "200": {"description": "The step.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/thing"}}}}
      }}
    },
    "/live": {"get": {"operationId": "getLive", "responses": {
      "200": {"description": "Up.", "content": {"text/plain": {"schema": {"type": "string"}}}}
    }}}
  },
  "components": {"schemas": {
    "thing": {"type": "object", "required": ["id", "created_at", "link"], "properties": {
      "id": {"type": "string"},
      "created_at": {"type": "string", "format": "date-time"},
      "link": {"$ref": "#/components/schemas/link"}}},
    "link": {"type": "string", "format": "uri"},
    "error": {"type": "object", "required": ["code", "message"], "properties": {
      "code": {"type": "string"}, "message": {"type": "string"}}},
    "thing-not-found": {"type": "object", "required": ["code", "message"], "properties": {
      "code": {"const": "thing.not_found"}, "message": {"type": "string"}}},
    "internal": {"type": "object", "required": ["code", "message"], "properties": {
      "code": {"const": "internal"}, "message": {"type": "string"}}}
  }}
}`

const (
	goodThing       = `{"id":"t1","created_at":"2026-11-12T10:00:00Z","link":"https://example.test/t1"}`
	thingNotFound   = `{"code":"thing.not_found","message":"No thing."}`
	jsonContentType = "application/json"
)

type exchange struct {
	method, target string
	status         int
	header         http.Header
	body           string
}

func jsonAnswer(method, target string, status int, body string) exchange {
	return exchange{method, target, status, http.Header{"Content-Type": {jsonContentType}}, body}
}

// serve answers e through the validator.
func serve(v *SpecValidator, e exchange) {
	handler := v.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		for name, values := range e.header {
			w.Header()[name] = values
		}
		w.WriteHeader(e.status)
		_, _ = w.Write([]byte(e.body))
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(e.method, e.target, nil))
}

func fixtureValidator(t *testing.T) *SpecValidator {
	t.Helper()
	v, err := NewSpecValidator([]byte(fixtureSpec))
	require.NoError(t, err)
	return v
}

func TestSpecValidatorPassesWhatTheSpecDeclares(t *testing.T) {
	v := fixtureValidator(t)
	for _, e := range []exchange{
		jsonAnswer(http.MethodGet, "/api/v1/things/t1", http.StatusOK, goodThing),
		jsonAnswer(http.MethodGet, "/things/t1", http.StatusOK, goodThing), // the root alias
		jsonAnswer(http.MethodGet, "/api/v1/flows/f1", http.StatusOK, goodThing),
		jsonAnswer(http.MethodGet, "/api/v1/flow/f1", http.StatusOK, goodThing), // the flow operations' old path
		jsonAnswer(http.MethodGet, "/flow/f1", http.StatusOK, goodThing),
		jsonAnswer(http.MethodGet, "/api/v1/flowsx/f1", http.StatusNotFound, `{}`),
		jsonAnswer(http.MethodGet, "/api/v1/things/t1", http.StatusNotFound, thingNotFound),
		jsonAnswer(http.MethodGet, "/api/v1/things/t1", http.StatusForbidden, thingNotFound),
		{http.MethodDelete, "/api/v1/things/t1", http.StatusNoContent, http.Header{"X-Thing-Version": {"3"}}, ""},
		{http.MethodGet, "/api/v1/live", http.StatusOK, http.Header{"Content-Type": {"text/plain; charset=utf-8"}}, "ok"},
		jsonAnswer(http.MethodGet, "/api/v1/nothing", http.StatusNotFound, `{}`),
		jsonAnswer(http.MethodPut, "/api/v1/live", http.StatusMethodNotAllowed, `{}`),
	} {
		serve(v, e)
	}
	assert.NoError(t, v.CheckSpecConformance())
}

func TestSpecValidatorCatchesWhatTheSpecDoesNotDeclare(t *testing.T) {
	for _, tc := range []struct {
		name   string
		answer exchange
		reason string
	}{
		{"a body against its schema",
			jsonAnswer(http.MethodGet, "/api/v1/things/t1", http.StatusOK, `{"id":"t1"}`), "created_at"},
		{"a date-time",
			jsonAnswer(http.MethodGet, "/api/v1/things/t1", http.StatusOK, `{"id":"t1","created_at":"yesterday","link":"https://example.test"}`), "at '/created_at'"},
		{"a uri",
			jsonAnswer(http.MethodGet, "/api/v1/things/t1", http.StatusOK, `{"id":"t1","created_at":"2026-11-12T10:00:00Z","link":"/t1"}`), "not an absolute URI"},
		{"an error code outside the error set",
			jsonAnswer(http.MethodGet, "/api/v1/things/t1", http.StatusForbidden, `{"code":"user.not_found","message":"x"}`), "value must be 'thing.not_found'"},
		{"an undeclared status",
			jsonAnswer(http.MethodGet, "/api/v1/things/t1", http.StatusCreated, goodThing), "status 201 is not declared"},
		{"a success the error set does not cover",
			jsonAnswer(http.MethodGet, "/api/v1/things/t1", http.StatusAccepted, thingNotFound), "status 202 is not declared"},
		{"an undeclared content type",
			exchange{http.MethodGet, "/api/v1/things/t1", http.StatusOK, http.Header{"Content-Type": {"text/html"}}, "<p>t1</p>"}, `"text/html"`},
		{"a body on a status without one",
			exchange{http.MethodDelete, "/api/v1/things/t1", http.StatusNoContent, http.Header{"X-Thing-Version": {"3"}, "Content-Type": {jsonContentType}}, `{}`}, "declares no body"},
		{"a missing required header",
			exchange{http.MethodDelete, "/api/v1/things/t1", http.StatusNoContent, http.Header{}, ""}, "X-Thing-Version"},
		{"a body at the flow operations' old path, against the operation's schema",
			jsonAnswer(http.MethodGet, "/api/v1/flow/f1", http.StatusOK, `{"id":"t1"}`), "created_at"},
		{"a path that only starts as the flow collection does, answered",
			jsonAnswer(http.MethodGet, "/api/v1/flowsx/f1", http.StatusOK, goodThing), "names no operation"},
		{"a path the spec lacks, answered",
			jsonAnswer(http.MethodGet, "/api/v1/nothing", http.StatusOK, `{}`), "names no operation"},
		{"a method the path lacks, answered",
			exchange{http.MethodPut, "/api/v1/live", http.StatusOK, http.Header{"Content-Type": {"text/plain"}}, "ok"}, "names no operation"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v := fixtureValidator(t)
			serve(v, tc.answer)
			err := v.CheckSpecConformance()
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.reason)
		})
	}
}

func TestSpecValidatorLoadsTheBundle(t *testing.T) {
	var h Harness
	require.NotNil(t, h.EnsureSpecValidator(t))
}
