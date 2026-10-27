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

// A refused publish lists every violation in its details, settings first,
// then the config rules with the settings they read.
func TestPolicyService_InvalidConfigListsViolations(t *testing.T) {
	f := newPolicyFixture(t)
	_, err := f.publish(map[string]any{"min_length": 20, "max_length": 10, "history_depth": 9})

	var de domain.Error
	require.ErrorAs(t, err, &de)
	assert.Equal(t, domain.PolicyInvalidDetails{Violations: []domain.PolicyViolation{
		{Setting: "history_depth"},
		{ConfigRule: "min_length_not_above_max_length", Settings: []string{"max_length", "min_length"}},
	}}, de.Details)

	_, err = f.svc.Publish(t.Context(), service.PublishPolicyInput{ProjectID: "proj_1", Operation: "no.such.operation", Config: map[string]any{}})
	require.ErrorAs(t, err, &de)
	assert.Nil(t, de.Details, "an unknown operation names no setting or rule")
}

func TestPolicyService_Get(t *testing.T) {
	f := newPolicyFixture(t)
	f.statements.EXPECT().GetPolicy(gomock.Any(), policystore.ByID("proj_1", "pol_1")).Return(&domain.Policy{ID: "pol_1"}, nil)
	f.statements.EXPECT().GetPolicy(gomock.Any(), policystore.ByID("proj_1", "pol_unknown")).Return(nil, new(database.NoRowFoundError))

	got, err := f.svc.Get(t.Context(), "proj_1", "pol_1")
	require.NoError(t, err)
	assert.Equal(t, "pol_1", got.ID)

	_, err = f.svc.Get(t.Context(), "proj_1", "pol_unknown")
	assert.ErrorIs(t, err, domain.ErrPolicyNotFound())
}

func TestPolicyService_List(t *testing.T) {
	f := newPolicyFixture(t)
	f.statements.EXPECT().ListPolicies(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, opts *database.ListOptions[domain.PolicyField]) (*database.ListResult[*domain.Policy], error) {
			assert.Equal(t, policystore.ListOptions("proj_1", service.OperationPasswordSet, 2).Filter, opts.Filter)
			assert.Equal(t, policystore.FirstPublishedFirst(), opts.Pagination.OrderBy)
			assert.Equal(t, uint32(2), opts.Pagination.Limit)
			assert.Equal(t, []byte("cursor"), opts.Pagination.Cursor)
			return &database.ListResult[*domain.Policy]{Items: []*domain.Policy{{ID: "pol_1"}}, NextCursor: []byte("next")}, nil
		})

	got, err := f.svc.List(t.Context(), service.ListPoliciesInput{ProjectID: "proj_1", Operation: service.OperationPasswordSet, Limit: 2, PageToken: "cursor"})
	require.NoError(t, err)
	assert.Len(t, got.Items, 1)
	assert.Equal(t, "next", got.NextPageToken)
}

func TestPolicyService_ListRevisions(t *testing.T) {
	t.Run("pages the policy's revisions newest first", func(t *testing.T) {
		f := newPolicyFixture(t)
		gomock.InOrder(
			f.statements.EXPECT().GetPolicy(gomock.Any(), policystore.ByID("proj_1", "pol_1")).Return(&domain.Policy{ID: "pol_1"}, nil),
			f.statements.EXPECT().ListPolicyRevisions(gomock.Any(), "proj_1", "pol_1", gomock.Any()).DoAndReturn(
				func(_ context.Context, _, _ string, page database.Page[domain.PolicyField]) (*database.ListResult[*domain.Policy], error) {
					assert.Equal(t, policystore.NewestRevisionFirst(), page.OrderBy)
					return &database.ListResult[*domain.Policy]{Items: []*domain.Policy{{RevisionID: "polrev_2"}, {RevisionID: "polrev_1"}}}, nil
				}),
		)
		got, err := f.svc.ListRevisions(t.Context(), service.ListPolicyRevisionsInput{ProjectID: "proj_1", ID: "pol_1"})
		require.NoError(t, err)
		assert.Len(t, got.Items, 2)
		assert.Empty(t, got.NextPageToken)
	})

	t.Run("an unknown policy is not found, not an empty page", func(t *testing.T) {
		f := newPolicyFixture(t) // no list expectation: the list must not run
		f.statements.EXPECT().GetPolicy(gomock.Any(), policystore.ByID("proj_1", "pol_unknown")).Return(nil, new(database.NoRowFoundError))
		_, err := f.svc.ListRevisions(t.Context(), service.ListPolicyRevisionsInput{ProjectID: "proj_1", ID: "pol_unknown"})
		assert.ErrorIs(t, err, domain.ErrPolicyNotFound())
	})
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

	_, err := f.svc.ResolvePolicy(t.Context(), "proj_1", service.OperationPasswordSet)
	assert.ErrorIs(t, err, domain.ErrReleaseNotDeployed(nil))
}

