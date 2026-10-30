package audit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

type fakePurger struct {
	mu    sync.Mutex
	calls []time.Time
	n     int64
	err   error
}

func (f *fakePurger) DeleteEventsOlderThan(_ context.Context, createdBefore time.Time) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, createdBefore)
	return f.n, f.err
}

func (f *fakePurger) Calls() []time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]time.Time(nil), f.calls...)
}

const testTriggerSecret = "0123456789abcdef-trigger"

func TestRetentionJob_RunOnce(t *testing.T) {
	p := &fakePurger{n: 2}
	j := NewRetentionJob(p, RetentionConfig{
		Retention: time.Hour,
		Interval:  time.Hour,
		Enabled:   true,
	})
	j.runOnce()
	require.Len(t, p.calls, 1)
	assert.True(t, p.calls[0].Before(time.Now()))
}

func TestRetentionJob_CloseCancelsInFlightRun(t *testing.T) {
	started := make(chan struct{})
	p := &blockingPurger{started: started}
	j := NewRetentionJob(p, RetentionConfig{
		Retention: time.Hour,
		Interval:  time.Hour,
		Enabled:   true,
	})
	j.Start()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("purge did not start")
	}
	done := make(chan struct{})
	go func() {
		j.Close()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not return")
	}
}

type blockingPurger struct {
	started chan struct{}
}

func (p *blockingPurger) DeleteEventsOlderThan(ctx context.Context, _ time.Time) (int64, error) {
	close(p.started)
	<-ctx.Done()
	return 0, ctx.Err()
}

func TestRetentionConfig_Validate(t *testing.T) {
	for _, tt := range []struct {
		name    string
		secret  string
		wantErr bool
	}{
		{name: "no trigger", secret: ""},
		{name: "sixteen printable characters", secret: "!0123456789abcd~"},
		{name: "a secret 1Password generates", secret: "q7#Lx!9vR@2mP$wZ&4kT"},
		{name: "fifteen characters", secret: "0123456789abcde", wantErr: true},
		{name: "a space, which a header trims at the ends", secret: "0123456789 abcdef", wantErr: true},
		{name: "a line break", secret: "0123456789abcdef\n", wantErr: true},
		{name: "beyond ASCII", secret: "0123456789abcdefé", wantErr: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			err := RetentionConfig{TriggerSecret: tt.secret}.Validate()
			if !tt.wantErr {
				assert.NoError(t, err)
				return
			}
			assert.EqualError(t, err, "events.retention.trigger_secret must be at least 16 printable ASCII characters, without spaces")
		})
	}
}

// A server whose purge a trigger runs keeps no loop of its own: on a platform
// that runs it only while it serves a request, the loop's runs start outside
// any request and fail.
func TestRetentionJob_StartRunsTheLoopOnlyWithoutATrigger(t *testing.T) {
	for _, tt := range []struct {
		name     string
		cfg      RetentionConfig
		wantLoop bool
	}{
		{name: "hourly in process", cfg: RetentionConfig{Enabled: true}, wantLoop: true},
		{name: "left to the trigger", cfg: RetentionConfig{Enabled: true, TriggerSecret: testTriggerSecret}},
		{name: "off", cfg: RetentionConfig{TriggerSecret: testTriggerSecret}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			p := &fakePurger{}
			j := NewRetentionJob(p, tt.cfg)
			j.Start()
			select {
			case <-j.done:
				assert.False(t, tt.wantLoop, "the loop must run")
				assert.Empty(t, p.Calls(), "nothing purges without a request")
			default:
				assert.True(t, tt.wantLoop, "no loop may run")
			}
			j.Close()
		})
	}
}

func TestRetentionJob_TriggerOnlyWithASecretAndRetentionOn(t *testing.T) {
	assert.Nil(t, NewRetentionJob(&fakePurger{}, RetentionConfig{Enabled: true}).Trigger(), "no secret, no trigger")
	assert.Nil(t, NewRetentionJob(&fakePurger{}, RetentionConfig{TriggerSecret: testTriggerSecret}).Trigger(), "retention off turns the trigger off too")
	assert.NotNil(t, NewRetentionJob(&fakePurger{}, RetentionConfig{Enabled: true, TriggerSecret: testTriggerSecret}).Trigger())
}

func newTrigger(t *testing.T, p EventPurger) http.Handler {
	t.Helper()
	trigger := NewRetentionJob(p, RetentionConfig{Retention: time.Hour, Enabled: true, TriggerSecret: testTriggerSecret}).Trigger()
	require.NotNil(t, trigger)
	return trigger
}

