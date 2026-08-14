package audit

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

func TestRequestEventMiddleware_SkipsUnauthenticated(t *testing.T) {
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
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/flow", nil))
	time.Sleep(40 * time.Millisecond)
	assert.Equal(t, uint64(0), buf.Flushed())
	assert.Equal(t, 0, buf.Len())
}
