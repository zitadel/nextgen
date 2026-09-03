package audit

import (
	"context"
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
)

// EmitSpec is one Path B wide-event emission (ADR 048).
type EmitSpec struct {
	Type       domain.EventType
	Category   domain.EventCategory
	ProjectID  string
	EntityType string
	EntityID   string
	Payload    any
	SessionID  *string
	TokenID    string
	// Optional actor overrides when the request ActorContext is empty
	// (anonymous session mint, token issue before AuthGate, etc.).
	ActorID   *string
	ActorType *domain.EventActorType
	// ForceProjectID makes ProjectID win over the actor context's project.
	// Use for protected-project mutations by a foreign human (ADR 053 §8).
	ForceProjectID bool
	// ClearTeamID drops actor TeamID so the column stays protected-resource
	// scope only (ADR 053 §8). Pair with ForceProjectID for foreign actors.
	ClearTeamID bool
	// Metadata merges into events.metadata (authorization path, etc.).
	Metadata *domain.EventMetadata
}

// Emit builds and inserts a Path B event. Empty ProjectID skips the insert
// (no actor/project scope yet).
func Emit(ctx context.Context, stmts EventInserter, spec EmitSpec) error {
	ev := WithEntity(FromContext(ctx, spec.Type, spec.Category), spec.EntityType, spec.EntityID)
	ev = WithProjectID(ev, spec.ProjectID)
	if spec.ForceProjectID && spec.ProjectID != "" {
		ev.ProjectID = spec.ProjectID
	}
	if spec.ClearTeamID {
		ev.TeamID = nil
	}
	if spec.SessionID != nil {
		ev.SessionID = spec.SessionID
	}
	if spec.TokenID != "" {
		ev.TokenID = spec.TokenID
	}
	if spec.ActorID != nil {
		ev.ActorID = spec.ActorID
	}
	if spec.ActorType != nil {
		ev.ActorType = spec.ActorType
	}
	if spec.Metadata != nil {
		raw, err := json.Marshal(spec.Metadata)
		if err != nil {
			return err
		}
		ev.Metadata = raw
	}
	ev, err := WithPayload(ev, spec.Payload)
	if err != nil {
		return err
	}
	return Insert(ctx, stmts, ev)
}

// Insert persists a Path B event via stmts.InsertEvent.
// When ProjectID is empty the insert is skipped (optional / no actor scope yet).
func Insert(ctx context.Context, stmts EventInserter, ev *domain.Event) error {
	if ev == nil || ev.ProjectID == "" {
		return nil
	}
	return stmts.InsertEvent(ctx, ev)
}
