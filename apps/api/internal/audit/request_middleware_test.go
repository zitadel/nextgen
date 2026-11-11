package audit

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/api/client"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
)

func startPathA(t *testing.T) (*channelInserter, *RequestBuffer) {
	t.Helper()
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize: 1,
		Capacity:  10,
		MaxAge:    time.Hour,
	})
	t.Cleanup(buf.Close)
	return ins, buf
}

func stampProject(projectID string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ac, ok := ActorSlotFromContext(r.Context()); ok {
			ac.ProjectID = projectID
		}
		w.WriteHeader(http.StatusOK)
	})
}

func TestRequestEventMiddleware_WaitCoversHandlerDuration(t *testing.T) {
	ins, buf := startPathA(t)

	h := WithRequestEventMiddleware(buf, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ac, ok := ActorSlotFromContext(r.Context())
		require.True(t, ok)
		ac.Authenticated = true
		ac.ProjectID = "proj_1"
		time.Sleep(30 * time.Millisecond)
		w.WriteHeader(http.StatusCreated)
	}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/users", nil))

	require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
	ins.mu.Lock()
	defer ins.mu.Unlock()
	require.Len(t, ins.waits, 1)
	assert.GreaterOrEqual(t, ins.waits[0], 30*time.Millisecond)
}

func TestRequestEventMiddleware_SkipsMissingProjectID(t *testing.T) {
	ins, buf := startPathA(t)

	h := WithRequestEventMiddleware(buf, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/livez", nil))
	time.Sleep(40 * time.Millisecond)
	assert.Equal(t, uint64(0), buf.Flushed())
	assert.Equal(t, 0, buf.Len())
	assert.Equal(t, 0, ins.count())
}

func TestRequestEventMiddleware_EmitsWhenProjectIDWithoutAuth(t *testing.T) {
	ins, buf := startPathA(t)

	h := WithRequestEventMiddleware(buf, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ac, ok := ActorSlotFromContext(r.Context())
		require.True(t, ok)
		ac.ProjectID = "proj_1"
		time.Sleep(20 * time.Millisecond)
		w.WriteHeader(http.StatusCreated)
	}))
	req := httptest.NewRequest(http.MethodPost, "/flow", nil)
	req = req.WithContext(middleware.WithRequestIDContext(req.Context(), "req_flow"))
	h.ServeHTTP(httptest.NewRecorder(), req)

	require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
	ins.mu.Lock()
	defer ins.mu.Unlock()
	require.Len(t, ins.events, 1)
	assert.Equal(t, domain.EventTypeRequestAPI, ins.events[0].EventType)
	assert.Equal(t, "proj_1", ins.events[0].ProjectID)
	require.NotNil(t, ins.events[0].RequestID)
	assert.Equal(t, "req_flow", *ins.events[0].RequestID)
	require.Len(t, ins.waits, 1)
	assert.GreaterOrEqual(t, ins.waits[0], 20*time.Millisecond)
}

