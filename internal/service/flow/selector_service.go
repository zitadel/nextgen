package flow

import (
	"context"
	"slices"
	"strconv"
	"strings"

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
// AppID (3) > TeamID (2) > SchemaID (1) > IsProjectDefault (0).
// A definition with no targeting field set and IsProjectDefault == false is
// never a candidate. A definition whose targeting field does not match the
// corresponding hint is also discarded.
func audienceScore(a domain.FlowDefinitionAudience, hint SelectorHint) (int, bool) {
	if a.AppID != nil {
		if hint.AppID == nil || *a.AppID != *hint.AppID {
			return 0, false
		}
		return 3, true
	}
	if a.TeamID != nil {
		if hint.TeamID == nil || *a.TeamID != *hint.TeamID {
			return 0, false
		}
		return 2, true
	}
	if a.SchemaID != nil {
		if hint.SchemaID == nil || *a.SchemaID != *hint.SchemaID {
			return 0, false
		}
		return 1, true
	}
	if a.IsProjectDefault {
		return 0, true
	}
	return 0, false
}

func servesPurpose(def *domain.FlowDefinition, purpose domain.FlowDefinitionPurpose) bool {
	for _, p := range def.Purposes {
		if p.Purpose == purpose {
			return true
		}
	}
	return false
}

// pickLatestVersion returns the definition with the highest semver among the
// given slice. The caller must ensure defs is non-empty.
func pickLatestVersion(defs []*domain.FlowDefinition) *domain.FlowDefinition {
	winner := defs[0]
	for _, def := range defs[1:] {
		if compareSemver(def.SchemaVersion, winner.SchemaVersion) > 0 {
			winner = def
		}
	}
	return winner
}

// keepLatestVersion reduces the set to the highest semver value, preserving
// all rows that share it. Used in the audience branch where multiple
// audiences may publish the same version.
func keepLatestVersion(defs []*domain.FlowDefinition) []*domain.FlowDefinition {
	if len(defs) == 0 {
		return defs
	}
	max := defs[0].SchemaVersion
	for _, def := range defs[1:] {
		if compareSemver(def.SchemaVersion, max) > 0 {
			max = def.SchemaVersion
		}
	}
	out := defs[:0]
	for _, def := range defs {
		if compareSemver(def.SchemaVersion, max) == 0 {
			out = append(out, def)
		}
	}
	return out
}

// compareSemver does a numeric compare of MAJOR.MINOR.PATCH segments. Missing
// segments are treated as zero. Pre-release suffixes are ignored; caret/tilde
// ranges are out of scope per ADR / spec. Falls back to lexicographic compare
// on unparseable input so the function is total.
func compareSemver(a, b string) int {
	if a == b {
		return 0
	}
	as, aTail := splitSemver(a)
	bs, bTail := splitSemver(b)
	for i := 0; i < 3; i++ {
		ai, aok := parseSegment(as, i)
		bi, bok := parseSegment(bs, i)
		if !aok || !bok {
			return strings.Compare(a, b)
		}
		if ai != bi {
			return ai - bi
		}
	}
	return strings.Compare(aTail, bTail)
}

func splitSemver(v string) ([]string, string) {
	v = strings.TrimPrefix(v, "v")
	core, tail, _ := strings.Cut(v, "-")
	return strings.Split(core, "."), tail
}

func parseSegment(segments []string, i int) (int, bool) {
	if i >= len(segments) {
		return 0, true
	}
	n, err := strconv.Atoi(segments[i])
	if err != nil {
		return 0, false
	}
	return n, true
}
