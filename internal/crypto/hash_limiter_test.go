package crypto

import (
	"context"
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

func TestHashConcurrencyConfig_validate(t *testing.T) {
	t.Parallel()

	assert.Error(t, HashConcurrencyConfig{MaxOperations: -1}.validate())
	assert.Error(t, HashConcurrencyConfig{MemoryBudget: -1}.validate())
	assert.Error(t, HashConcurrencyConfig{MaxWait: -time.Second}.validate())
	assert.NoError(t, HashConcurrencyConfig{}.validate())

	// Zero values fall back to defaults rather than to a budget of nothing.
	l := newTestLimiter(t, HashConcurrencyConfig{})
	assert.Equal(t, int64(DefaultHashMemoryBudget), l.budget)
	assert.Positive(t, l.floor)
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

// With every hash at the floor, the budget admits exactly max_operations of
// them, whatever else is asking.
func TestHashLimiter_boundsOperations(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		l := newTestLimiter(t, HashConcurrencyConfig{MaxOperations: 4, MemoryBudget: 4096, MaxWait: time.Hour})

		var (
			mu   sync.Mutex
			peak int64
		)
		proceed := make(chan struct{})
		var wg sync.WaitGroup
		for range 16 {
			wg.Go(func() {
				release, err := l.acquire(t.Context(), 0)
				if !assert.NoError(t, err) {
					return
				}
				defer release()
				mu.Lock()
				peak = max(peak, l.inFlight.Load())
				mu.Unlock()
				<-proceed
			})
		}

		synctest.Wait()
		assert.Equal(t, int64(4), l.inFlight.Load(), "four hold a slot")
		assert.Equal(t, int64(12), l.waiting.Load(), "the rest are queued")
		assert.Equal(t, int64(4096), l.reserved.Load())

		close(proceed)
		wg.Wait()
		assert.Equal(t, int64(4), peak, "never more than max_operations at once")
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
		var over atomic.Bool
		for _, estimate := range []int64{600, 600, 300} {
			wg.Go(func() {
				release, err := l.acquire(t.Context(), estimate)
				if !assert.NoError(t, err) {
					return
				}
				defer release()
				if l.reserved.Load() > l.budget {
					over.Store(true)
				}
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
		assert.False(t, over.Load(), "reserved memory exceeded the budget")
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

func TestHashLimiter_zeroMaxWaitRefusesAtOnce(t *testing.T) {
	t.Parallel()

	l := newTestLimiter(t, HashConcurrencyConfig{MaxOperations: 1, MemoryBudget: 1000})
	release, err := l.acquire(t.Context(), 0)
	require.NoError(t, err)
	defer release()

	_, err = l.acquire(t.Context(), 0)
	assert.ErrorIs(t, err, ErrHashingBusy)
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
