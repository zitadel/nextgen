package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/service"
)

// JobExec is the Engine-facing subset of service.JobStatements. Engine opens
// the transaction; statements stay tx-passive.
type JobExec interface {
	Take(ctx context.Context, limit int, leaseBy string, leaseFor time.Duration, names []string) ([]domain.TakeResult, error)
	Heartbeat(ctx context.Context, id, leaseToken string, leaseFor time.Duration) error
	Complete(ctx context.Context, id, leaseToken string) error
	Fail(ctx context.Context, id, leaseToken string, cause error, backoff time.Duration) error
	DeleteCompleted(ctx context.Context, completedBefore time.Time) (int64, error)
}

// Transactor opens read/write transactions for Engine-owned JobExec calls.
type Transactor interface {
	Transaction(ctx context.Context, fn func(ctx context.Context, stmts JobExec) error) error
}

// PoolTransactor adapts service.Pool to Transactor.
func PoolTransactor(pool service.Pool) Transactor {
	return poolTx{pool: pool}
}

type poolTx struct {
	pool service.Pool
}

func (p poolTx) Transaction(ctx context.Context, fn func(ctx context.Context, stmts JobExec) error) error {
	return p.pool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		return fn(ctx, tx.Statements())
	})
}

type registered struct {
	workerID string
	fn       Handler
	opts     WorkerOpts
}

// Engine is the shared jobs runtime: RegisterWorker, Start/Close poll, and
// RunDueOnce drain (ADR 065).
type Engine struct {
	db  Transactor
	cfg Config

	mu       sync.RWMutex
	handlers map[string]registered

	startOnce sync.Once
	stop      chan struct{}
	done      chan struct{}

	runMu     sync.Mutex
	runCancel context.CancelFunc
	inflight  sync.WaitGroup
}

// New builds an Engine. db is typically PoolTransactor(pool).
func New(db Transactor, cfg Config) *Engine {
	return &Engine{
		db:       db,
		cfg:      applyDefaults(cfg),
		handlers: make(map[string]registered),
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
	}
}

// RegisterWorker binds an in-process handler for jobName. It does not touch
// storage; call SetPeriodic separately for periodic sweeps.
func (e *Engine) RegisterWorker(workerID, jobName string, fn Handler, opts WorkerOpts) error {
	if jobName == "" {
		return errors.New("jobs: job name is required")
	}
	if fn == nil {
		return errors.New("jobs: handler is required")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if _, exists := e.handlers[jobName]; exists {
		return fmt.Errorf("jobs: handler already registered for %q", jobName)
	}
	e.handlers[jobName] = registered{workerID: workerID, fn: fn, opts: opts}
	return nil
}

// HasHandler reports whether RegisterWorker bound jobName.
func (e *Engine) HasHandler(jobName string) bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	_, ok := e.handlers[jobName]
	return ok
}

// Start launches the poll loop(s) unless a trigger secret hands wake to Cron.
// It returns once the loops are running (or immediately when they will not).
func (e *Engine) Start(ctx context.Context) error {
	var startErr error
	e.startOnce.Do(func() {
		if e.cfg.TriggerSecret != "" {
			close(e.done)
			return
		}
		loopCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
		e.runMu.Lock()
		e.runCancel = cancel
		e.runMu.Unlock()
		go func() {
			<-e.stop
			cancel()
		}()
		var wg sync.WaitGroup
		n := e.cfg.Concurrency
		wg.Add(n)
		for i := 0; i < n; i++ {
			go func() {
				defer wg.Done()
				e.poll(loopCtx)
			}()
		}
		go func() {
			wg.Wait()
			close(e.done)
		}()
	})
	return startErr
}

