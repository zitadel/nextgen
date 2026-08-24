package audit

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestRequestEventMiddleware_WaitCoversHandlerDuration(t *testing.T) {
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize: 1,
		Capacity:  10,
		MaxAge:    time.Hour,
	})
	t.Cleanup(buf.Close)

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
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize: 1,
		Capacity:  10,
		MaxAge:    time.Hour,
	})
	t.Cleanup(buf.Close)

	h := WithRequestEventMiddleware(buf, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/healthz", nil))
	time.Sleep(40 * time.Millisecond)
	assert.Equal(t, uint64(0), buf.Flushed())
	assert.Equal(t, 0, buf.Len())
}

func TestRequestEventMiddleware_EmitsWhenProjectIDWithoutAuth(t *testing.T) {
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize: 1,
		Capacity:  10,
		MaxAge:    time.Hour,
	})
	t.Cleanup(buf.Close)

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
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize: 1,
		Capacity:  10,
		MaxAge:    time.Hour,
	})
	t.Cleanup(buf.Close)

	inner := WithRequestEventMiddleware(buf, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ac, ok := ActorSlotFromContext(r.Context())
		require.True(t, ok)
		ac.ProjectID = "proj_1"
		w.WriteHeader(http.StatusOK)
	}))
	h := middleware.WithUserAgentMiddleware(inner)

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

func TestRequestEventMiddleware_OriginFallsBackToHost(t *testing.T) {
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize: 1,
		Capacity:  10,
		MaxAge:    time.Hour,
	})
	t.Cleanup(buf.Close)

	h := WithRequestEventMiddleware(buf, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ac, ok := ActorSlotFromContext(r.Context())
		require.True(t, ok)
		ac.ProjectID = "proj_1"
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/events", nil)
	req.Host = "console.example.test"
	req.Header.Del("Origin")
	h.ServeHTTP(httptest.NewRecorder(), req)

	require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
	ins.mu.Lock()
	defer ins.mu.Unlock()
	require.Len(t, ins.events, 1)
	var meta domain.EventMetadata
	require.NoError(t, json.Unmarshal(ins.events[0].Metadata, &meta))
	require.NotNil(t, meta.Client)
	assert.Equal(t, "console.example.test", meta.Client.Origin)
	assert.Empty(t, meta.Client.IP)
	assert.Empty(t, meta.Client.UserAgent)
}

func TestRequestEventMiddleware_EmptyClientStaysEmptyObject(t *testing.T) {
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{
		BatchSize: 1,
		Capacity:  10,
		MaxAge:    time.Hour,
	})
	t.Cleanup(buf.Close)

	h := WithRequestEventMiddleware(buf, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ac, ok := ActorSlotFromContext(r.Context())
		require.True(t, ok)
		ac.ProjectID = "proj_1"
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/events", nil)
	req.Host = ""
	req.Header.Del("Origin")
	req.Header.Del("User-Agent")
	h.ServeHTTP(httptest.NewRecorder(), req)

	require.Eventually(t, func() bool { return buf.Flushed() >= 1 }, 2*time.Second, 10*time.Millisecond)
	ins.mu.Lock()
	defer ins.mu.Unlock()
	require.Len(t, ins.events, 1)
	assert.JSONEq(t, `{}`, string(ins.events[0].Metadata))
}
