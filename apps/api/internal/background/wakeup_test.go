package background

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testSecret = "0123456789abcdef-wake-up"

// periodic is a task with a round, which answers as the server's purge does:
// its loop where instances come and go, a wake-up where the process is
// paused.
func periodic(name string, once func(ctx context.Context) error) Task {
	return Task{
		Name:        name,
		Start:       func(context.Context) error { return nil },
		Once:        once,
		ScaleToZero: WhileUp(),
		RequestOnly: OnWakeUp("turn it off"),
	}
}

// counted is a round that counts its runs.
func counted(runs *int) func(context.Context) error {
	return func(context.Context) error { *runs++; return nil }
}

// woken returns the wake-up endpoint of a group that started tasks.
func woken(t *testing.T, lifecycle Lifecycle, tasks ...Task) http.Handler {
	t.Helper()
	g := NewGroup(lifecycle, WakeUpConfig{Secret: testSecret})
	t.Cleanup(g.Close)
	for _, task := range tasks {
		require.NoError(t, g.Start(t.Context(), task))
	}
	wakeUp := g.WakeUp()
	require.NotNil(t, wakeUp)
	return wakeUp
}

func serveWakeUp(wakeUp http.Handler, method, authorization string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, WakeUpPath, nil)
	if authorization != "" {
		r.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	wakeUp.ServeHTTP(rec, r)
	return rec
}

func TestWakeUpConfigValidate(t *testing.T) {
	for _, tt := range []struct {
		name    string
		secret  string
		wantErr bool
	}{
		{name: "no endpoint", secret: ""},
		{name: "sixteen printable characters", secret: "!0123456789abcd~"},
		{name: "a secret 1Password generates", secret: "q7#Lx!9vR@2mP$wZ&4kT"},
		{name: "fifteen characters", secret: "0123456789abcde", wantErr: true},
		{name: "a space, which a header trims at the ends", secret: "0123456789 abcdef", wantErr: true},
		{name: "a line break", secret: "0123456789abcdef\n", wantErr: true},
		{name: "beyond ASCII", secret: "0123456789abcdefé", wantErr: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			err := WakeUpConfig{Secret: tt.secret}.Validate()
			if !tt.wantErr {
				assert.NoError(t, err)
				return
			}
			assert.EqualError(t, err, "server.wake_up.secret must be at least 16 printable ASCII characters, without spaces")
		})
	}
}

// Without a secret nobody could be told from the scheduler, so there is no
// endpoint.
func TestWakeUpOnlyWithASecret(t *testing.T) {
	assert.Nil(t, NewGroup(AlwaysOn, WakeUpConfig{}).WakeUp())
	assert.NotNil(t, NewGroup(AlwaysOn, WakeUpConfig{Secret: testSecret}).WakeUp())
}

// One call runs one round of every periodic task that is on, in every
// lifecycle: where the process is paused nothing else runs them, and where
// instances come and go the call that starts one keeps it up until the
// rounds are done. A task without a round and a task that is off are not the
// call's.
func TestWakeUpRunsEveryPeriodicTaskOncePerCall(t *testing.T) {
	for _, lifecycle := range Lifecycles {
		for _, tt := range []struct{ method, authorization string }{
			// What Vercel's cron job sends.
			{http.MethodGet, "Bearer " + testSecret},
			{http.MethodPost, "Bearer " + testSecret},
			// The scheme is case-insensitive (RFC 9110 §11.1).
			{http.MethodGet, "bearer " + testSecret},
		} {
			t.Run(string(lifecycle)+"/"+tt.method+" "+tt.authorization[:6], func(t *testing.T) {
				var purges, shipments, off, started int
				notPeriodic := Task{
					Name:        "master key re-wrap",
					Start:       func(context.Context) error { started++; return nil },
					ScaleToZero: WhileUp(),
					RequestOnly: InRequest(func(context.Context) error { started++; return nil }),
				}
				turnedOff := periodic("service ping", counted(&off))
				turnedOff.Disabled = true
				wakeUp := woken(t, lifecycle,
					periodic("event retention", counted(&purges)),
					notPeriodic,
					turnedOff,
					periodic("event export", counted(&shipments)))

				rec := serveWakeUp(wakeUp, tt.method, tt.authorization)

				require.Equal(t, http.StatusOK, rec.Code)
				assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
				assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
				assert.JSONEq(t, `{"tasks":[{"name":"event_retention","ok":true},{"name":"event_export","ok":true}]}`, rec.Body.String())
				assert.Equal(t, []int{1, 1, 0, 1}, []int{purges, shipments, off, started}, "one round per periodic task per call")

				serveWakeUp(wakeUp, tt.method, tt.authorization)
				assert.Equal(t, []int{2, 2}, []int{purges, shipments}, "and one more per further call")
			})
		}
	}
}