func serveTrigger(trigger http.Handler, method, authorization string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, RetentionTriggerPath, nil)
	if authorization != "" {
		r.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	trigger.ServeHTTP(rec, r)
	return rec
}

func TestRetentionJob_TriggerPurgesOncePerRequest(t *testing.T) {
	for _, tt := range []struct{ method, authorization string }{
		// What Vercel's cron job sends.
		{http.MethodGet, "Bearer " + testTriggerSecret},
		{http.MethodPost, "Bearer " + testTriggerSecret},
		// The scheme is case-insensitive (RFC 9110 §11.1).
		{http.MethodGet, "bearer " + testTriggerSecret},
	} {
		t.Run(tt.method+" "+tt.authorization[:6], func(t *testing.T) {
			p := &fakePurger{n: 2}
			before := time.Now().UTC()

			rec := serveTrigger(newTrigger(t, p), tt.method, tt.authorization)

			require.Equal(t, http.StatusOK, rec.Code)
			assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
			assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
			assert.JSONEq(t, `{"deleted":2}`, rec.Body.String())
			calls := p.Calls()
			require.Len(t, calls, 1, "one purge per request")
			assert.WithinRange(t, calls[0], before.Add(-time.Hour), time.Now().UTC().Add(-time.Hour), "events older than the window")
		})
	}
}

func TestRetentionJob_TriggerRefusesARequestWithoutTheSecret(t *testing.T) {
	for name, authorization := range map[string]string{
		"no credentials":            "",
		"another secret":            "Bearer 0123456789abcdef-another",
		"the secret, cut short":     "Bearer " + testTriggerSecret[:len(testTriggerSecret)-1],
		"the secret, and then some": "Bearer " + testTriggerSecret + "x",
		"another scheme":            "Basic " + testTriggerSecret,
		"the secret alone":          testTriggerSecret,
	} {
		t.Run(name, func(t *testing.T) {
			p := &fakePurger{}

			rec := serveTrigger(newTrigger(t, p), http.MethodGet, authorization)

			assert.Equal(t, http.StatusUnauthorized, rec.Code)
			assert.Equal(t, "Bearer", rec.Header().Get("WWW-Authenticate"))
			assert.Empty(t, p.Calls())
		})
	}
}

func TestRetentionJob_TriggerAnswersOnlyGetAndPost(t *testing.T) {
	for _, method := range []string{http.MethodPut, http.MethodDelete, http.MethodHead} {
		t.Run(method, func(t *testing.T) {
			p := &fakePurger{}

			rec := serveTrigger(newTrigger(t, p), method, "Bearer "+testTriggerSecret)

			assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)
			assert.Equal(t, "GET, POST", rec.Header().Get("Allow"))
			assert.Empty(t, p.Calls())
		})
	}
}

func TestRetentionJob_TriggerAnswersAFailedPurgeWith500(t *testing.T) {
	p := &fakePurger{err: errors.New("failed to connect")}

	rec := serveTrigger(newTrigger(t, p), http.MethodGet, "Bearer "+testTriggerSecret)

	assert.Equal(t, http.StatusInternalServerError, rec.Code, "the scheduler's log shows the run failed")
	assert.Equal(t, "event retention: purge failed\n", rec.Body.String(), "the cause stays in the server's log")
}

// serveTriggerLogged is serveTrigger behind the request logging the server
// mounts the trigger with, and returns the error line, parsed, or nil when
// the request got none.
func serveTriggerLogged(t *testing.T, trigger http.Handler, method, authorization string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var logs bytes.Buffer
	r := httptest.NewRequest(method, RetentionTriggerPath, nil)
	if authorization != "" {
		r.Header.Set("Authorization", authorization)
	}
	r = r.WithContext(zlog.WithLoggingContext(r.Context(), slog.New(slog.NewJSONHandler(&logs, nil))))
	rec := httptest.NewRecorder()
	middleware.WithLogging(trigger).ServeHTTP(rec, r)

	var errorLine map[string]any
	for line := range bytes.Lines(logs.Bytes()) {
		var record map[string]any
		require.NoError(t, json.Unmarshal(line, &record))
		if record["msg"] == "api error" {
			require.Nil(t, errorLine, "one error line per request")
			errorLine = record
		}
	}
	return rec, errorLine
}