func (e *Engine) poll(ctx context.Context) {
	ticker := time.NewTicker(e.cfg.PollInterval)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		_, err := e.RunDueOnce(ctx, e.cfg.TakeBatchSize)
		if err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			slog.Error("jobs: poll Take/Perform failed", slog.String("error", err.Error()))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Close stops the poll loop and waits for in-flight Performs. The wait is
// bounded by ctx; a cancelled ctx still signals stop and returns ctx.Err()
// if the wait does not finish.
func (e *Engine) Close(ctx context.Context) error {
	select {
	case <-e.stop:
	default:
		close(e.stop)
	}
	e.runMu.Lock()
	if e.runCancel != nil {
		e.runCancel()
	}
	e.runMu.Unlock()

	// Ensure Start was invoked so e.done will close; otherwise wait on inflight only.
	e.startOnce.Do(func() { close(e.done) })

	waitDone := make(chan struct{})
	go func() {
		e.inflight.Wait()
		<-e.done
		close(waitDone)
	}()
	select {
	case <-waitDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// RunDueOnce Takes due work whose name is registered, Performs each, and
// Completes or Fails until budget Performs finish, the context cancels, or
// Take returns nothing runnable. DeadOnTake results skip Perform and do not
// count toward budget.
func (e *Engine) RunDueOnce(ctx context.Context, budget int) (ran int, err error) {
	if budget <= 0 {
		return 0, nil
	}
	for ran < budget {
		if err := ctx.Err(); err != nil {
			return ran, err
		}
		remaining := budget - ran
		limit := e.cfg.TakeBatchSize
		if remaining < limit {
			limit = remaining
		}
		names := e.registeredNames()
		var results []domain.TakeResult
		takeErr := e.db.Transaction(ctx, func(ctx context.Context, stmts JobExec) error {
			var err error
			results, err = stmts.Take(ctx, limit, e.cfg.LeaseBy, e.cfg.LeaseDuration, names)
			return err
		})
		if takeErr != nil {
			return ran, takeErr
		}
		if len(results) == 0 {
			return ran, nil
		}
		for _, result := range results {
			if err := ctx.Err(); err != nil {
				return ran, err
			}
			if result.DeadOnTake {
				metrics.RecordJobExpired(ctx, takeName(result))
				continue
			}
			if err := e.performOne(ctx, result); err != nil {
				return ran, err
			}
			ran++
			if ran >= budget {
				return ran, nil
			}
		}
	}
	return ran, nil
}

func (e *Engine) registeredNames() []string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if len(e.handlers) == 0 {
		return nil
	}
	names := make([]string, 0, len(e.handlers))
	for name := range e.handlers {
		names = append(names, name)
	}
	return names
}

func (e *Engine) lookup(name string) (registered, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	r, ok := e.handlers[name]
	return r, ok
}

func (e *Engine) performOne(ctx context.Context, result domain.TakeResult) error {
	work, token, ok := workFromTake(result)
	if !ok {
		return nil
	}
	reg, ok := e.lookup(work.Name)
	if !ok {
		// Allowlist should have prevented this; leave the lease to expire.
		slog.Warn("jobs: took unregistered name; leaving lease", slog.String("name", work.Name))
		return nil
	}

	metrics.RecordJobTaken(ctx, work.Name)
	if runAt, ok := takeRunAt(result); ok && !runAt.IsZero() {
		lag := time.Since(runAt)
		if lag < 0 {
			lag = 0
		}
		metrics.RecordJobTakeLag(ctx, work.Name, lag)
	}

	e.inflight.Add(1)
	defer e.inflight.Done()

	performCtx, span := startJobSpan(ctx, "jobs.Perform", attribute.String("name", work.Name))
	defer span.End()

	if reg.opts.Timeout > 0 {
		var cancel context.CancelFunc
		performCtx, cancel = context.WithTimeout(performCtx, reg.opts.Timeout)
		defer cancel()
	}

	hbStop := e.startHeartbeat(performCtx, work.ID, token)
	defer hbStop()

	start := time.Now()
	herr := reg.fn(performCtx, work)
	metrics.RecordJobPerformDuration(performCtx, work.Name, time.Since(start))
	hbStop()

	// Outcome writes use a context that outlives a cancelled drain so we do
	// not strand a live lease when the wake ends mid-Perform.
	outCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()

	if herr != nil {
		failJobSpan(performCtx, herr)
		backoff := backoffFor(work.Attempt, e.cfg.BackoffCap)
		if err := e.withJob(outCtx, func(ctx context.Context, stmts JobExec) error {
			return stmts.Fail(ctx, work.ID, token, herr, backoff)
		}); err != nil {
			return err
		}
		metrics.RecordJobFailed(outCtx, work.Name)
		if !work.Periodic {
			maxAttempts := takeMaxAttempts(result)
			if maxAttempts <= 0 {
				maxAttempts = e.cfg.MaxAttempts
			}
			// Fail increments attempt; dead when the new count reaches max.
			if work.Attempt+1 >= maxAttempts {
				metrics.RecordJobDead(outCtx, work.Name)
			}
		}
		return nil
	}

	if err := e.withJob(outCtx, func(ctx context.Context, stmts JobExec) error {
		return stmts.Complete(ctx, work.ID, token)
	}); err != nil {
		return err
	}
	metrics.RecordJobCompleted(outCtx, work.Name)
	return nil
}

func (e *Engine) withJob(ctx context.Context, fn func(ctx context.Context, stmts JobExec) error) error {
	return e.db.Transaction(ctx, fn)
}

func (e *Engine) startHeartbeat(ctx context.Context, id, token string) (stop func()) {
	done := make(chan struct{})
	var once sync.Once
	stop = func() { once.Do(func() { close(done) }) }
	go func() {
		ticker := time.NewTicker(e.cfg.HeartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				hbCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), e.cfg.LeaseDuration)
				err := e.withJob(hbCtx, func(ctx context.Context, stmts JobExec) error {
					return stmts.Heartbeat(ctx, id, token, e.cfg.LeaseDuration)
				})
				cancel()
				if err != nil && !errors.Is(err, context.Canceled) {
					slog.Warn("jobs: heartbeat failed",
						slog.String("id", id),
						slog.String("error", err.Error()))
				}
			}
		}
	}()
	return stop
}