// A server with no periodic task that is on still answers the scheduler.
func TestWakeUpWithNothingToRun(t *testing.T) {
	rec := serveWakeUp(woken(t, RequestOnly), http.MethodGet, "Bearer "+testSecret)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"tasks":[]}`, rec.Body.String())
}

func TestWakeUpRefusesARequestWithoutTheSecret(t *testing.T) {
	for name, authorization := range map[string]string{
		"no credentials":            "",
		"another secret":            "Bearer 0123456789abcdef-another",
		"the secret, cut short":     "Bearer " + testSecret[:len(testSecret)-1],
		"the secret, and then some": "Bearer " + testSecret + "x",
		"another scheme":            "Basic " + testSecret,
		"the secret alone":          testSecret,
	} {
		t.Run(name, func(t *testing.T) {
			var runs int

			rec := serveWakeUp(woken(t, RequestOnly, periodic("event retention", counted(&runs))), http.MethodGet, authorization)

			assert.Equal(t, http.StatusUnauthorized, rec.Code)
			assert.Equal(t, "Bearer", rec.Header().Get("WWW-Authenticate"))
			assert.Zero(t, runs)
		})
	}
}

func TestWakeUpAnswersOnlyGetAndPost(t *testing.T) {
	for _, method := range []string{http.MethodPut, http.MethodDelete, http.MethodHead} {
		t.Run(method, func(t *testing.T) {
			var runs int

			rec := serveWakeUp(woken(t, RequestOnly, periodic("event retention", counted(&runs))), method, "Bearer "+testSecret)

			assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)
			assert.Equal(t, "GET, POST", rec.Header().Get("Allow"))
			assert.Zero(t, runs)
		})
	}
}

// A round that fails does not keep the next from running, and the scheduler
// hears that the call failed and which task did.
func TestWakeUpAnswersAFailedRoundWith500AndRunsTheRest(t *testing.T) {
	var shipments int
	wakeUp := woken(t, RequestOnly,
		periodic("event retention", func(context.Context) error { return errors.New("failed to connect to db.internal") }),
		periodic("event export", counted(&shipments)))

	rec := serveWakeUp(wakeUp, http.MethodGet, "Bearer "+testSecret)

	assert.Equal(t, http.StatusInternalServerError, rec.Code, "the scheduler's log shows the call failed")
	assert.JSONEq(t, `{"tasks":[{"name":"event_retention","ok":false},{"name":"event_export","ok":true}]}`, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "db.internal", "the cause stays in the server's log")
	assert.Equal(t, 1, shipments)
}

// The rounds of one call share its time: each runs under what is left of the
// call's context, and one that finds it ended is reported, not skipped.
func TestWakeUpRunsEachRoundUnderTheCallsContext(t *testing.T) {
	g := NewGroup(RequestOnly, WakeUpConfig{Secret: testSecret})
	ctx, cancel := context.WithCancel(t.Context())
	require.NoError(t, g.Start(t.Context(), periodic("event retention", func(context.Context) error { cancel(); return nil })))
	require.NoError(t, g.Start(t.Context(), periodic("event export", func(ctx context.Context) error { return ctx.Err() })))

	answer, err := g.runPeriodic(ctx)

	require.ErrorIs(t, err, context.Canceled)
	assert.ErrorContains(t, err, "event export: context canceled")
	assert.Equal(t, []wakeUpTask{{Name: "event_retention", OK: true}, {Name: "event_export", OK: false}}, answer.Tasks)
}

// The server gives a request 30 seconds to be read and answered, as
// cmd/server sets its timeouts; a purge may take minutes. Past the write
// deadline the scheduler would never hear the result.
func TestWakeUpOutlastsTheServerTimeouts(t *testing.T) {
	slow := func(ctx context.Context) error {
		select {
		case <-time.After(300 * time.Millisecond):
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	srv := httptest.NewUnstartedServer(woken(t, RequestOnly, periodic("event retention", slow)))
	srv.Config.ReadTimeout = 50 * time.Millisecond
	srv.Config.WriteTimeout = 50 * time.Millisecond
	srv.Start()
	t.Cleanup(srv.Close)

	r, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+WakeUpPath, nil)
	require.NoError(t, err)
	r.Header.Set("Authorization", "Bearer "+testSecret)
	res, err := srv.Client().Do(r)
	require.NoError(t, err)
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	require.NoError(t, err)

	assert.Equal(t, http.StatusOK, res.StatusCode)
	assert.JSONEq(t, `{"tasks":[{"name":"event_retention","ok":true}]}`, string(body))
}
