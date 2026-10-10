package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api"
)

// A home that accepts one cookie, and a region that records what the service
// asks of it: the create, the challenge with the one-time secret, the
// completion with the cookie and its CSRF token.
const goodCookie = "cookie-of-user-1"

func fakeHome(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/sessions/me" {
			http.NotFound(w, r)
			return
		}
		cookie, err := r.Cookie(sessionCookie)
		if err != nil || cookie.Value != goodCookie {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, `{"code":"auth.unauthorized","message":"Missing or invalid session token."}`)
			return
		}
		_, _ = io.WriteString(w, `{"session_id":"sess_1","state":"active","user_id":"user_1","expires_at":"2100-01-01T00:00:00Z"}`)
	}))
}

type fakeRegion struct {
	t     *testing.T
	calls []string
	fail  bool
}

func (f *fakeRegion) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/projects":
		if f.fail {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = io.WriteString(w, `{"code":"internal","message":"down"}`)
			return
		}
		var in struct {
			Name string `json:"name"`
		}
		_ = json.Unmarshal(body, &in)
		f.calls = append(f.calls, "create "+in.Name)
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"id":"proj_1","name":"`+in.Name+`","project_secret":"secret_once","preview_secret":"pk","preview_origins":[],"created_at":"2026-10-10T00:00:00Z"}`)
	case r.Method == http.MethodPost && r.URL.Path == "/projects/proj_1/claim/init":
		f.calls = append(f.calls, "init "+r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"claim_url":"https://cloud.example/console/claim","challenge_id":"ch_1","expires_at":"2100-01-01T00:00:00Z"}`)
	case r.Method == http.MethodPost && r.URL.Path == "/projects/proj_1/claim/complete":
		cookie, err := r.Cookie(sessionCookie)
		if err != nil || cookie.Value != goodCookie || r.Header.Get(api.CSRFHeader) != api.CSRFToken(goodCookie) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, `{"code":"auth.unauthorized","message":"Missing or invalid session token."}`)
			return
		}
		var in struct {
			ChallengeID string `json:"challenge_id"`
		}
		_ = json.Unmarshal(body, &in)
		f.calls = append(f.calls, "complete "+in.ChallengeID)
		_, _ = io.WriteString(w, `{"project_id":"proj_1","team_id":"team_1","claimed_at":"2026-10-10T00:00:01Z"}`)
	default:
		http.NotFound(w, r)
	}
}

type memStore struct {
	mu         sync.Mutex
	placements []placement
}

func (m *memStore) insert(_ context.Context, p placement) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.placements = append(m.placements, p)
	return nil
}

func (m *memStore) listByUser(_ context.Context, userID string) ([]placement, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []placement
	for _, p := range m.placements {
		if p.UserID == userID {
			out = append(out, p)
		}
	}
	return out, nil
}

func (m *memStore) ping(context.Context) error { return nil }

func newTestServer(t *testing.T, regionHandler http.Handler) (*server, *memStore) {
	t.Helper()
	home := fakeHome(t)
	t.Cleanup(home.Close)
	regionSrv := httptest.NewServer(regionHandler)
	t.Cleanup(regionSrv.Close)
	store := &memStore{}
	regions := newRegionClient([]region{{ID: "eu", Name: "EU (Frankfurt)", APIBase: regionSrv.URL}, {ID: "us", Name: "US (Ohio)", APIBase: "/us"}}, "cloud.example", map[string]string{"x-vercel-protection-bypass": "b"})
	srv := newServer(store, newHomeClient(home.URL, nil, time.Minute), regions, slog.New(slog.NewTextHandler(io.Discard, nil)))
	return srv, store
}

func call(srv http.Handler, method, path, cookie, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: cookie})
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

