package audit

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/background"
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

// group is the background group of a process in lifecycle, closed with the
// test.
func group(t *testing.T, lifecycle background.Lifecycle) *background.Group {
	t.Helper()
	g := background.NewGroup(lifecycle)
	t.Cleanup(g.Close)
	return g
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
	g := background.NewGroup(background.ScaleToZero)
	require.NoError(t, g.Start(t.Context(), buf.Task()))
	buf.Enqueue(requestEvent())
	g.Close()
	assert.Equal(t, 1, ins.count())
}

// Paused between requests, no timer purges: the purge is the trigger's, and
// a start without the trigger's secret would be a deployment that never
// purges.
func TestRetentionJobTaskRequestOnly(t *testing.T) {
	t.Run("without a trigger secret the start fails", func(t *testing.T) {
		p := &fakePurger{}
		err := group(t, background.RequestOnly).Start(t.Context(), NewRetentionJob(p, RetentionConfig{Enabled: true}).Task())
		require.ErrorContains(t, err, "event retention cannot run on a timer where server.lifecycle is request_only")
		assert.ErrorContains(t, err, "events.retention.trigger_secret")
		assert.ErrorContains(t, err, RetentionTriggerPath)
		assert.Empty(t, p.Calls())
	})
	t.Run("with one the trigger purges and no loop does", func(t *testing.T) {
		p := &fakePurger{}
		j := NewRetentionJob(p, RetentionConfig{Enabled: true, TriggerSecret: testTriggerSecret})
		require.NoError(t, group(t, background.RequestOnly).Start(t.Context(), j.Task()))
		assert.Empty(t, p.Calls(), "a loop would purge as it starts")
		assert.NotNil(t, j.Trigger())
	})
	t.Run("retention off needs no secret", func(t *testing.T) {
		require.NoError(t, group(t, background.RequestOnly).Start(t.Context(), NewRetentionJob(&fakePurger{}, RetentionConfig{}).Task()))
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
			g := background.NewGroup(lifecycle)
			require.NoError(t, g.Start(t.Context(), NewRetentionJob(p, RetentionConfig{Enabled: true, Interval: time.Hour}).Task()))
			require.Eventually(t, func() bool { return len(p.Calls()) == 1 }, time.Second, time.Millisecond)
			g.Close()
		})
	}
}

// The shipper has no trigger, so paused between requests it refuses to start
// rather than ship whenever a request happens to wake the instance. Where
// instances come and go it ships while one is up.
func TestShipperTask(t *testing.T) {
	src := newFakeExportSource(nil, nil)
	err := group(t, background.RequestOnly).Start(t.Context(), NewShipper(src, ExportConfig{Enabled: true}).Task())
	require.ErrorContains(t, err, "event export cannot run where server.lifecycle is request_only")
	assert.ErrorContains(t, err, "events.export.enabled")

	require.NoError(t, group(t, background.RequestOnly).Start(t.Context(), NewShipper(src, ExportConfig{}).Task()), "export off")
	require.NoError(t, group(t, background.ScaleToZero).Start(t.Context(), NewShipper(src, ExportConfig{Enabled: true}).Task()))
}
