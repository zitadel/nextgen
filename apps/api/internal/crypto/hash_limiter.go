package crypto

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"golang.org/x/sync/semaphore"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

func (c HashConcurrencyConfig) newLimiter(limits HashLimitsConfig, opts []metrics.Option) (*hashLimiter, error) {
	if err := c.validate(); err != nil {
		return nil, err
	}
	maxOperations := c.MaxOperations
	if maxOperations == 0 {
		maxOperations = runtime.GOMAXPROCS(0)
	}
	budget := c.MemoryBudget
	if budget == 0 {
		budget = DefaultHashMemoryBudget
	}
	l := &hashLimiter{
		sem:     semaphore.NewWeighted(budget),
		budget:  budget,
		floor:   max(budget/int64(maxOperations), 1),
		maxWait: c.MaxWait,
		limits:  limits,
	}
	var err error
	l.metrics, err = metrics.NewPasswordHashing(metrics.PasswordHashingState{
		InFlight:       l.inFlight.Load,
		Waiting:        l.waiting.Load,
		MemoryReserved: l.reserved.Load,
	}, opts...)
	if err != nil {
		return nil, fmt.Errorf("password hashing instruments: %w", err)
	}
	return l, nil
}

// hashLimiter admits hashes against one memory budget. Each hash weighs the
// memory it is estimated to need, floored at budget / max_operations so that
// cheap hashes are still capped in number, and clamped at the budget so that a
// hash larger than the budget runs alone instead of never.
//
// A single weighted semaphore gives both bounds at once: with every weight at
// the floor it admits max_operations hashes, and a heavier hash displaces as
// many cheap ones as its memory is worth.
type hashLimiter struct {
	sem     *semaphore.Weighted
	budget  int64
	floor   int64
	maxWait time.Duration
	limits  HashLimitsConfig

	// The semaphore knows what it holds but not who waits, and the waiting
	// count is the one an autoscaler wants, so both are kept here.
	inFlight atomic.Int64
	waiting  atomic.Int64
	reserved atomic.Int64
	metrics  *metrics.PasswordHashing
}

func (l *hashLimiter) weight(estimate int64) int64 {
	return min(max(estimate, l.floor), l.budget)
}

// acquire takes a slot for a hash estimated at estimate bytes, waiting at most
// maxWait for one. The caller runs the hash and calls release after it. A nil
// limiter admits everything, which is what a hasher built without a factory
// gets.
//
// A refusal is told apart from the caller giving up by the cause of the wait
// context: the wait's own deadline carries [ErrHashingBusy], a done caller
// context carries its own error, and only the first is a refusal to count.
func (l *hashLimiter) acquire(ctx context.Context, estimate int64) (release func(), err error) {
	if l == nil {
		return func() {}, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	weight := l.weight(estimate)
	span := trace.SpanFromContext(ctx)

	if l.sem.TryAcquire(weight) {
		l.metrics.RecordWait(0)
		span.SetAttributes(
			attribute.Int64("password_hashing.weight", weight),
			attribute.Int64("password_hashing.wait_ms", 0),
		)
		return l.releaseFunc(weight), nil
	}

	start := time.Now()
	l.waiting.Add(1)
	waitCtx, cancel := context.WithTimeoutCause(ctx, l.maxWait, ErrHashingBusy)
	err = l.sem.Acquire(waitCtx, weight)
	cancel()
	l.waiting.Add(-1)
	waited := time.Since(start)
	l.metrics.RecordWait(waited)
	span.SetAttributes(
		attribute.Int64("password_hashing.weight", weight),
		attribute.Int64("password_hashing.wait_ms", waited.Milliseconds()),
	)
	if err != nil {
		if errors.Is(context.Cause(waitCtx), ErrHashingBusy) {
			l.metrics.RecordRejected()
			span.AddEvent("password_hashing.rejected")
			return nil, ErrHashingBusy
		}
		return nil, err
	}
	return l.releaseFunc(weight), nil
}

// releaseFunc books the slot of weight and returns what gives it back.
func (l *hashLimiter) releaseFunc(weight int64) (release func()) {
	l.inFlight.Add(1)
	l.reserved.Add(weight)
	return func() {
		l.inFlight.Add(-1)
		l.reserved.Add(-weight)
		l.sem.Release(weight)
	}
}
