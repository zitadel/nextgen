package crypto

import (
	"context"
	"math"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

var testLimits = HashLimitsConfig{
	Argon2: Argon2LimitsConfig{MinMemory: 8 * 1024, MaxMemory: 256 * 1024},
	Scrypt: ScryptLimitsConfig{MinLN: 12, MaxLN: 18, MinR: 8, MaxR: 8},
}

func newTestLimiter(t *testing.T, cfg HashConcurrencyConfig, opts ...metrics.Option) *hashLimiter {
	t.Helper()
	l, err := cfg.newLimiter(testLimits, opts)
	require.NoError(t, err)
	return l
}

// Zero values fall back to defaults rather than to a budget of nothing or a
// wait of nothing, and a configuration validate rejects never becomes a
// limiter.
func TestHashConcurrencyConfig_newLimiter(t *testing.T) {
	t.Parallel()

	_, err := HashConcurrencyConfig{MaxWait: -time.Second}.newLimiter(testLimits, nil)
	assert.Error(t, err)

	l := newTestLimiter(t, HashConcurrencyConfig{})
	assert.Positive(t, l.budget)
	assert.Positive(t, l.floor())
	assert.Equal(t, DefaultHashMaxWait, l.maxWait)

	l = newTestLimiter(t, HashConcurrencyConfig{MemoryBudget: 1 << 20, MaxWait: time.Minute})
	assert.Equal(t, int64(1<<20), l.budget, "a configured budget is taken as is")
	assert.Equal(t, time.Minute, l.maxWait)
}

// An unset budget follows the process's memory limit, which the server sets
// from the container's: half of it, so the hashes leave room for the rest.
// Without a limit the fixed default stands. Not parallel: the limit is
// process-wide.
func TestDeriveHashMemoryBudget(t *testing.T) {
	previous := debug.SetMemoryLimit(-1)
	t.Cleanup(func() { debug.SetMemoryLimit(previous) })

	debug.SetMemoryLimit(math.MaxInt64)
	assert.Equal(t, int64(DefaultHashMemoryBudget), deriveHashMemoryBudget(), "no limit: the default")
	assert.Equal(t, int64(DefaultHashMemoryBudget), newTestLimiter(t, HashConcurrencyConfig{}).budget)

	debug.SetMemoryLimit(1 << 30)
	assert.Equal(t, int64(1<<29), deriveHashMemoryBudget(), "half the limit")
	assert.Equal(t, int64(1<<29), newTestLimiter(t, HashConcurrencyConfig{}).budget)
	assert.Equal(t, int64(1<<20), newTestLimiter(t, HashConcurrencyConfig{MemoryBudget: 1 << 20}).budget, "a configured budget wins")
}

func TestHashLimiter_weight(t *testing.T) {
	t.Parallel()

	l := newTestLimiter(t, HashConcurrencyConfig{MaxOperations: 4, MemoryBudget: 1000})
	tests := []struct {
		name     string
		estimate int64
		want     int64
	}{
		{"nothing to count takes the floor", 0, 250},
		{"below the floor takes the floor", 100, 250},
		{"above the floor takes its own size", 600, 600},
		{"larger than the budget is clamped to it", 5000, 1000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, l.weight(tt.estimate))
		})
	}
}

// With max_operations unset the floor is budget / GOMAXPROCS as it stands at
// each acquisition, so a CPU quota the runtime picks up later moves it; a
// configured max_operations is fixed.
func TestHashLimiter_floorFollowsGOMAXPROCS(t *testing.T) {
	t.Parallel()

	procs := 4
	l := newTestLimiter(t, HashConcurrencyConfig{MemoryBudget: 1000})
	l.procs = func() int { return procs }
	assert.Equal(t, int64(250), l.weight(0))
	procs = 2
	assert.Equal(t, int64(500), l.weight(0))
	procs = 0
	assert.Equal(t, int64(1000), l.weight(0), "never divides by nothing")

	fixed := newTestLimiter(t, HashConcurrencyConfig{MaxOperations: 4, MemoryBudget: 1000})
	fixed.procs = func() int { return 1 }
	assert.Equal(t, int64(250), fixed.weight(0))
}