func TestRequestEventMiddleware_ClientMetadataFromUserAgentAndOrigin(t *testing.T) {
	ins, buf := startPathA(t)
	h := middleware.WithUserAgentMiddleware(WithRequestEventMiddleware(buf, stampProject("proj_1")))

	req := httptest.NewRequest(http.MethodPost, "/users", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (test)")
	req.Header.Set("X-Forwarded-For", "203.0.113.9")
	req.Header.Set("Origin", "https://app.example.com")
	h.ServeHTTP(httptest.NewRecorder(), req)

	require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
	ins.mu.Lock()
	defer ins.mu.Unlock()
	require.Len(t, ins.events, 1)
	var meta domain.EventMetadata
	require.NoError(t, json.Unmarshal(ins.events[0].Metadata, &meta))
	require.NotNil(t, meta.Client)
	assert.Equal(t, "203.0.113.9", meta.Client.IP)
	assert.Equal(t, "Mozilla/5.0 (test)", meta.Client.UserAgent)
	assert.Equal(t, "https://app.example.com", meta.Client.Origin)
}

func TestRequestEventMiddleware_OmitsOriginWhenHeaderMissing(t *testing.T) {
	ins, buf := startPathA(t)
	h := WithRequestEventMiddleware(buf, stampProject("proj_1"))
	req := httptest.NewRequest(http.MethodGet, "/events", nil)
	req.Host = "console.example.test"
	req.Header.Set("User-Agent", "Mozilla/5.0 (test)")
	req.Header.Del("Origin")
	h.ServeHTTP(httptest.NewRecorder(), req)

	require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
	ins.mu.Lock()
	defer ins.mu.Unlock()
	require.Len(t, ins.events, 1)
	var meta domain.EventMetadata
	require.NoError(t, json.Unmarshal(ins.events[0].Metadata, &meta))
	require.NotNil(t, meta.Client)
	assert.Equal(t, "Mozilla/5.0 (test)", meta.Client.UserAgent)
	assert.Empty(t, meta.Client.Origin)
}

func TestRequestEventMiddleware_TruncatesOversizedClientHeaders(t *testing.T) {
	ins, buf := startPathA(t)
	h := WithRequestEventMiddleware(buf, stampProject("proj_1"))
	req := httptest.NewRequest(http.MethodGet, "/flow", nil)
	req.Header.Set("User-Agent", strings.Repeat("a", maxEventUserAgentBytes-1)+"☃"+strings.Repeat("x", 2048))
	req.Header.Set("Origin", strings.Repeat("b", maxEventOriginBytes+2048))
	h.ServeHTTP(httptest.NewRecorder(), req)

	require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
	ins.mu.Lock()
	defer ins.mu.Unlock()
	require.Len(t, ins.events, 1)
	require.Less(t, len(ins.events[0].Metadata), 2048)
	var meta domain.EventMetadata
	require.NoError(t, json.Unmarshal(ins.events[0].Metadata, &meta))
	require.NotNil(t, meta.Client)
	assert.Equal(t, strings.Repeat("a", maxEventUserAgentBytes-1), meta.Client.UserAgent)
	assert.Equal(t, strings.Repeat("b", maxEventOriginBytes), meta.Client.Origin)
}

func TestRequestEventMiddleware_EmptyClientStaysEmptyObject(t *testing.T) {
	ins, buf := startPathA(t)
	h := WithRequestEventMiddleware(buf, stampProject("proj_1"))
	req := httptest.NewRequest(http.MethodGet, "/events", nil)
	req.Header.Del("Origin")
	req.Header.Del("User-Agent")
	h.ServeHTTP(httptest.NewRecorder(), req)

	require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
	ins.mu.Lock()
	defer ins.mu.Unlock()
	require.Len(t, ins.events, 1)
	assert.JSONEq(t, `{}`, string(ins.events[0].Metadata))
}

// TestRequestEventMiddleware_CarriesTheAuthorizationMark: a handler marks the
// request (ADR 075 §5) after the actor was stamped, and the request.api event
// carries the mark beside the client context.
func TestRequestEventMiddleware_CarriesTheAuthorizationMark(t *testing.T) {
	ins, buf := startPathA(t)
	marking := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ac, ok := ActorSlotFromContext(r.Context()); ok {
			ac.ProjectID = "proj_platform"
		}
		MarkAuthorization(r.Context(), domain.EventAuthorizationMetadata{
			Path:               domain.EventAuthorizationPathPlatformOperator,
			ActorHomeProjectID: "proj_platform",
		})
		w.WriteHeader(http.StatusOK)
	})
	h := middleware.WithUserAgentMiddleware(WithRequestEventMiddleware(buf, marking))
	req := httptest.NewRequest(http.MethodGet, "/projects/proj_customer", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (test)")
	h.ServeHTTP(httptest.NewRecorder(), req)

	require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
	ins.mu.Lock()
	defer ins.mu.Unlock()
	require.Len(t, ins.events, 1)
	var meta domain.EventMetadata
	require.NoError(t, json.Unmarshal(ins.events[0].Metadata, &meta))
	require.NotNil(t, meta.Client)
	require.NotNil(t, meta.Authorization)
	assert.Equal(t, domain.EventAuthorizationPathPlatformOperator, meta.Authorization.Path)
	assert.Equal(t, "proj_platform", meta.Authorization.ActorHomeProjectID)
}

// The operation names the route an event records. The API is mounted under
// its prefix and at the root alias (ADR 077), so the mux pattern there names
// only the mount: a request refused before the operation ran records no
// route. A path of its own, the IdP callback, records its pattern.
func TestRequestEventMiddleware_RecordsTheOperationAsTheRoute(t *testing.T) {
	for _, tt := range []struct {
		name, pattern, path, operationID, want string
	}{
		{name: "under the prefix", pattern: client.PathPrefix + "/", path: client.PathPrefix + "/users/me", operationID: "getMyUser", want: "getMyUser"},
		{name: "at the root alias", pattern: "/", path: "/users/me", operationID: "getMyUser", want: "getMyUser"},
		{name: "refused under the prefix", pattern: client.PathPrefix + "/", path: client.PathPrefix + "/users/me"},
		{name: "refused at the root alias", pattern: "/", path: "/users/me"},
		{name: "a path of its own", pattern: "/idp/{slug}/callback", path: "/idp/google/callback", want: "/idp/{slug}/callback"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ins, buf := startPathA(t)
			mux := http.NewServeMux()
			mux.Handle(tt.pattern, WithRequestEventMiddleware(buf, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tt.operationID != "" {
					// What the ogen middleware does once the operation runs.
					middleware.WithOperationIDContext(r.Context(), tt.operationID)
				}
				stampProject("proj_1").ServeHTTP(w, r)
			})))
			// The holder the operation fills, which WithLogging plants outside.
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			mux.ServeHTTP(httptest.NewRecorder(), req.WithContext(middleware.WithOperationIDContext(req.Context(), "")))

			require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
			ins.mu.Lock()
			defer ins.mu.Unlock()
			require.Len(t, ins.events, 1)
			var payload domain.RequestAPIPayload
			require.NoError(t, json.Unmarshal(ins.events[0].Payload, &payload))
			assert.Equal(t, tt.want, payload.RouteTemplate)
			assert.Equal(t, tt.operationID, payload.OperationID)
		})
	}
}

