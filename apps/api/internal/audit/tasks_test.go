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

// requestBound is the group of a process that runs only while it serves a
// request, closed with the test.
func requestBound(t *testing.T) *background.Group {
	t.Helper()
	g := background.NewGroup(true)
	t.Cleanup(g.Close)
	return g
}

// Request bound, the flusher only runs while a request waits for its event,
// so a wait of zero fails the start instead of writing after the response.
func TestRequestBufferTaskRequestBound(t *testing.T) {
	t.Run("without a wait the start fails", func(t *testing.T) {
		buf := NewRequestBuffer(&channelInserter{}, RequestBufferConfig{})
		err := requestBound(t).Start(t.Context(), buf.Task())
		require.ErrorContains(t, err, "request audit events where server.request_bound is set")
		assert.ErrorContains(t, err, "events.request.flush_wait is 0")
	})
	t.Run("with a wait a request returns with its event written", func(t *testing.T) {
		ins := &channelInserter{}
		buf := NewRequestBuffer(ins, RequestBufferConfig{MaxAge: time.Hour, FlushWait: RequestBoundFlushWait})
		require.NoError(t, requestBound(t).Start(t.Context(), buf.Task()))
		buf.EnqueueSince(t.Context(), requestEvent(), time.Now())
		assert.Equal(t, 1, ins.count())
	})
}

// Request bound, no timer purges: the purge is the trigger's, and a start
// without the trigger's secret would be a deployment that never purges.
func TestRetentionJobTaskRequestBound(t *testing.T) {
	t.Run("without a trigger secret the start fails", func(t *testing.T) {
		p := &fakePurger{}
		err := requestBound(t).Start(t.Context(), NewRetentionJob(p, RetentionConfig{Enabled: true}).Task())
		require.ErrorContains(t, err, "event retention cannot run on a timer where server.request_bound is set")
		assert.ErrorContains(t, err, "events.retention.trigger_secret")
		assert.ErrorContains(t, err, RetentionTriggerPath)
		assert.Empty(t, p.Calls())
	})
	t.Run("with one the trigger purges and no loop does", func(t *testing.T) {
		p := &fakePurger{}
		j := NewRetentionJob(p, RetentionConfig{Enabled: true, TriggerSecret: testTriggerSecret})
		require.NoError(t, requestBound(t).Start(t.Context(), j.Task()))
		assert.Empty(t, p.Calls(), "a loop would purge as it starts")
		assert.NotNil(t, j.Trigger())
	})
	t.Run("retention off needs no secret", func(t *testing.T) {
		require.NoError(t, requestBound(t).Start(t.Context(), NewRetentionJob(&fakePurger{}, RetentionConfig{}).Task()))
	})
}

// A process that keeps running purges on its own timer, starting with a
// purge as it starts.
func TestRetentionJobTaskStartsTheLoop(t *testing.T) {
	p := &fakePurger{}
	g := background.NewGroup(false)
	require.NoError(t, g.Start(t.Context(), NewRetentionJob(p, RetentionConfig{Enabled: true, Interval: time.Hour}).Task()))
	require.Eventually(t, func() bool { return len(p.Calls()) == 1 }, time.Second, time.Millisecond)
	g.Close()
}

// The shipper has no trigger, so request bound it refuses to start rather
// than ship whenever a request happens to wake the instance.
func TestShipperTaskRequestBound(t *testing.T) {
	src := newFakeExportSource(nil, nil)
	err := requestBound(t).Start(t.Context(), NewShipper(src, ExportConfig{Enabled: true}).Task())
	require.ErrorContains(t, err, "event export cannot run where server.request_bound is set")
	assert.ErrorContains(t, err, "events.export.enabled")

	require.NoError(t, requestBound(t).Start(t.Context(), NewShipper(src, ExportConfig{}).Task()), "export off")
}