// A refused request or a failed run records its error for the error line:
// the scheduler's log shows the status, the server's the cause.
func TestRetentionJob_TriggerRecordsTheErrorItAnswers(t *testing.T) {
	for _, tt := range []struct {
		name          string
		method        string
		authorization string
		purger        *fakePurger
		wantStatus    int
		wantLevel     string
		wantCode      string
		wantParent    string
	}{
		{"a method it does not take", http.MethodPut, "Bearer " + testTriggerSecret, &fakePurger{}, http.StatusMethodNotAllowed, "INFO", domain.ErrRequestMethodNotAllowed().Code, ""},
		{"without the secret", http.MethodGet, "", &fakePurger{}, http.StatusUnauthorized, "INFO", domain.ErrAuthUnauthorized(nil).Code, ""},
		{"a failed purge", http.MethodGet, "Bearer " + testTriggerSecret, &fakePurger{err: errors.New("failed to connect")}, http.StatusInternalServerError, "ERROR", domain.ErrInternal(nil).Code, "failed to connect"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			rec, line := serveTriggerLogged(t, newTrigger(t, tt.purger), tt.method, tt.authorization)

			require.Equal(t, tt.wantStatus, rec.Code)
			require.NotNil(t, line)
			assert.Equal(t, tt.wantLevel, line["level"])
			assert.EqualValues(t, tt.wantStatus, line["status"])
			logged := line["error"].(map[string]any)
			assert.Equal(t, tt.wantCode, logged["code"])
			if tt.wantParent != "" {
				assert.Equal(t, tt.wantParent, logged["parent"])
			}
		})
	}

	t.Run("a run that went well", func(t *testing.T) {
		rec, line := serveTriggerLogged(t, newTrigger(t, &fakePurger{n: 2}), http.MethodGet, "Bearer "+testTriggerSecret)

		require.Equal(t, http.StatusOK, rec.Code)
		assert.Nil(t, line)
	})
}

// slowPurger takes its time, as a purge with a backlog does, unless its
// context ends first.
type slowPurger struct{ took time.Duration }

func (p slowPurger) DeleteEventsOlderThan(ctx context.Context, _ time.Time) (int64, error) {
	select {
	case <-time.After(p.took):
		return 3, nil
	case <-ctx.Done():
		return 0, ctx.Err()
	}
}

// The server gives a request 30 seconds to be read and answered, as
// cmd/server sets its timeouts; a purge may take minutes. Past the write
// deadline the scheduler would never hear the result.
func TestRetentionJob_TriggerOutlastsTheServerTimeouts(t *testing.T) {
	srv := httptest.NewUnstartedServer(newTrigger(t, slowPurger{took: 300 * time.Millisecond}))
	srv.Config.ReadTimeout = 50 * time.Millisecond
	srv.Config.WriteTimeout = 50 * time.Millisecond
	srv.Start()
	t.Cleanup(srv.Close)

	r, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+RetentionTriggerPath, nil)
	require.NoError(t, err)
	r.Header.Set("Authorization", "Bearer "+testTriggerSecret)
	res, err := srv.Client().Do(r)
	require.NoError(t, err)
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	require.NoError(t, err)

	assert.Equal(t, http.StatusOK, res.StatusCode)
	assert.JSONEq(t, `{"deleted":3}`, string(body))
}

// countingPurger counts its calls and blocks each until its context ends.
type countingPurger struct {
	mu      sync.Mutex
	calls   int
	started chan struct{}
}

func (p *countingPurger) DeleteEventsOlderThan(ctx context.Context, _ time.Time) (int64, error) {
	p.mu.Lock()
	p.calls++
	p.mu.Unlock()
	p.started <- struct{}{}
	<-ctx.Done()
	return 0, ctx.Err()
}

// A second purge, a manual run beside the scheduled one, waits for the first
// instead of scanning the same rows at the same time.
func TestRetentionJob_PurgesOfOneProcessRunOneAfterTheOther(t *testing.T) {
	p := &countingPurger{started: make(chan struct{}, 2)}
	j := NewRetentionJob(p, RetentionConfig{Retention: time.Hour, Enabled: true})

	first, endFirst := context.WithCancel(t.Context())
	defer endFirst()
	go func() { _, _ = j.deleteExpired(first) }()
	<-p.started

	second, endSecond := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer endSecond()
	_, err := j.deleteExpired(second)

	assert.ErrorIs(t, err, context.DeadlineExceeded, "the second waited for the first until its own deadline")
	p.mu.Lock()
	defer p.mu.Unlock()
	assert.Equal(t, 1, p.calls, "the second never reached the database")
}