func TestPolicyService_ResolvePolicyFollowsTheRelease(t *testing.T) {
	flow := domain.ReleasePointer{Kind: domain.ReleasePointerKindFlowDefinition, Handle: "login", RevisionID: "flow_1"}
	pinned := domain.ReleasePointer{Kind: domain.ReleasePointerKindPolicy, Handle: service.OperationPasswordSet, RevisionID: "polrev_1"}
	served := func(t *testing.T, pointers ...domain.ReleasePointer) context.Context {
		t.Helper()
		return service.WithRuntimeResolution(t.Context(), &service.RuntimeResolution{Release: &domain.Release{Pointers: pointers}})
	}

	t.Run("a release that pins a flow serves the policy revision it pins", func(t *testing.T) {
		f := newPolicyFixture(t)
		f.statements.EXPECT().GetPolicyRevision(gomock.Any(), "proj_1", "polrev_1").
			Return(&domain.Policy{Operation: service.OperationPasswordSet, Config: []byte(`{"min_length":10}`)}, nil)

		inst, err := f.svc.ResolvePolicy(served(t, flow, pinned), "proj_1", service.OperationPasswordSet)
		require.NoError(t, err)
		require.NotNil(t, inst)
		assert.Equal(t, json.Number("10"), inst.Config["min_length"])
	})

	t.Run("a release that pins a flow and no policy means no policy, not the newest", func(t *testing.T) {
		f := newPolicyFixture(t)

		inst, err := f.svc.ResolvePolicy(served(t, flow), "proj_1", service.OperationPasswordSet)
		require.NoError(t, err)
		assert.Nil(t, inst)
	})

	t.Run("a pinned revision the project no longer holds is an internal error", func(t *testing.T) {
		f := newPolicyFixture(t)
		f.statements.EXPECT().GetPolicyRevision(gomock.Any(), "proj_1", "polrev_1").Return(nil, new(database.NoRowFoundError))

		_, err := f.svc.ResolvePolicy(served(t, flow, pinned), "proj_1", service.OperationPasswordSet)
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
	})

	t.Run("a release that pins no flow serves the policy revision it pins", func(t *testing.T) {
		f := newPolicyFixture(t)
		f.statements.EXPECT().GetPolicyRevision(gomock.Any(), "proj_1", "polrev_1").
			Return(&domain.Policy{Operation: service.OperationPasswordSet, Config: []byte(`{"min_length":12}`)}, nil)

		inst, err := f.svc.ResolvePolicy(served(t, pinned), "proj_1", service.OperationPasswordSet)
		require.NoError(t, err)
		require.NotNil(t, inst)
		assert.Equal(t, json.Number("12"), inst.Config["min_length"])
	})
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

func TestPolicyService_BuildReusesTheNewestRevisionOnlyWhenItHoldsTheConfig(t *testing.T) {
	ctx := context.Background()
	current := &domain.Policy{ProjectID: "proj_1", ID: "pol_1", RevisionID: "polrev_1", Config: []byte(`{"min_length": 12}`)}

	t.Run("unchanged, without taking the lock", func(t *testing.T) {
		f := newPolicyFixture(t)
		f.statements.EXPECT().GetPolicy(gomock.Any(), policystore.ByOperation("proj_1", service.OperationPasswordSet)).Return(current, nil)

		got, err := service.ResolveOrPublishPolicy(f.svc, ctx, f.statements, "proj_1", service.OperationPasswordSet, []byte(`{"min_length":12}`))
		require.NoError(t, err)
		assert.Equal(t, "polrev_1", got.RevisionID)
		assert.Empty(t, f.events)
	})

	t.Run("written by a concurrent build while this one waited for the lock", func(t *testing.T) {
		f := newPolicyFixture(t)
		older := &domain.Policy{ProjectID: "proj_1", ID: "pol_1", RevisionID: "polrev_1", Config: []byte(`{"min_length": 10}`)}
		winner := &domain.Policy{ProjectID: "proj_1", ID: "pol_1", RevisionID: "polrev_2", Config: []byte(`{"min_length": 12}`)}
		gomock.InOrder(
			f.statements.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(older, nil),
			f.statements.EXPECT().LockPolicy(gomock.Any(), "proj_1", "pol_1").Return(nil),
			f.statements.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(winner, nil),
		)

		got, err := service.ResolveOrPublishPolicy(f.svc, ctx, f.statements, "proj_1", service.OperationPasswordSet, []byte(`{"min_length":12}`))
		require.NoError(t, err)
		assert.Equal(t, "polrev_2", got.RevisionID, "the winner's revision, not a second identical one")
		assert.Empty(t, f.events)
	})

	t.Run("a config the lock still finds different is revised on top of the locked read", func(t *testing.T) {
		f := newPolicyFixture(t)
		older := &domain.Policy{ProjectID: "proj_1", ID: "pol_1", RevisionID: "polrev_1", Operation: service.OperationPasswordSet, Config: []byte(`{"min_length": 10}`)}
		other := &domain.Policy{ProjectID: "proj_1", ID: "pol_1", RevisionID: "polrev_2", Operation: service.OperationPasswordSet, Config: []byte(`{"min_length": 11}`)}
		gomock.InOrder(
			f.statements.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(older, nil),
			f.statements.EXPECT().LockPolicy(gomock.Any(), "proj_1", "pol_1").Return(nil),
			f.statements.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(other, nil),
			f.statements.EXPECT().RevisePolicy(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, p *domain.Policy) error {
				assert.Equal(t, "pol_1", p.ID)
				assert.JSONEq(t, `{"min_length":12}`, string(p.Config))
				p.RevisionID = "polrev_3"
				return nil
			}),
		)

		got, err := service.ResolveOrPublishPolicy(f.svc, ctx, f.statements, "proj_1", service.OperationPasswordSet, []byte(`{"min_length":12}`))
		require.NoError(t, err)
		assert.Equal(t, "polrev_3", got.RevisionID, "a revision after the concurrent build's, not a reuse of it")
		require.Len(t, f.events, 1)
		assert.Equal(t, domain.EventTypePolicyUpdated, f.events[0].EventType)
	})

	t.Run("a lost unique index is a conflict, any other write failure goes back to the build as is", func(t *testing.T) {
		changed := []byte(`{"min_length":12}`)
		older := &domain.Policy{ProjectID: "proj_1", ID: "pol_1", Operation: service.OperationPasswordSet, Config: []byte(`{"min_length": 10}`)}
		down := errors.New("down")
		for name, tc := range map[string]struct {
			expect func(*servicemocks.MockAllStatements)
			check  func(*testing.T, error)
		}{
			"creating, lost to a concurrent first publish": {
				expect: func(s *servicemocks.MockAllStatements) {
					s.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(nil, new(database.NoRowFoundError))
					s.EXPECT().CreatePolicy(gomock.Any(), gomock.Any()).Return(new(database.UniqueError))
				},
				check: func(t *testing.T, err error) { assert.ErrorIs(t, err, domain.ErrPolicyRevisionConflict()) },
			},
			"creating, for a project that is gone": {
				expect: func(s *servicemocks.MockAllStatements) {
					s.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(nil, new(database.NoRowFoundError))
					s.EXPECT().CreatePolicy(gomock.Any(), gomock.Any()).Return(new(database.ForeignKeyError))
				},
				check: func(t *testing.T, err error) {
					_, isFK := errors.AsType[*database.ForeignKeyError](err)
					assert.True(t, isFK, "the build maps it to rel.project_not_found")
					_, isDomain := errors.AsType[domain.Error](err)
					assert.False(t, isDomain, "not answered as a policy error")
				},
			},
			"taking the lock": {
				expect: func(s *servicemocks.MockAllStatements) {
					s.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(older, nil)
					s.EXPECT().LockPolicy(gomock.Any(), "proj_1", "pol_1").Return(down)
				},
				check: func(t *testing.T, err error) { assert.Same(t, down, err) },
			},
			"revising, lost to a concurrent revision": {
				expect: func(s *servicemocks.MockAllStatements) {
					s.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(older, nil).Times(2)
					s.EXPECT().LockPolicy(gomock.Any(), "proj_1", "pol_1").Return(nil)
					s.EXPECT().RevisePolicy(gomock.Any(), gomock.Any()).Return(new(database.UniqueError))
				},
				check: func(t *testing.T, err error) { assert.ErrorIs(t, err, domain.ErrPolicyRevisionConflict()) },
			},
			"revising": {
				expect: func(s *servicemocks.MockAllStatements) {
					s.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(older, nil).Times(2)
					s.EXPECT().LockPolicy(gomock.Any(), "proj_1", "pol_1").Return(nil)
					s.EXPECT().RevisePolicy(gomock.Any(), gomock.Any()).Return(down)
				},
				check: func(t *testing.T, err error) { assert.Same(t, down, err) },
			},
		} {
			t.Run(name, func(t *testing.T) {
				f := newPolicyFixture(t)
				tc.expect(f.statements)

				_, err := service.ResolveOrPublishPolicy(f.svc, ctx, f.statements, "proj_1", service.OperationPasswordSet, changed)
				require.Error(t, err)
				tc.check(t, err)
				assert.Empty(t, f.events)
			})
		}
	})

	t.Run("a failed read is an internal error", func(t *testing.T) {
		older := &domain.Policy{ProjectID: "proj_1", ID: "pol_1", Config: []byte(`{"min_length": 10}`)}
		for name, expect := range map[string]func(*servicemocks.MockAllStatements){
			"before the lock": func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(nil, errors.New("down"))
			},
			"under the lock": func(s *servicemocks.MockAllStatements) {
				gomock.InOrder(
					s.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(older, nil),
					s.EXPECT().LockPolicy(gomock.Any(), "proj_1", "pol_1").Return(nil),
					s.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).Return(nil, errors.New("down")),
				)
			},
		} {
			t.Run(name, func(t *testing.T) {
				f := newPolicyFixture(t)
				expect(f.statements)

				_, err := service.ResolveOrPublishPolicy(f.svc, ctx, f.statements, "proj_1", service.OperationPasswordSet, []byte(`{"min_length":12}`))
				assert.ErrorIs(t, err, domain.ErrInternal(nil))
				assert.Empty(t, f.events)
			})
		}
	})

	t.Run("a stored config that does not decode is an internal error, not a change", func(t *testing.T) {
		f := newPolicyFixture(t)
		f.statements.EXPECT().GetPolicy(gomock.Any(), gomock.Any()).
			Return(&domain.Policy{ProjectID: "proj_1", ID: "pol_1", Config: []byte(`{not json`)}, nil)

		_, err := service.ResolveOrPublishPolicy(f.svc, ctx, f.statements, "proj_1", service.OperationPasswordSet, []byte(`{}`))
		assert.ErrorIs(t, err, domain.ErrInternal(nil))
		assert.Empty(t, f.events)
	})
}
