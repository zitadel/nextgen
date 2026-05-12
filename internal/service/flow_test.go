package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// stubPool returns nil typed as database.Pool. The mock repository does not
// invoke any methods on it, so the value is opaque — it only satisfies the
// service constructor signature.
func stubPool() database.Pool { return nil }

// stubListFlowDefinitions wires the mock's ListFlowDefinitions to filter the
// given slice in-memory the same way the storage layer does. Tests stay focused
// on the Resolve algorithm without re-stating expected filter sets.
// Returns the mock so the caller can attach additional expectations.
func stubListFlowDefinitions(t *testing.T, defs []*domain.FlowDefinition) *domainmock.MockFlowDefinitionRepository {
	t.Helper()
	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
	repo.EXPECT().
		ListFlowDefinitions(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _ database.QueryExecutor, _ string, opts ...domain.FlowDefinitionListOption) ([]*domain.FlowDefinition, error) {
			o := domain.ApplyFlowDefinitionListOptions(opts)
			out := make([]*domain.FlowDefinition, 0, len(defs))
			for _, def := range defs {
				if o.Name != nil && def.Name != *o.Name {
					continue
				}
				if o.Status != nil && def.Status != *o.Status {
					continue
				}
				if o.Purpose != nil && !hasPurpose(def, *o.Purpose) {
					continue
				}
				if o.SchemaVersion != nil && def.SchemaVersion != *o.SchemaVersion {
					continue
				}
				out = append(out, def)
			}
			return out, nil
		}).
		AnyTimes()
	return repo
}

func hasPurpose(def *domain.FlowDefinition, purpose domain.FlowDefinitionPurpose) bool {
	for _, p := range def.Purposes {
		if p.Purpose == purpose {
			return true
		}
	}
	return false
}

func ptr[T any](v T) *T { return &v }

func newDef(name, version string, audience domain.FlowDefinitionAudience, purposes ...domain.FlowDefinitionPurpose) *domain.FlowDefinition {
	entries := make([]domain.FlowDefinitionPurposeEntry, len(purposes))
	for i, p := range purposes {
		entries[i] = domain.FlowDefinitionPurposeEntry{Purpose: p, InitialStep: "start"}
	}
	return &domain.FlowDefinition{
		ProjectID:     "proj",
		ID:            name + "-" + version,
		Name:          name,
		SchemaVersion: version,
		Status:        domain.FlowDefinitionStatusActive,
		Purposes:      entries,
		Audience:      audience,
	}
}

func TestResolve_ResolveByName_ExactVersion(t *testing.T) {
	want := newDef("login", "1.2.3", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	other := newDef("login", "1.0.0", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{other, want})

	got, err := service.NewFlowService(stubPool(), repo).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID:     "proj",
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Name:          ptr("login"),
		SchemaVersion: ptr("1.2.3"),
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != want {
		t.Fatalf("Resolve = %v, want %v", got, want)
	}
}

func TestResolve_ResolveByName_FiltersWithRequestedOptions(t *testing.T) {
	def := newDef("login", "1.2.3", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)

	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
	repo.EXPECT().
		ListFlowDefinitions(gomock.Any(), gomock.Any(), "proj", gomock.Any()).
		DoAndReturn(func(_ context.Context, _ database.QueryExecutor, _ string, opts ...domain.FlowDefinitionListOption) ([]*domain.FlowDefinition, error) {
			o := domain.ApplyFlowDefinitionListOptions(opts)
			if o.Name == nil || *o.Name != "login" {
				t.Errorf("expected Name=login, got %+v", o.Name)
			}
			if o.Status == nil || *o.Status != domain.FlowDefinitionStatusActive {
				t.Errorf("expected Status=active, got %+v", o.Status)
			}
			if o.SchemaVersion == nil || *o.SchemaVersion != "1.2.3" {
				t.Errorf("expected SchemaVersion=1.2.3, got %+v", o.SchemaVersion)
			}
			return []*domain.FlowDefinition{def}, nil
		})

	_, err := service.NewFlowService(stubPool(), repo).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID:     "proj",
		Purpose:       domain.FlowDefinitionPurposeLogin,
		Name:          ptr("login"),
		SchemaVersion: ptr("1.2.3"),
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
}

func TestResolve_ResolveByName_LatestActiveWhenVersionNil(t *testing.T) {
	v1 := newDef("login", "1.0.0", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	v2 := newDef("login", "2.4.1", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	v15 := newDef("login", "1.5.0", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{v1, v2, v15})

	got, err := service.NewFlowService(stubPool(), repo).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Name:      ptr("login"),
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != v2 {
		t.Fatalf("Resolve = %v, want %v (latest version)", got, v2)
	}
}

func TestResolve_ResolveByName_NotFound(t *testing.T) {
	repo := stubListFlowDefinitions(t, nil)

	_, err := service.NewFlowService(stubPool(), repo).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Name:      ptr("missing"),
	})
	if !errors.Is(err, domain.ErrFlowDefinitionNotFound) {
		t.Fatalf("Resolve err = %v, want ErrFlowNotFound", err)
	}
}

func TestResolve_ResolveByName_PurposeMismatch(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{def})

	_, err := service.NewFlowService(stubPool(), repo).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeRegister,
		Name:      ptr("login"),
	})
	if !errors.Is(err, domain.ErrFlowDefinitionPurposeMismatch) {
		t.Fatalf("Resolve err = %v, want ErrPurposeMismatch", err)
	}
}

