//go:build postgres_integration

package tracing

import (
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/op"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
	"github.com/zitadel/nextgen/internal/cache"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// fixture is one user to patch with a project secret, which is a revocable
// token: the server reads its record on every request.
type fixture struct {
	client *helpers.ApiClient
	secret string
	userID string
}

func newFixture(tb testing.TB) fixture {
	tb.Helper()
	ctx := tb.Context()
	project, err := harness.EnsureProjectService(tb).Create(ctx, helpers.ProjectName(), nil, true)
	require.NoError(tb, err)
	user, err := harness.EnsureUserService(tb).CreateUser(ctx, service.CreateUserInput{
		ProjectID:  project.ID,
		SchemaURL:  test_data.UserSchemaURL,
		Attributes: harness.EnsureTestData(tb).Generator.GenerateUser(tb, "tracing@example.com"),
	})
	require.NoError(tb, err)

	// Minted through a key service of its own, so the server's key cache has
	// never seen this project's keys and the first request resolves them cold.
	crypters, err := cache.NewMeteredLRU[service.CrypterCacheKey, op.Crypto](cache.NameCrypter, 8)
	require.NoError(tb, err)
	signingKeys, err := cache.NewMeteredLRU[service.SigningKeyCacheKey, domain.SigningKey](cache.NameSigningKey, 8)
	require.NoError(tb, err)
	keys := service.NewKeyService(harness.EnsureServiceDB(tb), *harness.EnsureMasterKey(tb), crypters, signingKeys)
	secret, err := service.NewTokenService(keys, harness.EnsureServiceDB(tb)).GenerateJWE(ctx, project.Token())
	require.NoError(tb, err)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(tb).URL)
	require.NoError(tb, err)
	client.SetToken(secret)
	return fixture{client: client, secret: secret, userID: user.ID}
}

// patchUser is an authenticated write that also emits an audit event in its
// transaction.
func (f fixture) patchUser(tb testing.TB, nickname string) {
	tb.Helper()
	req := &api.PatchUserRequest{}
	require.NoError(tb, req.UnmarshalJSON([]byte(`{"attributes":{"nickname":"`+nickname+`"}}`)))
	resp, err := f.client.PatchUserByID(tb.Context(), req, api.PatchUserByIDParams{UserID: api.UserID(f.userID)})
	require.NoError(tb, err)
	require.IsType(tb, &api.User{}, resp)
}

// child returns the first span named name directly under parent.
func child(t *testing.T, spans tracetest.SpanStubs, parent tracetest.SpanStub, name string) tracetest.SpanStub {
	t.Helper()
	for _, s := range spans {
		if s.Name == name && s.Parent.SpanID() == parent.SpanContext.SpanID() {
			return s
		}
	}
	require.Failf(t, "span not found", "no %q under %q", name, parent.Name)
	return tracetest.SpanStub{}
}

// allowedAttributes is every attribute key a span may carry: ours, then the
// ones ogen sets on the server span. A new key needs a decision first.
var allowedAttributes = map[attribute.Key]bool{
	"db.system.name": true,
	"error.type":     true,
	"cache.hit":      true,
	"key.kind":       true,

	"oas.operation":             true,
	"http.request.method":       true,
	"http.route":                true,
	"http.response.status_code": true,
}

var sqlKeyword = regexp.MustCompile(`(?i)\b(select|insert|update|delete|from|where|values)\b`)

