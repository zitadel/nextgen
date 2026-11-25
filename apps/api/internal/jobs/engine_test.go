package jobs_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/jobs"
)

// fakeStore is an in-memory JobExec + Transactor for Engine unit tests.
type fakeStore struct {
	mu sync.Mutex

	jobs      map[string]*domain.Job
	schedules map[string]*domain.JobSchedule

	takes      []takeCall
	heartbeats []hbCall
	completes  []tokenCall
	fails      []failCall

	takeHook func(names []string) // optional; called under lock before claiming
}

type takeCall struct {
	Limit   int
	LeaseBy string
	Names   []string
}

type hbCall struct {
	ID, Token string
}

type tokenCall struct {
	ID, Token string
}

type failCall struct {
	ID, Token string
	Cause     error
	Backoff   time.Duration
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		jobs:      make(map[string]*domain.Job),
		schedules: make(map[string]*domain.JobSchedule),
	}
}

func (f *fakeStore) Transaction(ctx context.Context, fn func(context.Context, jobs.JobExec) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return fn(ctx, f)
}

func (f *fakeStore) enqueue(job *domain.Job) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := *job
	if cp.Status == "" {
		cp.Status = domain.JobStatusPending
	}
	f.jobs[cp.ID] = &cp
}

func (f *fakeStore) Take(ctx context.Context, limit int, leaseBy string, leaseFor time.Duration, names []string) ([]domain.TakeResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.takes = append(f.takes, takeCall{Limit: limit, LeaseBy: leaseBy, Names: append([]string(nil), names...)})
	if f.takeHook != nil {
		f.takeHook(names)
	}
	allow := map[string]struct{}{}
	for _, n := range names {
		allow[n] = struct{}{}
	}
	now := time.Now().UTC()
	var out []domain.TakeResult
	for _, job := range f.jobs {
		if len(out) >= limit {
			break
		}
		if job.Status == domain.JobStatusDone || job.Status == domain.JobStatusDead {
			continue
		}
		if job.NotAfter != nil && !job.NotAfter.After(now) {
			job.Status = domain.JobStatusDead
			completed := now
			job.CompletedAt = &completed
			job.LeaseToken = nil
			job.LeaseUntil = nil
			job.LeaseBy = nil
			out = append(out, domain.TakeResult{
				Job:        cloneJob(job),
				DeadOnTake: true,
			})
			continue
		}
		if len(allow) == 0 {
			continue
		}
		if _, ok := allow[job.Name]; !ok {
			continue
		}
		if job.Status == domain.JobStatusLeased && job.LeaseUntil != nil && job.LeaseUntil.After(now) {
			continue
		}
		if job.RunAt.After(now) {
			continue
		}
		token := "tok-" + job.ID + "-" + now.Format("150405.000")
		until := now.Add(leaseFor)
		by := leaseBy
		job.Status = domain.JobStatusLeased
		job.LeaseToken = &token
		job.LeaseUntil = &until
		job.LeaseBy = &by
		out = append(out, domain.TakeResult{
			Job:        cloneJob(job),
			LeaseToken: token,
		})
	}
	return out, nil
}

func (f *fakeStore) Heartbeat(ctx context.Context, id, leaseToken string, leaseFor time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.heartbeats = append(f.heartbeats, hbCall{ID: id, Token: leaseToken})
	job, ok := f.jobs[id]
	if !ok || job.LeaseToken == nil || *job.LeaseToken != leaseToken {
		return nil
	}
	until := time.Now().UTC().Add(leaseFor)
	job.LeaseUntil = &until
	return nil
}

func (f *fakeStore) Complete(ctx context.Context, id, leaseToken string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.completes = append(f.completes, tokenCall{ID: id, Token: leaseToken})
	job, ok := f.jobs[id]
	if !ok || job.LeaseToken == nil || *job.LeaseToken != leaseToken {
		return nil
	}
	job.Status = domain.JobStatusDone
	now := time.Now().UTC()
	job.CompletedAt = &now
	job.Attempt = 0
	job.LeaseToken = nil
	job.LeaseUntil = nil
	job.LeaseBy = nil
	return nil
}

