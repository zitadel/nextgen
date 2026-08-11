package audit

import (
	"context"

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
}

// Emit builds and inserts a Path B event. Empty ProjectID skips the insert
// (no actor/project scope yet).
func Emit(ctx context.Context, stmts EventInserter, spec EmitSpec) error {
	ev := WithEntity(FromContext(ctx, spec.Type, spec.Category), spec.EntityType, spec.EntityID)
	ev = WithProjectID(ev, spec.ProjectID)
	if spec.SessionID != nil {
		ev.SessionID = spec.SessionID
	}
	if spec.TokenID != "" {
		ev.TokenID = spec.TokenID
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
