package flow

import (
	"context"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Service is the flow engine's use-case surface. For now only [Service.Resolve]
// is wired; step emission, submission, and session handling will land as
// additional methods so the API handler keeps a single dependency.
type Service interface {
	// Resolve returns the [domain.FlowDefinition] to run for an incoming
	// flow request. Read-only — never touches sessions or cookies.
	//
	// Resolution algorithm:
	//
	//  1. If [ResolveRequest.Name] is set, look up by
	//     (ProjectID, Name, SchemaVersion?). Return
	//     [domain.ErrFlowDefinitionNotFound] or
	//     [domain.ErrFlowDefinitionPurposeMismatch] on miss.
	//  2. Otherwise list active definitions whose purposes include
	//     [ResolveRequest.Purpose].
	//  3. Apply semver resolution on [ResolveRequest.SchemaVersion]:
	//     exact match for MVP; latest active when nil. Caret/tilde ranges
	//     are deferred until an upgrade story exists.
	//  4. Rank by audience specificity: AppID (3) > TeamID (2) >
	//     UserSchemaID (1) > project default (0).
	//  5. Tie-break by created_at DESC.
	//  6. Fall back to the built-in project default when no row matches.
	Resolve(ctx context.Context, req ResolveRequest) (*domain.FlowDefinition, error)
}

// ResolveRequest is the input to [Service.Resolve].
type ResolveRequest struct {
	ProjectID string
	Purpose   domain.FlowDefinitionPurpose

	// Name, when set, switches to direct lookup. It acts as a slug.
	Name *string

	// SchemaVersion is a semver string. Nil means "latest active".
	SchemaVersion *string

	// AuthRequestID carries the OIDC/SAML request ID when the flow was
	// initiated by a downstream protocol handler.
	AuthRequestID *string

	// Hint narrows audience matching when no direct lookup is in play.
	Hint ResolveHint
}

// ResolveHint carries the audience-narrowing context derived from the
// request or the auth-request that initiated it. Empty fields are
// ignored during matching.
type ResolveHint struct {
	AppID        *string
	TeamID       *string
	UserSchemaID *string
}

// NewService returns a [Service] backed by the given
// [domain.FlowDefinitionRepository]. The pool is used as the
// [database.QueryExecutor] for every read.
func NewService(pool database.Pool, flowDefs domain.FlowDefinitionRepository) Service {
	return &service{pool: pool, flowDefs: flowDefs}
}

type service struct {
	pool     database.Pool
	flowDefs domain.FlowDefinitionRepository
}

var _ Service = (*service)(nil)

func (s *service) Resolve(ctx context.Context, req ResolveRequest) (*domain.FlowDefinition, error) {
	if req.Name != nil {
		return s.resolveByName(ctx, req)
	}
	return s.resolveByAudience(ctx, req)
}

// resolveByName implements the direct-lookup branch: list active definitions
// matching (ProjectID, Name, SchemaVersion?), pick the latest version, then
// confirm the requested purpose is served.
func (s *service) resolveByName(ctx context.Context, req ResolveRequest) (*domain.FlowDefinition, error) {
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
func (s *service) resolveByAudience(ctx context.Context, req ResolveRequest) (*domain.FlowDefinition, error) {
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
func audienceScore(a domain.FlowDefinitionAudience, hint ResolveHint) (int, bool) {
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