func (f *fakeStore) Fail(ctx context.Context, id, leaseToken string, cause error, backoff time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fails = append(f.fails, failCall{ID: id, Token: leaseToken, Cause: cause, Backoff: backoff})
	job, ok := f.jobs[id]
	if !ok || job.LeaseToken == nil || *job.LeaseToken != leaseToken {
		return nil
	}
	job.Attempt++
	msg := ""
	if cause != nil {
		msg = cause.Error()
	}
	job.LastError = &msg
	job.LeaseToken = nil
	job.LeaseUntil = nil
	job.LeaseBy = nil
	if job.MaxAttempts > 0 && job.Attempt >= job.MaxAttempts {
		job.Status = domain.JobStatusDead
		now := time.Now().UTC()
		job.CompletedAt = &now
		return nil
	}
	job.Status = domain.JobStatusPending
	job.RunAt = time.Now().UTC().Add(backoff)
	return nil
}

func (f *fakeStore) DeleteCompleted(ctx context.Context, completedBefore time.Time) (int64, error) {
	return 0, nil
}

func cloneJob(j *domain.Job) *domain.Job {
	cp := *j
	if j.Payload != nil {
		cp.Payload = append([]byte(nil), j.Payload...)
	}
	return &cp
}

func (f *fakeStore) snapshotTakes() []takeCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]takeCall, len(f.takes))
	copy(out, f.takes)
	return out
}

func (f *fakeStore) snapshotCompletes() []tokenCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]tokenCall, len(f.completes))
	copy(out, f.completes)
	return out
}

func (f *fakeStore) snapshotFails() []failCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]failCall, len(f.fails))
	copy(out, f.fails)
	return out
}

func (f *fakeStore) snapshotHeartbeats() []hbCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]hbCall, len(f.heartbeats))
	copy(out, f.heartbeats)
	return out
}

func (f *fakeStore) jobStatus(id string) domain.JobStatus {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.jobs[id].Status
}

func (f *fakeStore) pendingDueCount(name string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now().UTC()
	n := 0
	for _, j := range f.jobs {
		if j.Name == name && j.Status == domain.JobStatusPending && !j.RunAt.After(now) {
			n++
		}
	}
	return n
}

func testConfig(overrides ...func(*jobs.Config)) jobs.Config {
	cfg := jobs.DefaultConfig()
	cfg.PollInterval = 20 * time.Millisecond
	cfg.HeartbeatInterval = 15 * time.Millisecond
	cfg.LeaseDuration = 200 * time.Millisecond
	for _, o := range overrides {
		o(&cfg)
	}
	return cfg
}

func TestRegisterWorker_NoStorage(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	eng := jobs.New(store, testConfig())
	require.NoError(t, eng.RegisterWorker("w1", "sessions.gc", func(context.Context, jobs.Work) error {
		return nil
	}, jobs.WorkerOpts{}))
	assert.True(t, eng.HasHandler("sessions.gc"))
	assert.Empty(t, store.snapshotTakes())
	assert.Empty(t, store.snapshotCompletes())
	assert.Empty(t, store.snapshotFails())
}

func TestRunDueOnce_CompleteSuccess(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.enqueue(&domain.Job{
		ID: "job_ok", Name: "probe.ok",
		RunAt: time.Now().UTC().Add(-time.Second), MaxAttempts: 5,
	})
	var calls atomic.Int32
	eng := jobs.New(store, testConfig())
	require.NoError(t, eng.RegisterWorker("w", "probe.ok", func(context.Context, jobs.Work) error {
		calls.Add(1)
		return nil
	}, jobs.WorkerOpts{}))

	ran, err := eng.RunDueOnce(t.Context(), 1)
	require.NoError(t, err)
	assert.Equal(t, 1, ran)
	assert.Equal(t, int32(1), calls.Load())
	completes := store.snapshotCompletes()
	require.Len(t, completes, 1)
	assert.Equal(t, "job_ok", completes[0].ID)
	assert.NotEmpty(t, completes[0].Token)
	takes := store.snapshotTakes()
	require.NotEmpty(t, takes)
	assert.Equal(t, []string{"probe.ok"}, takes[0].Names)
	assert.Equal(t, domain.JobStatusDone, store.jobStatus("job_ok"))
}

func TestRunDueOnce_HandlerErrorFails(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.enqueue(&domain.Job{
		ID: "job_fail", Name: "probe.fail",
		RunAt: time.Now().UTC().Add(-time.Second), MaxAttempts: 5,
	})
	eng := jobs.New(store, testConfig())
	require.NoError(t, eng.RegisterWorker("w", "probe.fail", func(context.Context, jobs.Work) error {
		return errors.New("boom")
	}, jobs.WorkerOpts{}))

	ran, err := eng.RunDueOnce(t.Context(), 1)
	require.NoError(t, err)
	assert.Equal(t, 1, ran)
	fails := store.snapshotFails()
	require.Len(t, fails, 1)
	assert.Equal(t, "job_fail", fails[0].ID)
	assert.NotEmpty(t, fails[0].Token)
	assert.EqualError(t, fails[0].Cause, "boom")
	assert.Equal(t, domain.JobStatusPending, store.jobStatus("job_fail"))
	store.mu.Lock()
	assert.True(t, store.jobs["job_fail"].RunAt.After(time.Now().UTC().Add(-time.Second)))
	store.mu.Unlock()
}

