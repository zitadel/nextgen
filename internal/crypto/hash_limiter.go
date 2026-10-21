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

// ErrHashingBusy is returned by Hash and VerifyHash when no hashing slot freed
// up within the configured wait. It says nothing about the password: the
// caller must not count it as a failed attempt, and the client may retry.
var ErrHashingBusy = errors.New("too many passwords are being hashed right now")

// DefaultHashMemoryBudget is the memory the running hashes may need together
// when the configuration names no budget: enough for eight hashes at the
// default argon2id cost of 64 MiB.
const DefaultHashMemoryBudget = 512 << 20

// HashConcurrencyConfig bounds how much password hashing runs at once. A
// password hash is the one request that is expensive by design, and the cost
// is set by configuration, not by the caller, so without a bound a burst of
// sign-ins is a burst of 64 MiB allocations and saturated cores. The bound is
// deployment-wide: every hasher the factory hands out shares it.
type HashConcurrencyConfig struct {
	// MaxOperations caps the number of hashes running at once. Zero means
	// the number of CPUs the process may use, which is what a hash saturates.
	MaxOperations int `mapstructure:"max_operations"`
	// MemoryBudget is the bytes all running hashes may need together, so a
	// memory-hard hash takes a larger share of the slots than a cheap one.
	// Zero means [DefaultHashMemoryBudget].
	MemoryBudget int64 `mapstructure:"memory_budget"`
	// MaxWait is how long a hash waits for a slot before it is refused with
	// [ErrHashingBusy]. The Go zero value refuses at once, so a HashConfig
	// built in code that hashes concurrently has to set it; the server's
	// configuration defaults it to one second.
	MaxWait time.Duration `mapstructure:"max_wait"`
}

func (c HashConcurrencyConfig) validate() error {
	switch {
	case c.MaxOperations < 0:
		return fmt.Errorf("concurrency max_operations must not be negative, got %d", c.MaxOperations)
	case c.MemoryBudget < 0:
		return fmt.Errorf("concurrency memory_budget must not be negative, got %d", c.MemoryBudget)
	case c.MaxWait < 0:
		return fmt.Errorf("concurrency max_wait must not be negative, got %s", c.MaxWait)
	}
	return nil
}

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
		return l.admit(weight), nil
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
	return l.admit(weight), nil
}

func (l *hashLimiter) admit(weight int64) (release func()) {
	l.inFlight.Add(1)
	l.reserved.Add(weight)
	return func() {
		l.inFlight.Add(-1)
		l.reserved.Add(-weight)
		l.sem.Release(weight)
	}
}
