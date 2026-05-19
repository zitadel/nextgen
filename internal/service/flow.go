package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowService is the flow engine's use-case surface. For now only
// [FlowService.Resolve] is wired; step emission, submission, and session
// handling will land as additional methods so the API handler keeps a
// single dependency.
type FlowService interface {
	// Resolve returns the [domain.FlowDefinition] to run for an incoming
	// flow request. Read-only — never touches sessions or cookies.
	//
	// Resolution algorithm:
	//
	//  1. If [ResolveFlowRequest.Name] is set, look up by
	//     (ProjectID, Name, SchemaVersion?), pick the highest version,
	//     and confirm the requested purpose is served. Return
	//     [domain.ErrFlowDefinitionNotFound] or
	//     [domain.ErrFlowDefinitionPurposeMismatch] on miss.
	//  2. Otherwise return the first active definition whose purposes
	//     include [ResolveFlowRequest.Purpose] (optionally pinned to
	//     [ResolveFlowRequest.SchemaVersion]). [ResolveFlowRequest.Hint]
	//     is plumbed through but not yet honored — see TODO on
	//     resolveByAudience.
	Resolve(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error)
}

// ResolveFlowRequest is the input to [FlowService.Resolve].
type ResolveFlowRequest struct {
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
	// Currently ignored — see TODO on resolveByAudience.
	Hint ResolveFlowHint
}

// ResolveFlowHint carries the audience-narrowing context derived from the
// request or the auth-request that initiated it. Empty fields are ignored
// during matching.
type ResolveFlowHint struct {
	AppID        *string
	TeamID       *string
	UserSchemaID *string
}

// NewFlowService returns a [FlowService] backed by the given
// [domain.FlowDefinitionRepository]. The pool is used as the
// [database.QueryExecutor] for every read.
func NewFlowService(pool database.Pool, flowDefs domain.FlowDefinitionRepository) FlowService {
	return &flowService{pool: pool, flowDefs: flowDefs}
}

type flowService struct {
	pool     database.Pool
	flowDefs domain.FlowDefinitionRepository
}

var _ FlowService = (*flowService)(nil)

func (s *flowService) Resolve(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error) {
	if req.Name != nil {
		return s.resolveByName(ctx, req)
	}
	return s.resolveByAudience(ctx, req)
}

// resolveByName implements the direct-lookup branch: list active definitions
// matching (ProjectID, Name, SchemaVersion?), pick the latest version, then
// confirm the requested purpose is served.
func (s *flowService) resolveByName(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error) {
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

	def := pickLatestFlowVersion(defs)
	if !flowServesPurpose(def, req.Purpose) {
		return nil, domain.ErrFlowDefinitionPurposeMismatch
	}
	return def, nil
}

// resolveByAudience picks the first active definition serving the requested
// purpose (with an optional SchemaVersion pin).
//
// TODO: honor [ResolveFlowRequest.Hint]. The MVP returns whichever row the
// repository yields first; once admin UX produces multiple audience-targeted
// definitions per purpose, score candidates by AppIDs > TeamIDs >
// project-wide (both empty) and tie-break by created_at DESC.
func (s *flowService) resolveByAudience(ctx context.Context, req ResolveFlowRequest) (*domain.FlowDefinition, error) {
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
	return defs[0], nil
}

func flowServesPurpose(def *domain.FlowDefinition, purpose domain.FlowDefinitionPurpose) bool {
	for _, p := range def.Purposes {
		if p.Purpose == purpose {
			return true
		}
	}
	return false
}

// pickLatestFlowVersion returns the definition with the highest SchemaVersion
// among defs. Uses lexicographic compare — sufficient while versions stay
// zero-padded single-digit MAJOR.MINOR.PATCH (MVP scope). Caller must
// ensure defs is non-empty.
func pickLatestFlowVersion(defs []*domain.FlowDefinition) *domain.FlowDefinition {
	winner := defs[0]
	for _, def := range defs[1:] {
		if def.SchemaVersion > winner.SchemaVersion {
			winner = def
		}
	}
	return winner
}