func TestRegionsArePublic(t *testing.T) {
	srv, _ := newTestServer(t, &fakeRegion{t: t})
	rec := call(srv, http.MethodGet, "/regions", "", "")
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"id":"eu"`)
	assert.Contains(t, rec.Body.String(), `"api_base":"/us"`)
}

func TestProjectsNeedTheHomeSession(t *testing.T) {
	srv, _ := newTestServer(t, &fakeRegion{t: t})
	for _, cookie := range []string{"", "other"} {
		rec := call(srv, http.MethodGet, "/me/projects", cookie, "")
		assert.Equal(t, http.StatusUnauthorized, rec.Code, "cookie %q", cookie)
		rec = call(srv, http.MethodPost, "/projects", cookie, `{"name":"x","region":"eu"}`)
		assert.Equal(t, http.StatusUnauthorized, rec.Code, "cookie %q", cookie)
	}
}

func TestCreateProjectInARegionAndListIt(t *testing.T) {
	region := &fakeRegion{t: t}
	srv, store := newTestServer(t, region)

	rec := call(srv, http.MethodGet, "/me/projects", goodCookie, "")
	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"projects":[]}`, rec.Body.String())

	rec = call(srv, http.MethodPost, "/projects", goodCookie, `{"name":"  River ","region":"eu"}`)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	var created projectItem
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &created))
	assert.Equal(t, "proj_1", created.ID)
	assert.Equal(t, "River", created.Name)
	assert.Equal(t, "eu", created.Region.ID)
	assert.Equal(t, "team_1", created.TeamID)
	assert.Equal(t, []string{"create River", "init Bearer secret_once", "complete ch_1"}, region.calls)
	require.Len(t, store.placements, 1)
	assert.Equal(t, placement{ProjectID: "proj_1", RegionID: "eu", UserID: "user_1", TeamID: "team_1", Name: "River", CreatedAt: time.Date(2026, 10, 10, 0, 0, 0, 0, time.UTC)}, store.placements[0])

	rec = call(srv, http.MethodGet, "/me/projects", goodCookie, "")
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"id":"proj_1"`)
	assert.Contains(t, rec.Body.String(), `"name":"EU (Frankfurt)"`)
}

func TestCreateProjectRefusals(t *testing.T) {
	t.Run("unknown region", func(t *testing.T) {
		srv, store := newTestServer(t, &fakeRegion{t: t})
		rec := call(srv, http.MethodPost, "/projects", goodCookie, `{"name":"River","region":"mars"}`)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Empty(t, store.placements)
	})
	t.Run("no name", func(t *testing.T) {
		srv, _ := newTestServer(t, &fakeRegion{t: t})
		rec := call(srv, http.MethodPost, "/projects", goodCookie, `{"name":"  ","region":"eu"}`)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})
	t.Run("the region fails", func(t *testing.T) {
		srv, store := newTestServer(t, &fakeRegion{t: t, fail: true})
		rec := call(srv, http.MethodPost, "/projects", goodCookie, `{"name":"River","region":"eu"}`)
		assert.Equal(t, http.StatusBadGateway, rec.Code)
		assert.Contains(t, rec.Body.String(), "cloud.region_failed")
		assert.Empty(t, store.placements)
	})
}

func TestRegionBaseURL(t *testing.T) {
	c := newRegionClient(nil, "cloud.example", nil)
	assert.Equal(t, "https://cloud.example/eu", c.baseURL(region{APIBase: "/eu"}))
	assert.Equal(t, "https://us.example/api", c.baseURL(region{APIBase: "https://us.example/api"}))
}

func TestParseRegions(t *testing.T) {
	regions, err := parseRegions(`[{"id":"eu","name":"EU","api_base":"/eu"}]`)
	require.NoError(t, err)
	assert.Equal(t, []region{{ID: "eu", Name: "EU", APIBase: "/eu"}}, regions)
	regions, err = parseRegions("")
	require.NoError(t, err)
	assert.Nil(t, regions)
	_, err = parseRegions(`[{"id":"eu"}]`)
	require.Error(t, err)
	_, err = parseRegions(`eu`)
	require.Error(t, err)
}
