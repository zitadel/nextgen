package service_test

import (
	"context"
	"errors"
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

func TestAuthRequestService_Create(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		createErr error
		sweep     bool
		sweepErr  error
		wantErr   error
	}{
		{name: "no_sweep"},
		{name: "sweep", sweep: true},
		// A failed sweep leaves rows for a later one; the request stands.
		{name: "failed_sweep", sweep: true, sweepErr: errors.New("aborted")},
		{name: "storage_unavailable", createErr: database.NewUnavailableError(nil), wantErr: domain.ErrUnavailable()},
		{name: "storage_fails", createErr: errors.New("boom"), wantErr: domain.ErrInternal(nil)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctrl := gomock.NewController(t)
			pool := servicemocks.NewMockPool(ctrl)
			stmts := servicemocks.NewMockAllStatements(ctrl)
			statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
			pool.EXPECT().Statements().Return(stmts).AnyTimes()
			pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
				func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
					return fn(ctx, statementer)
				},
			)
			statementer.EXPECT().Statements().Return(stmts).AnyTimes()
			stmts.EXPECT().CreateAuthRequest(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, r *domain.AuthRequest) error {
				r.ID = "authreq_1"
				return tt.createErr
			})
			var event *domain.Event
			if tt.createErr == nil {
				stmts.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, ev *domain.Event) error {
					event = ev
					return nil
				})
			}
			if tt.sweep {
				stmts.EXPECT().DeleteExpiredAuthRequests(gomock.Any(), "proj_1", gomock.Any(), 1000).Return(tt.sweepErr)
			}

			request := &domain.AuthRequest{ProjectID: "proj_1", ClientID: "shop", State: "xyz"}
			nonce, err := service.NewAuthRequestServiceForTest(service.NewPool(pool), tt.sweep).Create(t.Context(), request)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.NotEmpty(t, nonce)
			assert.Equal(t, domain.HashSecret(nonce), request.BindingHash)
			assert.WithinDuration(t, time.Now().Add(domain.AuthRequestTTL), request.ExpiresAt, 5*time.Second)
			require.NotNil(t, event)
			assert.Equal(t, domain.EventTypeAuthRequestCreated, event.EventType)
			assert.Equal(t, domain.EventCategoryAuth, event.Category)
			assert.Equal(t, new("auth_request"), event.EntityType)
			assert.Equal(t, new("authreq_1"), event.EntityID)
			assert.JSONEq(t, `{"client_id":"shop"}`, string(event.Payload))
		})
	}
}
