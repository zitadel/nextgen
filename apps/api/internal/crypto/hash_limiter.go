package crypto

import (
	"context"
	"errors"
	"fmt"
	"math"
	"runtime"
	"runtime/debug"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"golang.org/x/sync/semaphore"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
)

// What the limiter adds to the hashing span it runs under: the weight it
// reserved, how long it waited for it, and an event when it refused.
const (
	HashWeightKey = attribute.Key("password_hashing.weight")
	HashWaitKey   = attribute.Key("password_hashing.wait_ms")

	HashRejectedEvent = "password_hashing.rejected"
)

func (c HashConcurrencyConfig) newLimiter(limits HashLimitsConfig, opts []metrics.Option) (*hashLimiter, error) {
	if err := c.validate(); err != nil {
		return nil, err
	}
	budget := c.MemoryBudget
	if budget == 0 {
		budget = deriveHashMemoryBudget()
	}
	maxWait := c.MaxWait
	if maxWait == 0 {
		maxWait = DefaultHashMaxWait
	}
	l := &hashLimiter{
		sem:           semaphore.NewWeighted(budget),
		budget:        budget,
		maxOperations: int64(c.MaxOperations),
		procs:         func() int { return runtime.GOMAXPROCS(0) },
		maxWait:       maxWait,
		limits:        limits,
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

// deriveHashMemoryBudget is the budget when the configuration names none:
// half of the Go memory limit when the process runs under one (the server
// sets it from the container's cgroup limit), else [DefaultHashMemoryBudget].
// Half, because the hashes are not the process's only memory, and a budget
// the limit cannot hold is what the bound is there to prevent.
func deriveHashMemoryBudget() int64 {
	if limit := debug.SetMemoryLimit(-1); limit < math.MaxInt64 {
		return max(limit/2, 1)
	}
	return DefaultHashMemoryBudget
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
	sem    *semaphore.Weighted
	budget int64
	// maxOperations is the configured cap, or zero for one per CPU the
	// process may use, read from procs at every acquisition: the runtime
	// may change it after the limiter is built, and the floor follows.
	maxOperations int64
	procs         func() int
	maxWait       time.Duration
	limits        HashLimitsConfig

	// The semaphore knows what it holds but not who waits, and the waiting
	// count is the one an autoscaler wants, so both are kept here.
	inFlight atomic.Int64
	waiting  atomic.Int64
	reserved atomic.Int64
	metrics  *metrics.PasswordHashing
}

// floor is the least a hash weighs: an equal share of the budget among
// max_operations hashes.
func (l *hashLimiter) floor() int64 {
	operations := l.maxOperations
	if operations == 0 {
		operations = int64(max(l.procs(), 1))
	}
	return max(l.budget/operations, 1)
}

func (l *hashLimiter) weight(estimate int64) int64 {
	return min(max(estimate, l.floor()), l.budget)
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
			HashWeightKey.Int64(weight),
			HashWaitKey.Int64(0),
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
		HashWeightKey.Int64(weight),
		HashWaitKey.Int64(waited.Milliseconds()),
	)
	if err != nil {
		if errors.Is(context.Cause(waitCtx), ErrHashingBusy) {
			l.metrics.RecordRejected()
			span.AddEvent(HashRejectedEvent)
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