func TestResolve_ResolveByAudience_PrefersAppOverTeamOverDefault(t *testing.T) {
	app := newDef("login", "1.0.0", domain.FlowDefinitionAudience{AppID: ptr("app-1")}, domain.FlowDefinitionPurposeLogin)
	team := newDef("login", "1.0.0", domain.FlowDefinitionAudience{TeamID: ptr("team-1")}, domain.FlowDefinitionPurposeLogin)
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{def, team, app})

	got, err := service.NewFlowService(stubPool(), repo).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Hint: service.ResolveFlowHint{
			AppID:  ptr("app-1"),
			TeamID: ptr("team-1"),
		},
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != app {
		t.Fatalf("Resolve = %v, want app definition", got)
	}
}

func TestResolve_ResolveByAudience_SkipsAudienceWithoutMatchingHint(t *testing.T) {
	app := newDef("login", "1.0.0", domain.FlowDefinitionAudience{AppID: ptr("app-1")}, domain.FlowDefinitionPurposeLogin)
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{app, def})

	got, err := service.NewFlowService(stubPool(), repo).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
		Hint:      service.ResolveFlowHint{AppID: ptr("other-app")},
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != def {
		t.Fatalf("Resolve = %v, want default", got)
	}
}

func TestResolve_ResolveByAudience_TiebreakByCreatedAtDesc(t *testing.T) {
	older := newDef("login", "1.0.0", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	older.CreatedAt = time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	newer := newDef("alt", "1.0.0", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	newer.CreatedAt = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{older, newer})

	got, err := service.NewFlowService(stubPool(), repo).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != newer {
		t.Fatalf("Resolve = %v, want newer", got)
	}
}

func TestResolve_ResolveByAudience_KeepsLatestVersionWhenUnpinned(t *testing.T) {
	v1 := newDef("login", "1.0.0", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	v2 := newDef("login", "2.0.0", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{v1, v2})

	got, err := service.NewFlowService(stubPool(), repo).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != v2 {
		t.Fatalf("Resolve = %v, want v2", got)
	}
}

func TestResolve_ResolveByAudience_ExactVersionFiltersOlder(t *testing.T) {
	v1 := newDef("login", "1.0.0", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	v2 := newDef("login", "2.0.0", domain.FlowDefinitionAudience{IsProjectDefault: true}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{v1, v2})

	got, err := service.NewFlowService(stubPool(), repo).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID:     "proj",
		Purpose:       domain.FlowDefinitionPurposeLogin,
		SchemaVersion: ptr("1.0.0"),
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if got != v1 {
		t.Fatalf("Resolve = %v, want v1 (exact match)", got)
	}
}

func TestResolve_ResolveByAudience_NoMatch(t *testing.T) {
	def := newDef("login", "1.0.0", domain.FlowDefinitionAudience{AppID: ptr("app-1")}, domain.FlowDefinitionPurposeLogin)
	repo := stubListFlowDefinitions(t, []*domain.FlowDefinition{def})

	_, err := service.NewFlowService(stubPool(), repo).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
	})
	if !errors.Is(err, domain.ErrFlowDefinitionNotFound) {
		t.Fatalf("Resolve err = %v, want ErrFlowNotFound", err)
	}
}

func TestResolve_ResolveByAudience_RepoErrorPropagates(t *testing.T) {
	sentinel := errors.New("boom")
	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockFlowDefinitionRepository(ctrl)
	repo.EXPECT().
		ListFlowDefinitions(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Return(nil, sentinel)

	_, err := service.NewFlowService(stubPool(), repo).Resolve(t.Context(), service.ResolveFlowRequest{
		ProjectID: "proj",
		Purpose:   domain.FlowDefinitionPurposeLogin,
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("Resolve err = %v, want boom", err)
	}
}
