package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestSessionsGC_Perform_EmitsAndDeletes(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool := servicemocks.NewMockStatementPool(ctrl)

	expired := &domain.Session{
		ProjectID: "proj_1",
		ID:        "sess_expired",
		ExpiresAt: time.Now().UTC().Add(-time.Minute),
		UserID:    new("usr_1"),
	}

	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			tx := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
			tx.EXPECT().Statements().Return(stmts).AnyTimes()
			stmts.EXPECT().DeleteSessions(gomock.Any(), gomock.Any()).DoAndReturn(
				func(_ context.Context, opts *database.ListOptions[domain.SessionField]) ([]*domain.Session, error) {
					require.NotNil(t, opts.Filter)
					assert.Equal(t, uint32(100), opts.Pagination.Limit)
					return []*domain.Session{expired}, nil
				},
			)
			stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(
				func(_ context.Context, ev *domain.Event) error {
					assert.Equal(t, domain.EventTypeSessionExpired, ev.EventType)
					require.NotNil(t, ev.ActorType)
					assert.Equal(t, domain.EventActorTypeSystem, *ev.ActorType)
					require.NotNil(t, ev.EntityID)
					assert.Equal(t, expired.ID, *ev.EntityID)
					return nil
				},
			)
			return fn(ctx, tx)
		},
	)

	gc := service.NewSessionsGC(pool, service.SessionsGCConfig{BatchSize: 100})
	require.NoError(t, gc.Perform(t.Context()))
}

func TestSessionsGC_Perform_IdempotentEmpty(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool := servicemocks.NewMockStatementPool(ctrl)

	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			tx := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
			tx.EXPECT().Statements().Return(stmts).AnyTimes()
			stmts.EXPECT().DeleteSessions(gomock.Any(), gomock.Any()).Return([]*domain.Session{}, nil)
			return fn(ctx, tx)
		},
	)

	gc := service.NewSessionsGC(pool, service.DefaultSessionsGCConfig())
	require.NoError(t, gc.Perform(t.Context()))
}

func TestSessionsGC_Perform_RespectsBatchSize(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	stmts := servicemocks.NewMockAllStatements(ctrl)
	pool := servicemocks.NewMockStatementPool(ctrl)

	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			tx := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
			tx.EXPECT().Statements().Return(stmts).AnyTimes()
			stmts.EXPECT().DeleteSessions(gomock.Any(), gomock.Any()).DoAndReturn(
				func(_ context.Context, opts *database.ListOptions[domain.SessionField]) ([]*domain.Session, error) {
					assert.Equal(t, uint32(2), opts.Pagination.Limit)
					return nil, nil
				},
			)
			return fn(ctx, tx)
		},
	)

	gc := service.NewSessionsGC(pool, service.SessionsGCConfig{BatchSize: 2})
	require.NoError(t, gc.Perform(t.Context()))
}

func TestApplySessionsGCDefaults(t *testing.T) {
	t.Parallel()
	got := service.ApplySessionsGCDefaults(service.SessionsGCConfig{})
	assert.Equal(t, time.Minute, got.Period)
	assert.Equal(t, 100, got.BatchSize)
}
