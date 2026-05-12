package flow

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// Selector resolves a [domain.FlowDefinition] for an incoming request.
// It is read-only and never touches sessions or cookies.
//
// Resolution algorithm:
//
//  1. If [SelectorRequest.Name] is set, look up by
//     (ProjectID, Name, SchemaVersion?). Return
//     [domain.ErrFlowDefinitionNotFound] or
//     [domain.ErrFlowDefinitionPurposeMismatch] on miss.
//  2. Otherwise list active definitions whose purposes include
//     [SelectorRequest.Purpose].
//  3. Apply semver resolution on [SelectorRequest.SchemaVersion]:
//     exact match for MVP; latest active when nil. Caret/tilde ranges
//     are deferred until an upgrade story exists.
//  4. Rank by audience specificity: AppID (3) > TeamID (2) >
//     UserSchemaID (1) > project default (0).
//  5. Tie-break by created_at DESC.
//  6. Fall back to the built-in project default when no row matches.
type Selector interface {
	Resolve(ctx context.Context, req SelectorRequest) (*domain.FlowDefinition, error)
}

// SelectorRequest is the input to [Selector.Resolve].
type SelectorRequest struct {
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
	Hint SelectorHint
}

// SelectorHint carries the audience-narrowing context derived from the
// request or the auth-request that initiated it. Empty fields are
// ignored during matching.
type SelectorHint struct {
	AppID        *string
	TeamID       *string
	UserSchemaID *string
}
