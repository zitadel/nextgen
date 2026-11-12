package audit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/background"
	"github.com/zitadel/nextgen/internal/domain"
)

// startRequestBuffer is a buffer whose flusher runs, as the server's does
// once its background group started the buffer's task.
func startRequestBuffer(insert EventBatchInserter, cfg RequestBufferConfig) *RequestBuffer {
	buf := NewRequestBuffer(insert, cfg)
	if err := buf.Task().Start(context.Background()); err != nil {
		panic(err)
	}
	return buf
}

const testWakeUpSecret = "0123456789abcdef-wake-up"

// group is the background group of a process in lifecycle that has no
// wake-up endpoint, closed with the test.
func group(t *testing.T, lifecycle background.Lifecycle) *background.Group {
	t.Helper()
	g := background.NewGroup(lifecycle, background.WakeUpConfig{})
	t.Cleanup(g.Close)
	return g
}

// wokenGroup is the group of a process that a scheduler can wake.
func wokenGroup(t *testing.T, lifecycle background.Lifecycle) *background.Group {
	t.Helper()
	g := background.NewGroup(lifecycle, background.WakeUpConfig{Secret: testWakeUpSecret})
	t.Cleanup(g.Close)
	return g
}

// wake calls g's wake-up endpoint as a scheduler does and returns the status.
func wake(t *testing.T, g *background.Group) int {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, background.WakeUpPath, nil)
	r.Header.Set("Authorization", "Bearer "+testWakeUpSecret)
	rec := httptest.NewRecorder()
	g.WakeUp().ServeHTTP(rec, r)
	return rec.Code
}

// Paused between requests, the flusher only runs while a request waits for
// its event, so a wait of zero fails the start instead of writing after the
// response.
func TestRequestBufferTaskRequestOnly(t *testing.T) {
	t.Run("without a wait the start fails", func(t *testing.T) {
		buf := NewRequestBuffer(&channelInserter{}, RequestBufferConfig{})
		err := group(t, background.RequestOnly).Start(t.Context(), buf.Task())
		require.ErrorContains(t, err, "request audit events where server.lifecycle is request_only")
		assert.ErrorContains(t, err, "events.request.flush_wait is 0")
	})
	t.Run("with a wait a request returns with its event written", func(t *testing.T) {
		ins := &channelInserter{}
		buf := NewRequestBuffer(ins, RequestBufferConfig{MaxAge: time.Hour, FlushWait: RequestOnlyFlushWait})
		require.NoError(t, group(t, background.RequestOnly).Start(t.Context(), buf.Task()))
		buf.EnqueueSince(t.Context(), requestEvent(), time.Now())
		assert.Equal(t, 1, ins.count())
	})
}

// Where the platform stops the last instance, the flusher writes after the
// response as it does always on, with no wait, and the stop drains it: what
// an instance took, it has written by the time it is gone.
func TestRequestBufferTaskScaleToZero(t *testing.T) {
	ins := &channelInserter{}
	buf := NewRequestBuffer(ins, RequestBufferConfig{MaxAge: time.Hour, BatchSize: 100})
	g := background.NewGroup(background.ScaleToZero, background.WakeUpConfig{})
	require.NoError(t, g.Start(t.Context(), buf.Task()))
	buf.Enqueue(requestEvent())
	g.Close()
	assert.Equal(t, 1, ins.count())
}

// Paused between requests, no timer purges: the purge runs when the server is
// woken, and a start without the wake-up endpoint would be a deployment that
// never purges.
func TestRetentionJobTaskRequestOnly(t *testing.T) {
	t.Run("without the wake-up endpoint the start fails", func(t *testing.T) {
		p := &fakePurger{}
		err := group(t, background.RequestOnly).Start(t.Context(), NewRetentionJob(p, RetentionConfig{Enabled: true}).Task())
		require.ErrorContains(t, err, "event retention cannot run on a timer where server.lifecycle is request_only")
		assert.ErrorContains(t, err, "server.wake_up.secret")
		assert.ErrorContains(t, err, background.WakeUpPath)
		assert.ErrorContains(t, err, "events.retention.enabled")
		assert.Empty(t, p.Calls())
	})
	t.Run("with it a call purges and no loop does", func(t *testing.T) {
		p := &fakePurger{}
		g := wokenGroup(t, background.RequestOnly)
		require.NoError(t, g.Start(t.Context(), NewRetentionJob(p, RetentionConfig{Enabled: true}).Task()))
		assert.Empty(t, p.Calls(), "a loop would purge as it starts")

		require.Equal(t, http.StatusOK, wake(t, g))
		assert.Len(t, p.Calls(), 1)
	})
	t.Run("retention off needs no endpoint, and a call purges nothing", func(t *testing.T) {
		require.NoError(t, group(t, background.RequestOnly).Start(t.Context(), NewRetentionJob(&fakePurger{}, RetentionConfig{}).Task()))

		p := &fakePurger{}
		g := wokenGroup(t, background.RequestOnly)
		require.NoError(t, g.Start(t.Context(), NewRetentionJob(p, RetentionConfig{}).Task()))
		require.Equal(t, http.StatusOK, wake(t, g))
		assert.Empty(t, p.Calls())
	})
}