func TestAuthenticatedRequestTrace(t *testing.T) {
	if spanExporter == nil {
		t.Skip("BENCH_TRACING is set: spans go to the benchmark exporter")
	}
	f := newFixture(t)
	const nickname = "nick-traced"

	spanExporter.Reset()
	f.patchUser(t, nickname)
	spans := spanExporter.GetSpans()
	t.Logf("cold request: %d spans", len(spans))

	var roots tracetest.SpanStubs
	for _, s := range spans {
		if !s.Parent.IsValid() {
			roots = append(roots, s)
		}
	}
	require.Len(t, roots, 1)
	server := roots[0]
	assert.Equal(t, "PatchUserByID", server.Name)
	assert.Equal(t, trace.SpanKindServer, server.SpanKind)

	// Authentication: the token key resolves cold through the project KEK and
	// the master key, then the token record is read.
	introspect := child(t, spans, server, "TokenService.IntrospectToken")
	tokenKey := child(t, spans, introspect, "KeyService.GetCrypter")
	assert.Contains(t, tokenKey.Attributes, attribute.Bool("cache.hit", false))
	assert.Contains(t, child(t, spans, tokenKey, "KeyService.unwrapKey").Attributes, attribute.String("key.kind", "project"))
	kek := child(t, spans, tokenKey, "KeyService.GetCrypter")
	assert.Contains(t, kek.Attributes, attribute.Bool("cache.hit", false))
	assert.Contains(t, child(t, spans, kek, "KeyService.unwrapKey").Attributes, attribute.String("key.kind", "master"))
	child(t, spans, child(t, spans, introspect, "tokenStatements.GetTokenByID"), "pgx.query")

	// The operation: its statements, with the audit event in its transaction.
	apply := child(t, spans, child(t, spans, server, "UserService.PatchUser"), "UserService.ApplyActions")
	child(t, spans, apply, "userStatements.PatchUser")
	child(t, spans, child(t, spans, apply, "eventStatements.InsertEvent"), "pgx.query")

	assertNoSecrets(t, spans, f.secret, nickname)

	// Warm: the key is one cache hit with nothing below it.
	spanExporter.Reset()
	f.patchUser(t, nickname)
	spans = spanExporter.GetSpans()
	t.Logf("warm request: %d spans", len(spans))
	var lookups int
	for _, s := range spans {
		if s.Name != "KeyService.GetCrypter" {
			continue
		}
		lookups++
		assert.Contains(t, s.Attributes, attribute.Bool("cache.hit", true))
		for _, c := range spans {
			assert.NotEqual(t, s.SpanContext.SpanID(), c.Parent.SpanID(), "nothing runs under a cache hit, got %s", c.Name)
		}
	}
	assert.Equal(t, 1, lookups)
	assertNoSecrets(t, spans, f.secret, nickname)

	// Failing: ogen records the error on the server span. Only its code may
	// end up there, never its message.
	spanExporter.Reset()
	req := &api.PatchUserRequest{}
	require.NoError(t, req.UnmarshalJSON([]byte(`{"attributes":{"nickname":"`+nickname+`"}}`)))
	resp, err := f.client.PatchUserByID(t.Context(), req, api.PatchUserByIDParams{UserID: "user_does-not-exist"})
	require.NoError(t, err)
	require.IsType(t, &api.PatchUserByIDNotFound{}, resp)
	notFound := resp.(*api.PatchUserByIDNotFound)
	require.NotEmpty(t, notFound.Message)
	spans = spanExporter.GetSpans()
	server = child(t, spans, tracetest.SpanStub{}, "PatchUserByID")
	assert.Contains(t, server.Attributes, attribute.String("error.type", string(notFound.Code)))
	assertNoSecrets(t, spans, f.secret, nickname, notFound.Message)
}

// assertNoSecrets checks every span against the allowlist, and that no
// attribute value, event or status description carries a secret, a request
// value, an error message or SQL.
func assertNoSecrets(t *testing.T, spans tracetest.SpanStubs, secrets ...string) {
	t.Helper()
	for _, s := range spans {
		assert.Empty(t, s.Events, "%s: events carry error messages", s.Name)
		assert.Empty(t, s.Status.Description, "%s: status description", s.Name)
		for _, a := range s.Attributes {
			assert.True(t, allowedAttributes[a.Key], "%s: attribute %s is not allowed", s.Name, a.Key)
			value := a.Value.Emit()
			for _, secret := range secrets {
				assert.NotContains(t, value, secret, "%s: %s carries a secret or request value", s.Name, a.Key)
			}
			assert.False(t, sqlKeyword.MatchString(value), "%s: %s=%q looks like SQL", s.Name, a.Key, value)
		}
	}
}

// BenchmarkAuthenticatedRequest is the request of the test with a warm key
// cache, under the tracing mode BENCH_TRACING selects (off, 0.01 or 1).
func BenchmarkAuthenticatedRequest(b *testing.B) {
	if spanExporter != nil {
		b.Skip("set BENCH_TRACING to off, 0.01 or 1")
	}
	f := newFixture(b)
	f.patchUser(b, "nick-warm")
	for b.Loop() {
		f.patchUser(b, "nick-bench")
	}
}
