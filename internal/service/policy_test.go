package service_test

import (
	"context"
	"encoding/json"
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
	"github.com/zitadel/nextgen/internal/storage/policystore"
)

type policyFixture struct {
	svc        *service.PolicyService
	statements *servicemocks.MockAllStatements
	events     []*domain.Event
}

func newPolicyFixture(t *testing.T) *policyFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().Transaction(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		},
	).AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()

	f := &policyFixture{svc: service.NewPolicyService(service.NewPool(pool), mustPolicyEngine(t)), statements: statements}
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, ev *domain.Event) error {
		f.events = append(f.events, ev)
		return nil
	}).AnyTimes()
	return f
}

func (f *policyFixture) publish(config map[string]any) (*domain.Policy, error) {
	return f.svc.Publish(context.Background(), service.PublishPolicyInput{
		ProjectID: "proj_1",
		Operation: service.OperationPasswordSet,
		Config:    config,
	})
}

func TestPolicyService_FirstPublishCreates(t *testing.T) {
	f := newPolicyFixture(t)
	f.statements.EXPECT().GetPolicy(gomock.Any(), policystore.ByOperation("proj_1", service.OperationPasswordSet)).Return(nil, new(database.NoRowFoundError))
	f.statements.EXPECT().CreatePolicy(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, p *domain.Policy) error {
		assert.JSONEq(t, `{"min_length":12}`, string(p.Config))
		p.ID, p.RevisionID = "pol_1", "polrev_1"
		return nil
	})

	got, err := f.publish(map[string]any{"min_length": 12})
	require.NoError(t, err)
	assert.Equal(t, "pol_1", got.ID)

	require.Len(t, f.events, 1)
	assert.Equal(t, domain.EventTypePolicyCreated, f.events[0].EventType)
	var payload domain.PolicyPayload
	require.NoError(t, json.Unmarshal(f.events[0].Payload, &payload))
	assert.Equal(t, service.OperationPasswordSet, payload.Operation)
	assert.Equal(t, "polrev_1", payload.RevisionID)
	assert.JSONEq(t, `{"min_length":12}`, string(payload.Config))
}

func TestPolicyService_LaterPublishRevisesUnderTheLock(t *testing.T) {
	f := newPolicyFixture(t)
	created := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	gomock.InOrder(
		f.statements.EXPECT().GetPolicy(gomock.Any(), policystore.ByOperation("proj_1", service.OperationPasswordSet)).
			Return(&domain.Policy{ProjectID: "proj_1", ID: "pol_1", CreatedAt: created}, nil),
		f.statements.EXPECT().LockPolicy(gomock.Any(), "proj_1", "pol_1").Return(nil),
		f.statements.EXPECT().RevisePolicy(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, p *domain.Policy) error {
			assert.Equal(t, "pol_1", p.ID)
			p.RevisionID = "polrev_2"
			return nil
		}),
	)

	got, err := f.publish(map[string]any{"min_length": 15})
	require.NoError(t, err)
	assert.Equal(t, "polrev_2", got.RevisionID)
	assert.True(t, got.CreatedAt.Equal(created), "the policy keeps its first publish time")
	require.Len(t, f.events, 1)
	assert.Equal(t, domain.EventTypePolicyUpdated, f.events[0].EventType)
}

func TestPolicyService_InvalidConfigIsRefusedBeforeStorage(t *testing.T) {
	f := newPolicyFixture(t) // no storage expectations: nothing may be read or written
	for name, config := range map[string]map[string]any{
		"below the bound": {"min_length": 0},
		"unknown setting": {"min_lenght": 12},
		"min above max":   {"min_length": 20, "max_length": 10},
		"missing config":  nil,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := f.publish(config)
			assert.ErrorIs(t, err, domain.ErrPolicyInvalid(nil, nil))
		})
	}

	_, err := f.svc.Publish(t.Context(), service.PublishPolicyInput{ProjectID: "proj_1", Operation: "no.such.operation", Config: map[string]any{}})
	assert.ErrorIs(t, err, domain.ErrPolicyInvalid(nil, nil))
}

func TestPolicyService_ConcurrentFirstPublishIsAConflict(t *testing.T) {
	f := newPolicyFixture(t)
	f.statements.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(nil, new(database.NoRowFoundError))
	f.statements.EXPECT().CreatePolicy(gomock.Any(), gomock.Any()).Return(&database.UniqueError{})

	_, err := f.publish(map[string]any{})
	assert.ErrorIs(t, err, domain.ErrPolicyRevisionConflict())
}

func TestPolicyService_ResolvePolicy(t *testing.T) {
	f := newPolicyFixture(t)

	f.statements.EXPECT().GetPolicy(gomock.Any(), policystore.ByOperation("proj_none", service.OperationPasswordSet)).Return(nil, new(database.NoRowFoundError))
	none, err := f.svc.ResolvePolicy(t.Context(), "proj_none", service.OperationPasswordSet)
	require.NoError(t, err)
	assert.Nil(t, none, "no stored policy means no policy")

	f.statements.EXPECT().GetPolicy(gomock.Any(), policystore.ByOperation("proj_1", service.OperationPasswordSet)).
		Return(&domain.Policy{Operation: service.OperationPasswordSet, Config: []byte(`{"min_length":12}`)}, nil)
	inst, err := f.svc.ResolvePolicy(t.Context(), "proj_1", service.OperationPasswordSet)
	require.NoError(t, err)
	require.NotNil(t, inst)
	assert.Equal(t, json.Number("12"), inst.Config["min_length"])

	f.statements.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(nil, errors.New("down"))
	_, err = f.svc.ResolvePolicy(t.Context(), "proj_err", service.OperationPasswordSet)
	assert.Error(t, err, "a storage failure is an error, so the gate fails closed")
}

func TestPolicyService_StoresCanonicalSettings(t *testing.T) {
	f := newPolicyFixture(t)
	f.statements.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(nil, new(database.NoRowFoundError))
	f.statements.EXPECT().CreatePolicy(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, p *domain.Policy) error {
		assert.JSONEq(t, `{"min_length":12,"max_length":32}`, string(p.Config), "numbers are stored in canonical form")
		return nil
	})

	_, err := f.publish(map[string]any{"min_length": json.Number("1.2e1"), "max_length": json.Number("32.0")})
	require.NoError(t, err)
	require.Len(t, f.events, 1)
	var payload domain.PolicyPayload
	require.NoError(t, json.Unmarshal(f.events[0].Payload, &payload))
	assert.JSONEq(t, `{"min_length":12,"max_length":32}`, string(payload.Config))
}
