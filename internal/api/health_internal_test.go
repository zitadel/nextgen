package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
)

// fakeDatabase answers a ping with err, and keeps the deadline it was asked
// under.
type fakeDatabase struct {
	err      error
	deadline time.Time
}

func (d *fakeDatabase) Ping(ctx context.Context) error {
	d.deadline, _ = ctx.Deadline()
	return d.err
}

func newHealthTestServer(t *testing.T, database Pinger) *api.Server {
	t.Helper()
	srv, err := api.NewServer((&Handler{}).WithReadinessCheck(database), NewSecurityHandler(nil), api.WithErrorHandler(OgenErrorHandler))
	require.NoError(t, err)
	return srv
}

func probe(srv http.Handler, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

// /readyz answers whether the database does; /livez answers whether the
// process serves, so a database outage restarts no instance.
func TestProbes(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		database  Pinger
		readyCode int
		readyBody string
	}{
		{"the database answers", &fakeDatabase{}, http.StatusOK, "ok"},
		{"the database is unreachable", &fakeDatabase{err: errors.New("dial tcp 127.0.0.1:5432: connect: connection refused")}, http.StatusServiceUnavailable, "fail"},
		{"no database to ask", nil, http.StatusServiceUnavailable, "fail"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			srv := newHealthTestServer(t, tc.database)

			ready := probe(srv, "/readyz")
			require.Equal(t, tc.readyCode, ready.Code)
			require.Equal(t, tc.readyBody, ready.Body.String())
			require.Equal(t, "text/plain; charset=utf-8", ready.Header().Get("Content-Type"))

			live := probe(srv, "/livez")
			require.Equal(t, http.StatusOK, live.Code)
			require.Equal(t, "ok", live.Body.String())
		})
	}
}

// The ping runs under the probe's own deadline, so a database that hangs
// answers 503 once it passes instead of holding the probe open.
func TestReadyzBoundsThePing(t *testing.T) {
	t.Parallel()
	database := &fakeDatabase{}
	srv := newHealthTestServer(t, database)

	before := time.Now()
	probe(srv, "/readyz")
	after := time.Now()

	require.False(t, database.deadline.Before(before.Add(readyTimeout)), "deadline %v is shorter than the timeout", database.deadline)
	require.False(t, database.deadline.After(after.Add(readyTimeout)), "deadline %v is longer than the timeout", database.deadline)
}
