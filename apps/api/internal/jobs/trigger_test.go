package jobs_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/jobs"
)

const testTriggerSecret = "0123456789abcdef"

func TestConfigValidate_TriggerSecret(t *testing.T) {
	t.Parallel()
	assert.NoError(t, jobs.Config{}.Validate())
	assert.NoError(t, jobs.Config{TriggerSecret: testTriggerSecret}.Validate())
	err := jobs.Config{TriggerSecret: "too-short"}.Validate()
	require.Error(t, err)
	assert.ErrorContains(t, err, "jobs.trigger_secret")
}

func TestTrigger_NilWithoutSecret(t *testing.T) {
	t.Parallel()
	eng := jobs.New(newFakeStore(), jobs.DefaultConfig())
	assert.Nil(t, eng.Trigger())
}

func TestTrigger_Unauthorized(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	cfg := jobs.DefaultConfig()
	cfg.TriggerSecret = testTriggerSecret
	eng := jobs.New(store, cfg)
	h := eng.Trigger()
	require.NotNil(t, h)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, jobs.TriggerPath, nil)
	h.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Empty(t, store.snapshotTakes())
}

func TestTrigger_MethodNotAllowed(t *testing.T) {
	t.Parallel()
	cfg := jobs.DefaultConfig()
	cfg.TriggerSecret = testTriggerSecret
	eng := jobs.New(newFakeStore(), cfg)
	h := eng.Trigger()
	require.NotNil(t, h)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, jobs.TriggerPath, nil)
	req.Header.Set("Authorization", "Bearer "+testTriggerSecret)
	h.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)
}

func TestTrigger_DrainsDueWork(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.enqueue(&domain.Job{
		ID:     "job_1",
		Name:   "email.send",
		RunAt:  time.Now().UTC().Add(-time.Second),
		Status: domain.JobStatusPending,
	})
	cfg := jobs.DefaultConfig()
	cfg.TriggerSecret = testTriggerSecret
	cfg.TakeBatchSize = 1
	eng := jobs.New(store, cfg)
	require.NoError(t, eng.RegisterWorker("w", "email.send", func(ctx context.Context, _ jobs.Work) error {
		return nil
	}, jobs.WorkerOpts{}))

	h := eng.Trigger()
	require.NotNil(t, h)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, jobs.TriggerPath, nil)
	req.Header.Set("Authorization", "Bearer "+testTriggerSecret)
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	body, err := io.ReadAll(rec.Body)
	require.NoError(t, err)
	assert.JSONEq(t, `{"ran":1}`, string(body))
	assert.Len(t, store.snapshotCompletes(), 1)
}

func TestTrigger_StopsAtDeadline(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	for i := 0; i < 20; i++ {
		store.enqueue(&domain.Job{
			ID:     fmtJobID(i),
			Name:   "slow",
			RunAt:  time.Now().UTC().Add(-time.Second),
			Status: domain.JobStatusPending,
		})
	}
	cfg := jobs.DefaultConfig()
	cfg.TriggerSecret = testTriggerSecret
	cfg.TakeBatchSize = 1
	eng := jobs.New(store, cfg)
	require.NoError(t, eng.RegisterWorker("w", "slow", func(ctx context.Context, _ jobs.Work) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(40 * time.Millisecond):
			return nil
		}
	}, jobs.WorkerOpts{}))

	h := eng.Trigger()
	ctx, cancel := context.WithTimeout(t.Context(), 25*time.Millisecond)
	defer cancel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(ctx, http.MethodGet, jobs.TriggerPath, nil)
	req.Header.Set("Authorization", "Bearer "+testTriggerSecret)
	h.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	// Not all 20 completed before the deadline.
	assert.Less(t, len(store.snapshotCompletes()), 20)
}

func fmtJobID(i int) string {
	return "job_" + string(rune('a'+i%26)) + string(rune('0'+i/26))
}
