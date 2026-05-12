package flow

import (
	"context"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// NewSelector returns a [Selector] backed by the given
// [domain.FlowDefinitionRepository]. The pool is used as the
// [database.QueryExecutor] for every read.
func NewSelector(pool database.Pool, flowDefs domain.FlowDefinitionRepository) Selector {
	return &selectorService{pool: pool, flowDefs: flowDefs}
}

type selectorService struct {
	pool     database.Pool
	flowDefs domain.FlowDefinitionRepository
}

var _ Selector = (*selectorService)(nil)

func (s *selectorService) Resolve(ctx context.Context, req SelectorRequest) (*domain.FlowDefinition, error) {
	if req.Name != nil {
		return s.resolveByName(ctx, req)
	}
	return s.resolveByAudience(ctx, req)
}

// resolveByName implements the direct-lookup branch: list active definitions
// matching (ProjectID, Name, SchemaVersion?), pick the latest version, then
// confirm the requested purpose is served.
func (s *selectorService) resolveByName(ctx context.Context, req SelectorRequest) (*domain.FlowDefinition, error) {
	opts := []domain.FlowDefinitionListOption{
		domain.WithFlowDefinitionName(*req.Name),
		domain.WithFlowDefinitionStatus(domain.FlowDefinitionStatusActive),
	}
	if req.SchemaVersion != nil {
		opts = append(opts, domain.WithSchemaVersion(*req.SchemaVersion))
	}

	defs, err := s.flowDefs.ListFlowDefinitions(ctx, s.pool, req.ProjectID, opts...)
	if err != nil {
		return nil, err
	}
	if len(defs) == 0 {
		return nil, domain.ErrFlowDefinitionNotFound
	}

	def := pickLatestVersion(defs)
	if !servesPurpose(def, req.Purpose) {
		return nil, domain.ErrFlowDefinitionPurposeMismatch
	}
	return def, nil
}

// resolveByAudience implements the audience-match branch: list active
// definitions serving the requested purpose, filter on the optional
// SchemaVersion, then pick the one best matching the audience hint.
func (s *selectorService) resolveByAudience(ctx context.Context, req SelectorRequest) (*domain.FlowDefinition, error) {
	opts := []domain.FlowDefinitionListOption{
		domain.WithFlowDefinitionStatus(domain.FlowDefinitionStatusActive),
		domain.WithFlowDefinitionPurpose(req.Purpose),
	}
	if req.SchemaVersion != nil {
		opts = append(opts, domain.WithSchemaVersion(*req.SchemaVersion))
	}

	defs, err := s.flowDefs.ListFlowDefinitions(ctx, s.pool, req.ProjectID, opts...)
	if err != nil {
		return nil, err
	}
	if len(defs) == 0 {
		return nil, domain.ErrFlowDefinitionNotFound
	}

	if req.SchemaVersion == nil {
		defs = keepLatestVersion(defs)
	}

	candidates := make([]audienceCandidate, 0, len(defs))
	for _, def := range defs {
		score, ok := audienceScore(def.Audience, req.Hint)
		if !ok {
			continue
		}
		candidates = append(candidates, audienceCandidate{def: def, score: score})
	}
	if len(candidates) == 0 {
		return nil, domain.ErrFlowDefinitionNotFound
	}

	slices.SortStableFunc(candidates, func(a, b audienceCandidate) int {
		if a.score != b.score {
			return b.score - a.score
		}
		return b.def.CreatedAt.Compare(a.def.CreatedAt)
	})
	return candidates[0].def, nil
}

type audienceCandidate struct {
	def   *domain.FlowDefinition
	score int
}

// audienceScore reports how specifically the audience targets the hint.
// AppID (3) > TeamID (2) > UserSchemaID (1) > IsProjectDefault (0).
// Returns ok=false when the audience targets a field the hint did not
// match, or when no targeting field and no project-default is set.
func audienceScore(a domain.FlowDefinitionAudience, hint SelectorHint) (int, bool) {
	switch {
	case a.AppID != nil:
		return 3, hint.AppID != nil && *a.AppID == *hint.AppID
	case a.TeamID != nil:
		return 2, hint.TeamID != nil && *a.TeamID == *hint.TeamID
	case a.UserSchemaID != nil:
		return 1, hint.UserSchemaID != nil && *a.UserSchemaID == *hint.UserSchemaID
	case a.IsProjectDefault:
		return 0, true
	default:
		return 0, false
	}
}

func servesPurpose(def *domain.FlowDefinition, purpose domain.FlowDefinitionPurpose) bool {
	for _, p := range def.Purposes {
		if p.Purpose == purpose {
			return true
		}
	}
	return false
}

// pickLatestVersion returns the definition with the highest SchemaVersion
// among defs. Uses lexicographic compare — sufficient while versions stay
// zero-padded single-digit MAJOR.MINOR.PATCH (MVP scope). Caller must
// ensure defs is non-empty.
func pickLatestVersion(defs []*domain.FlowDefinition) *domain.FlowDefinition {
	winner := defs[0]
	for _, def := range defs[1:] {
		if def.SchemaVersion > winner.SchemaVersion {
			winner = def
		}
	}
	return winner
}

// keepLatestVersion reduces defs to the rows sharing the highest
// SchemaVersion, preserving order. Same lex-compare caveat as
// [pickLatestVersion].
func keepLatestVersion(defs []*domain.FlowDefinition) []*domain.FlowDefinition {
	if len(defs) == 0 {
		return defs
	}
	max := pickLatestVersion(defs).SchemaVersion
	out := defs[:0]
	for _, def := range defs {
		if def.SchemaVersion == max {
			out = append(out, def)
		}
	}
	return out
}