func TestRunDueOnce_HeartbeatDuringSlowPerform(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.enqueue(&domain.Job{
		ID: "job_slow", Name: "probe.slow",
		RunAt: time.Now().UTC().Add(-time.Second), MaxAttempts: 5,
	})
	eng := jobs.New(store, testConfig(func(c *jobs.Config) {
		c.HeartbeatInterval = 10 * time.Millisecond
	}))
	require.NoError(t, eng.RegisterWorker("w", "probe.slow", func(ctx context.Context, _ jobs.Work) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(45 * time.Millisecond):
			return nil
		}
	}, jobs.WorkerOpts{}))

	ran, err := eng.RunDueOnce(t.Context(), 1)
	require.NoError(t, err)
	assert.Equal(t, 1, ran)
	hbs := store.snapshotHeartbeats()
	require.NotEmpty(t, hbs, "expected at least one Heartbeat during slow Perform")
	completes := store.snapshotCompletes()
	require.Len(t, completes, 1)
	assert.Equal(t, completes[0].Token, hbs[0].Token)
}

func TestRunDueOnce_EmptyAllowlistDoesNotSteal(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.enqueue(&domain.Job{
		ID: "job_future", Name: "future.job",
		RunAt: time.Now().UTC().Add(-time.Second), MaxAttempts: 5, Attempt: 0,
	})
	eng := jobs.New(store, testConfig())
	// No RegisterWorker — allowlist empty.

	ran, err := eng.RunDueOnce(t.Context(), 1)
	require.NoError(t, err)
	assert.Equal(t, 0, ran)
	takes := store.snapshotTakes()
	require.Len(t, takes, 1)
	assert.Nil(t, takes[0].Names)
	assert.Empty(t, store.snapshotFails())
	assert.Empty(t, store.snapshotCompletes())
	assert.Equal(t, domain.JobStatusPending, store.jobStatus("job_future"))
}

func TestRunDueOnce_UnknownNameNotInAllowlist(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.enqueue(&domain.Job{
		ID: "job_future", Name: "future.job",
		RunAt: time.Now().UTC().Add(-time.Second), MaxAttempts: 5,
	})
	store.enqueue(&domain.Job{
		ID: "job_ok", Name: "probe.ok",
		RunAt: time.Now().UTC().Add(-time.Second), MaxAttempts: 5,
	})
	eng := jobs.New(store, testConfig())
	require.NoError(t, eng.RegisterWorker("w", "probe.ok", func(context.Context, jobs.Work) error {
		return nil
	}, jobs.WorkerOpts{}))

	ran, err := eng.RunDueOnce(t.Context(), 5)
	require.NoError(t, err)
	assert.Equal(t, 1, ran)
	takes := store.snapshotTakes()
	require.NotEmpty(t, takes)
	assert.Equal(t, []string{"probe.ok"}, takes[0].Names)
	assert.Equal(t, domain.JobStatusPending, store.jobStatus("job_future"))
	assert.Equal(t, domain.JobStatusDone, store.jobStatus("job_ok"))
}

func TestRunDueOnce_DeadOnTakeSkipsPerform(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	past := time.Now().UTC().Add(-time.Minute)
	store.enqueue(&domain.Job{
		ID: "job_expired", Name: "probe.ok",
		RunAt: time.Now().UTC().Add(-time.Hour), NotAfter: &past, MaxAttempts: 5,
	})
	var calls atomic.Int32
	eng := jobs.New(store, testConfig())
	require.NoError(t, eng.RegisterWorker("w", "probe.ok", func(context.Context, jobs.Work) error {
		calls.Add(1)
		return nil
	}, jobs.WorkerOpts{}))

	ran, err := eng.RunDueOnce(t.Context(), 1)
	require.NoError(t, err)
	assert.Equal(t, 0, ran)
	assert.Equal(t, int32(0), calls.Load())
	assert.Empty(t, store.snapshotCompletes())
	assert.Empty(t, store.snapshotFails())
	assert.Equal(t, domain.JobStatusDead, store.jobStatus("job_expired"))
}

