package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// documentHost serves client ID metadata documents, counting its fetches,
// and answers status instead while status is set.
type documentHost struct {
	*httptest.Server
	fetches atomic.Int32
	status  atomic.Int32
}

func newDocumentHost(t *testing.T) *documentHost {
	t.Helper()
	h := &documentHost{}
	h.Server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.fetches.Add(1)
		if status := h.status.Load(); status != 0 {
			w.WriteHeader(int(status))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"client_id":     h.URL + r.URL.Path,
			"client_name":   "Agent",
			"redirect_uris": []string{"http://127.0.0.1/callback"},
		})
	}))
	t.Cleanup(h.Close)
	return h
}

// clock is a time a test moves on by hand.
type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func TestDocumentCache(t *testing.T) {
	t.Parallel()
	newCache := func(t *testing.T) (*documentCache, *documentHost, *clock) {
		host := newDocumentHost(t)
		now := &clock{now: time.Now()}
		return newDocumentCache(host.Client(), now.Now), host, now
	}

	t.Run("a document is read once while it is fresh, by any number of requests at once", func(t *testing.T) {
		t.Parallel()
		cache, host, _ := newCache(t)
		var wg sync.WaitGroup
		for range 8 {
			wg.Go(func() {
				client, err := cache.client(context.Background(), host.URL+"/agent.json")
				assert.NoError(t, err)
				assert.Equal(t, "Agent", client.Name)
			})
		}
		wg.Wait()
		_, err := cache.client(context.Background(), host.URL+"/agent.json")
		require.NoError(t, err)
		assert.Equal(t, int32(1), host.fetches.Load())
	})

	t.Run("while its host cannot answer, the document read last still serves", func(t *testing.T) {
		t.Parallel()
		cache, host, now := newCache(t)
		_, err := cache.client(context.Background(), host.URL+"/agent.json")
		require.NoError(t, err)
		host.status.Store(http.StatusServiceUnavailable)
		now.advance(documentCacheTTL)

		client, err := cache.client(context.Background(), host.URL+"/agent.json")
		require.NoError(t, err, "a host that is down refuses no client")
		assert.Equal(t, "Agent", client.Name)
		_, err = cache.client(context.Background(), host.URL+"/agent.json")
		require.NoError(t, err)
		assert.Equal(t, int32(2), host.fetches.Load(), "the host is left alone for a while")

		now.advance(documentStaleTTL)
		_, err = cache.client(context.Background(), host.URL+"/agent.json")
		assert.ErrorIs(t, err, domain.ErrUnavailable(), "not past the stale limit")
		assert.NotErrorIs(t, err, errUnknownClient)
	})

	t.Run("a document never read is unavailable while its host is down, not an unknown client", func(t *testing.T) {
		t.Parallel()
		cache, host, _ := newCache(t)
		host.status.Store(http.StatusBadGateway)

		_, err := cache.client(context.Background(), host.URL+"/agent.json")
		assert.ErrorIs(t, err, domain.ErrUnavailable())
		assert.NotErrorIs(t, err, errUnknownClient)
	})

	t.Run("a refusal is remembered", func(t *testing.T) {
		t.Parallel()
		cache, host, now := newCache(t)
		host.status.Store(http.StatusNotFound)

		for range 3 {
			_, err := cache.client(context.Background(), host.URL+"/agent.json")
			assert.ErrorIs(t, err, errUnknownClient)
		}
		assert.Equal(t, int32(1), host.fetches.Load())

		now.advance(documentRefusalTTL)
		host.status.Store(0)
		_, err := cache.client(context.Background(), host.URL+"/agent.json")
		assert.NoError(t, err, "fetched again once the refusal is old")
	})

	t.Run("one host's documents take a bounded share of the cache", func(t *testing.T) {
		t.Parallel()
		cache, host, _ := newCache(t)
		cache.hostLimit = 3
		for i := range 3 {
			_, err := cache.client(context.Background(), fmt.Sprintf("%s/agent-%d.json", host.URL, i))
			require.NoError(t, err)
		}

		_, err := cache.client(context.Background(), host.URL+"/agent-3.json")
		assert.ErrorIs(t, err, domain.ErrUnavailable())
		assert.Equal(t, int32(3), host.fetches.Load(), "nothing fetched past the host's share")
	})

	t.Run("the cache holds a bounded number of documents", func(t *testing.T) {
		t.Parallel()
		cache, host, now := newCache(t)
		cache.limit = 2
		for i := range 4 {
			now.advance(time.Second)
			_, err := cache.client(context.Background(), fmt.Sprintf("%s/agent-%d.json", host.URL, i))
			require.NoError(t, err)
		}

		cache.mu.Lock()
		defer cache.mu.Unlock()
		assert.Len(t, cache.entries, 2)
		assert.Contains(t, cache.entries, host.URL+"/agent-3.json", "the newest stays")
	})
}