// A release gives back the weight that was taken, not the weight the floor
// would be now, so a moved floor never leaks or over-releases the budget.
func TestHashLimiter_releasesTheWeightAcquired(t *testing.T) {
	t.Parallel()

	procs := 4
	l := newTestLimiter(t, HashConcurrencyConfig{MemoryBudget: 1000, MaxWait: time.Hour})
	l.procs = func() int { return procs }

	release, err := l.acquire(t.Context(), 0)
	require.NoError(t, err)
	assert.Equal(t, int64(250), l.reserved.Load())

	procs = 2
	release()
	assert.Zero(t, l.reserved.Load())
	assert.True(t, l.sem.TryAcquire(1000), "the whole budget is free again")
	l.sem.Release(1000)
}

// With every hash at the floor, the budget admits exactly max_operations of
// them, whatever else is asking.
func TestHashLimiter_boundsOperations(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		l := newTestLimiter(t, HashConcurrencyConfig{MaxOperations: 4, MemoryBudget: 4096, MaxWait: time.Hour})

		proceed := make(chan struct{})
		var wg sync.WaitGroup
		for range 16 {
			wg.Go(func() {
				release, err := l.acquire(t.Context(), 0)
				if !assert.NoError(t, err) {
					return
				}
				defer release()
				<-proceed
			})
		}

		synctest.Wait()
		assert.Equal(t, int64(4), l.inFlight.Load(), "four hold a slot")
		assert.Equal(t, int64(12), l.waiting.Load(), "the rest are queued")
		assert.Equal(t, int64(4096), l.reserved.Load())

		close(proceed)
		wg.Wait()
		assert.Zero(t, l.inFlight.Load())
		assert.Zero(t, l.waiting.Load())
		assert.Zero(t, l.reserved.Load())
	})
}

// A memory-heavy hash takes its own share, so what runs together stays under
// the budget however the weights are mixed.
func TestHashLimiter_boundsMemory(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		l := newTestLimiter(t, HashConcurrencyConfig{MaxOperations: 10, MemoryBudget: 1000, MaxWait: time.Hour})

		proceed := make(chan struct{})
		var wg sync.WaitGroup
		for _, estimate := range []int64{600, 600, 300} {
			wg.Go(func() {
				release, err := l.acquire(t.Context(), estimate)
				if !assert.NoError(t, err) {
					return
				}
				defer release()
				<-proceed
			})
			// Admission is in order of arrival, so the test knows who waits.
			synctest.Wait()
		}

		assert.Equal(t, int64(600), l.reserved.Load(), "the first fills most of the budget")
		assert.Equal(t, int64(1), l.inFlight.Load())
		assert.Equal(t, int64(2), l.waiting.Load(), "the 300 waits behind the second 600 rather than past it")

		close(proceed)
		wg.Wait()
		assert.Zero(t, l.reserved.Load())
	})
}

// A hash the limits admit but the budget does not fit still runs, alone.
func TestHashLimiter_oversizedHashRunsAlone(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		l := newTestLimiter(t, HashConcurrencyConfig{MaxOperations: 4, MemoryBudget: 1000, MaxWait: time.Hour})

		releaseBig, err := l.acquire(t.Context(), 5000)
		require.NoError(t, err)
		assert.Equal(t, int64(1000), l.reserved.Load(), "clamped to the budget")

		var small atomic.Bool
		var wg sync.WaitGroup
		wg.Go(func() {
			release, err := l.acquire(t.Context(), 0)
			if assert.NoError(t, err) {
				small.Store(true)
				release()
			}
		})
		synctest.Wait()
		assert.False(t, small.Load(), "nothing else runs beside it")
		assert.Equal(t, int64(1), l.waiting.Load())

		releaseBig()
		wg.Wait()
		assert.True(t, small.Load())
	})
}