func TestRunDueOnce_BudgetStop(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	for i := range 5 {
		store.enqueue(&domain.Job{
			ID: fmt.Sprintf("job_%d", i), Name: "probe.ok",
			RunAt: time.Now().UTC().Add(-time.Second), MaxAttempts: 5,
		})
	}
	var calls atomic.Int32
	eng := jobs.New(store, testConfig(func(c *jobs.Config) {
		c.TakeBatchSize = 1
	}))
	require.NoError(t, eng.RegisterWorker("w", "probe.ok", func(context.Context, jobs.Work) error {
		calls.Add(1)
		return nil
	}, jobs.WorkerOpts{}))

	ran, err := eng.RunDueOnce(t.Context(), 2)
	require.NoError(t, err)
	assert.Equal(t, 2, ran)
	assert.Equal(t, int32(2), calls.Load())
	assert.Equal(t, 3, store.pendingDueCount("probe.ok"))
}

func TestRunDueOnce_ContextCancel(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	for i := range 10 {
		store.enqueue(&domain.Job{
			ID: fmt.Sprintf("job_%d", i), Name: "probe.slow",
			RunAt: time.Now().UTC().Add(-time.Second), MaxAttempts: 5,
		})
	}
	started := make(chan struct{})
	eng := jobs.New(store, testConfig(func(c *jobs.Config) {
		c.TakeBatchSize = 1
	}))
	require.NoError(t, eng.RegisterWorker("w", "probe.slow", func(ctx context.Context, _ jobs.Work) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}, jobs.WorkerOpts{}))

	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	var ran int
	var runErr error
	go func() {
		defer close(done)
		ran, runErr = eng.RunDueOnce(ctx, 100)
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not start")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("RunDueOnce hung after cancel")
	}
	assert.True(t, errors.Is(runErr, context.Canceled) || ran >= 0)
	takesAfter := len(store.snapshotTakes())
	time.Sleep(30 * time.Millisecond)
	assert.Equal(t, takesAfter, len(store.snapshotTakes()), "no new Take after cancel returned")
}

func TestStartClose_ProcessesAndStops(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	var calls atomic.Int32
	eng := jobs.New(store, testConfig(func(c *jobs.Config) {
		c.PollInterval = 15 * time.Millisecond
	}))
	require.NoError(t, eng.RegisterWorker("w", "probe.ok", func(context.Context, jobs.Work) error {
		calls.Add(1)
		return nil
	}, jobs.WorkerOpts{}))

	require.NoError(t, eng.Start(t.Context()))
	store.enqueue(&domain.Job{
		ID: "job_poll", Name: "probe.ok",
		RunAt: time.Now().UTC().Add(-time.Second), MaxAttempts: 5,
	})

	require.Eventually(t, func() bool {
		return calls.Load() >= 1 && store.jobStatus("job_poll") == domain.JobStatusDone
	}, 2*time.Second, 10*time.Millisecond)

	closeCtx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	require.NoError(t, eng.Close(closeCtx))

	takesAtClose := len(store.snapshotTakes())
	time.Sleep(50 * time.Millisecond)
	assert.Equal(t, takesAtClose, len(store.snapshotTakes()), "poll loop stopped after Close")
}

func TestStart_SkippedWhenTriggerSecretSet(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	eng := jobs.New(store, testConfig(func(c *jobs.Config) {
		c.TriggerSecret = "super-secret-trigger"
		c.PollInterval = 5 * time.Millisecond
	}))
	require.NoError(t, eng.RegisterWorker("w", "probe.ok", func(context.Context, jobs.Work) error {
		return nil
	}, jobs.WorkerOpts{}))
	store.enqueue(&domain.Job{
		ID: "job_cron", Name: "probe.ok",
		RunAt: time.Now().UTC().Add(-time.Second), MaxAttempts: 5,
	})
	require.NoError(t, eng.Start(t.Context()))
	time.Sleep(40 * time.Millisecond)
	assert.Empty(t, store.snapshotTakes(), "poll must not run when trigger_secret is set")
	closeCtx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	require.NoError(t, eng.Close(closeCtx))
}

func TestDefaultConfig(t *testing.T) {
	t.Parallel()
	cfg := jobs.DefaultConfig()
	assert.Equal(t, 1, cfg.Concurrency)
	assert.Equal(t, time.Second, cfg.PollInterval)
	assert.Equal(t, 1, cfg.TakeBatchSize)
	assert.Equal(t, 30*time.Second, cfg.LeaseDuration)
	assert.Equal(t, 10*time.Second, cfg.HeartbeatInterval)
	assert.Equal(t, 5, cfg.MaxAttempts)
	assert.Equal(t, time.Hour, cfg.BackoffCap)
	assert.Equal(t, 7*24*time.Hour, cfg.Retain)
}