// A process that runs between requests purges on its own timer, starting
// with a purge as it starts. That first purge is what makes the timer enough
// where instances come and go: one that never lives a whole interval has
// still purged.
func TestRetentionJobTaskStartsTheLoop(t *testing.T) {
	for _, lifecycle := range []background.Lifecycle{background.AlwaysOn, background.ScaleToZero} {
		t.Run(string(lifecycle), func(t *testing.T) {
			p := &fakePurger{}
			g := background.NewGroup(lifecycle, background.WakeUpConfig{})
			require.NoError(t, g.Start(t.Context(), NewRetentionJob(p, RetentionConfig{Enabled: true, Interval: time.Hour}).Task()))
			require.Eventually(t, func() bool { return len(p.Calls()) == 1 }, time.Second, time.Millisecond)
			g.Close()
		})
	}
}

// Where instances come and go, a deployment that gets no request has none to
// run the timer. A scheduler's call starts one, and its purge is done when
// the call is answered, so the platform does not stop the instance under it.
func TestRetentionJobTaskScaleToZeroPurgesWhenWoken(t *testing.T) {
	p := &fakePurger{}
	g := wokenGroup(t, background.ScaleToZero)
	require.NoError(t, g.Start(t.Context(), NewRetentionJob(p, RetentionConfig{Enabled: true, Interval: time.Hour}).Task()))
	require.Eventually(t, func() bool { return len(p.Calls()) == 1 }, time.Second, time.Millisecond, "the loop's purge at start")

	require.Equal(t, http.StatusOK, wake(t, g))
	assert.Len(t, p.Calls(), 2, "and the call's own")
}

// sinkCountingSource counts the sinks a shipper registers.
type sinkCountingSource struct {
	*fakeExportSource
	ensured int
}

func (s *sinkCountingSource) EnsureSink(ctx context.Context, sink *domain.EventSink) error {
	s.ensured++
	sink.ID = "sink_deployment_stdout"
	return s.fakeExportSource.EnsureSink(ctx, sink)
}

// Paused between requests, no timer ships: the export runs when the server
// is woken, each call shipping what is pending from the stored cursor.
func TestShipperTaskRequestOnly(t *testing.T) {
	stdout := ExportConfig{Enabled: true, Sinks: []SinkConfig{{Type: domain.EventSinkTypeStdout}}}
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	pending := func() *sinkCountingSource {
		return &sinkCountingSource{fakeExportSource: newFakeExportSource([]string{"proj_a"}, map[string][]*domain.Event{
			"proj_a": {{ProjectID: "proj_a", ID: "evt_1", CreatedAt: t0, EventType: domain.EventTypeUserCreated, Category: domain.EventCategoryEntity}},
		})}
	}

	t.Run("without the wake-up endpoint the start fails", func(t *testing.T) {
		err := group(t, background.RequestOnly).Start(t.Context(), NewShipper(pending(), stdout).Task())
		require.ErrorContains(t, err, "event export cannot run on a timer where server.lifecycle is request_only")
		assert.ErrorContains(t, err, "server.wake_up.secret")
		assert.ErrorContains(t, err, "events.export.enabled")
	})
	t.Run("with it each call ships what is pending", func(t *testing.T) {
		src := pending()
		g := wokenGroup(t, background.RequestOnly)
		require.NoError(t, g.Start(t.Context(), NewShipper(src, stdout).Task()))
		assert.Zero(t, src.ensured, "the start costs no statement")
		assert.Empty(t, src.upserts, "and ships nothing")

		require.Equal(t, http.StatusOK, wake(t, g))
		require.Len(t, src.upserts, 1)
		assert.Equal(t, "evt_1", src.upserts[0].LastEventID)

		require.Equal(t, http.StatusOK, wake(t, g))
		assert.Len(t, src.upserts, 1, "a second call ships from the cursor: nothing")
		assert.Equal(t, 1, src.ensured, "the sinks are registered once per process")
	})
	t.Run("export off needs no endpoint", func(t *testing.T) {
		require.NoError(t, group(t, background.RequestOnly).Start(t.Context(), NewShipper(pending(), ExportConfig{}).Task()))
	})
}

// Where instances come and go the shipper ships while one is up.
func TestShipperTaskScaleToZero(t *testing.T) {
	src := newFakeExportSource(nil, nil)
	require.NoError(t, group(t, background.ScaleToZero).Start(t.Context(), NewShipper(src, ExportConfig{Enabled: true}).Task()))
}