func TestHashLimiter_refusesAfterMaxWait(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		reader := sdkmetric.NewManualReader()
		provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
		l := newTestLimiter(t, HashConcurrencyConfig{MaxOperations: 1, MemoryBudget: 1000, MaxWait: 50 * time.Millisecond},
			metrics.WithMeterProvider(provider))

		release, err := l.acquire(t.Context(), 0)
		require.NoError(t, err)
		defer release()

		start := time.Now()
		_, err = l.acquire(t.Context(), 0)
		assert.ErrorIs(t, err, ErrHashingBusy)
		assert.Equal(t, 50*time.Millisecond, time.Since(start), "waited the whole max_wait first")
		assert.Zero(t, l.waiting.Load(), "a refused hash is no longer queued")
		assert.Equal(t, int64(1), l.inFlight.Load(), "the holder is unaffected")

		var collected metricdata.ResourceMetrics
		require.NoError(t, reader.Collect(t.Context(), &collected))
		assert.Equal(t, int64(1), int64Points(collected, metrics.PasswordHashingRejected))
		assert.Equal(t, int64(1), int64Points(collected, metrics.PasswordHashingInFlight), "the gauges read the limiter's own counts")
		assert.Equal(t, int64(0), int64Points(collected, metrics.PasswordHashingWaiting))
		assert.Equal(t, int64(1000), int64Points(collected, metrics.PasswordHashingMemoryReserved))
	})
}

// An unset max_wait is the default wait, not a refusal at once: a hash that
// finds every slot taken waits for one that frees up in time.
func TestHashLimiter_zeroMaxWaitWaitsTheDefault(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		l := newTestLimiter(t, HashConcurrencyConfig{MaxOperations: 1, MemoryBudget: 1000})
		release, err := l.acquire(t.Context(), 0)
		require.NoError(t, err)

		go func() {
			time.Sleep(DefaultHashMaxWait / 2)
			release()
		}()

		start := time.Now()
		release, err = l.acquire(t.Context(), 0)
		require.NoError(t, err, "admitted once the holder let go")
		release()
		assert.Equal(t, DefaultHashMaxWait/2, time.Since(start))

		hold, err := l.acquire(t.Context(), 0)
		require.NoError(t, err)
		defer hold()
		start = time.Now()
		_, err = l.acquire(t.Context(), 0)
		assert.ErrorIs(t, err, ErrHashingBusy)
		assert.Equal(t, DefaultHashMaxWait, time.Since(start), "refused after the default wait")
	})
}

// The caller's own deadline or cancellation is not a refusal: it is reported
// as what it is, so nobody records a busy server against the user.
func TestHashLimiter_callerContextIsNotBusy(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		l := newTestLimiter(t, HashConcurrencyConfig{MaxOperations: 1, MemoryBudget: 1000, MaxWait: time.Hour})
		release, err := l.acquire(t.Context(), 0)
		require.NoError(t, err)
		defer release()

		ctx, cancel := context.WithTimeout(t.Context(), 10*time.Millisecond)
		defer cancel()
		_, err = l.acquire(ctx, 0)
		assert.ErrorIs(t, err, context.DeadlineExceeded)
		assert.NotErrorIs(t, err, ErrHashingBusy)

		done, cancelDone := context.WithCancel(t.Context())
		cancelDone()
		_, err = l.acquire(done, 0)
		assert.ErrorIs(t, err, context.Canceled, "a done context is answered before any wait")
	})
}

// A nil limiter is what a hasher built without a factory has; it must not
// turn into a nil dereference.
func TestHashLimiter_nilAdmitsEverything(t *testing.T) {
	t.Parallel()

	var l *hashLimiter
	release, err := l.acquire(t.Context(), 1<<40)
	require.NoError(t, err)
	release()
}

// int64Points adds every int64 point of the named instrument, a sum or a
// gauge, which is what proves the instrument was registered and fed rather
// than that the calls compiled.
func int64Points(collected metricdata.ResourceMetrics, name string) int64 {
	var sum int64
	for _, scope := range collected.ScopeMetrics {
		for _, m := range scope.Metrics {
			if m.Name != name {
				continue
			}
			switch data := m.Data.(type) {
			case metricdata.Sum[int64]:
				for _, point := range data.DataPoints {
					sum += point.Value
				}
			case metricdata.Gauge[int64]:
				for _, point := range data.DataPoints {
					sum += point.Value
				}
			}
		}
	}
	return sum
}