// A request event carries its operation and status class beside the payload,
// as the columns GET /events reads them from by index. A request refused
// before an operation ran has a class and no operation.
func TestRequestEventMiddleware_IndexesTheOperationAndStatusClass(t *testing.T) {
	for _, tt := range []struct {
		name        string
		operationID string
		status      int
		wantClass   domain.HTTPStatusClass
	}{
		{name: "a failed call", operationID: "createUser", status: http.StatusConflict, wantClass: domain.HTTPStatusClassClientError},
		{name: "a successful call", operationID: "getMyUser", status: http.StatusOK, wantClass: domain.HTTPStatusClassSuccessful},
		{name: "refused before an operation ran", status: http.StatusUnauthorized, wantClass: domain.HTTPStatusClassClientError},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ins, buf := startPathA(t)
			h := WithRequestEventMiddleware(buf, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tt.operationID != "" {
					middleware.WithOperationIDContext(r.Context(), tt.operationID)
				}
				ac, _ := ActorSlotFromContext(r.Context())
				ac.ProjectID = "proj_1"
				w.WriteHeader(tt.status)
			}))
			req := httptest.NewRequest(http.MethodPost, "/users", nil)
			h.ServeHTTP(httptest.NewRecorder(), req.WithContext(middleware.WithOperationIDContext(req.Context(), "")))

			require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
			ins.mu.Lock()
			defer ins.mu.Unlock()
			require.Len(t, ins.events, 1)
			ev := ins.events[0]
			require.NotNil(t, ev.StatusClass)
			assert.Equal(t, tt.wantClass, *ev.StatusClass)
			if tt.operationID == "" {
				assert.Nil(t, ev.OperationID)
			} else {
				require.NotNil(t, ev.OperationID)
				assert.Equal(t, tt.operationID, *ev.OperationID)
			}
			var payload domain.RequestAPIPayload
			require.NoError(t, json.Unmarshal(ev.Payload, &payload))
			assert.Equal(t, tt.status, payload.Status, "the columns copy the payload")
		})
	}
}

// A request event records the operation, the method, the status and the
// duration, and nothing the handler wrote: the two webhook responses that
// carry a signing secret leave none of it in the event (ADR 089 §3).
func TestRequestEventMiddleware_RecordsNoResponseBody(t *testing.T) {
	const secret = "whsec_C2FVsBQIhrscChlQIMV+b5sSYspob7oDZJQk1o3DdH8="
	for _, operationID := range []string{"createWebhook", "rotateWebhookSecret"} {
		t.Run(operationID, func(t *testing.T) {
			ins, buf := startPathA(t)
			h := WithRequestEventMiddleware(buf, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				middleware.WithOperationIDContext(r.Context(), operationID)
				ac, ok := ActorSlotFromContext(r.Context())
				require.True(t, ok)
				ac.ProjectID = "proj_1"
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusCreated)
				_, err := w.Write([]byte(`{"id":"hook_1","secret":"` + secret + `"}`))
				require.NoError(t, err)
			}))
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/webhooks?project_id=proj_1", nil)
			h.ServeHTTP(rec, req.WithContext(middleware.WithOperationIDContext(req.Context(), "")))
			require.Contains(t, rec.Body.String(), secret, "the caller still gets the secret")

			require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
			ins.mu.Lock()
			defer ins.mu.Unlock()
			require.Len(t, ins.events, 1)
			var payload domain.RequestAPIPayload
			require.NoError(t, json.Unmarshal(ins.events[0].Payload, &payload))
			assert.Equal(t, operationID, payload.OperationID)
			// The whole row, not the payload alone: no column may hold it.
			row, err := json.Marshal(ins.events[0])
			require.NoError(t, err)
			assert.NotContains(t, string(row), "secret")
			assert.NotContains(t, string(row), "whsec_")
		})
	}
}
