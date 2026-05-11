package flow

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// Selector chooses the [domain.FlowDefinition] that should serve an incoming
// request. It is read-only and never touches sessions or cookies.
//
// Algorithm:
//  1. If Name is set, do a direct lookup by (ProjectID, Name, SchemaVersion?).
//     Return [ErrFlowNotFound] or [ErrPurposeMismatch] on miss.
//  2. Otherwise list active definitions whose Purposes include req.Purpose.
//  3. Apply semver resolution on SchemaVersion (MVP: exact match; latest
//     active when nil).
//  4. Rank by audience specificity: AppID (3) > TeamID (2) > SchemaID (1)
//     > project default (0).
//  5. Tie-break by created_at DESC.
//  6. Fall back to the built-in project default when no row matches.
type Selector interface {
	Resolve(ctx context.Context, req SelectorRequest) (*domain.FlowDefinition, error)
}

// SelectorRequest is the input to [Selector.Resolve].
type SelectorRequest struct {
	ProjectID     string
	Purpose       domain.FlowDefinitionPurpose
	Name          *string // direct lookup when set; acts as slug
	SchemaVersion *string // semver; nil means latest active
	AuthRequestID *string
	Hint          SelectorHint
}

// SelectorHint carries audience-narrowing context derived from the request
// or the auth-request it came in through.
type SelectorHint struct {
	AppID    *string
	TeamID   *string
	SchemaID *string
}
