package audit

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// Insert persists a Path B event via stmts.InsertEvent.
// When ProjectID is empty the insert is skipped (optional / no actor scope yet).
func Insert(ctx context.Context, stmts EventInserter, ev *domain.Event) error {
	if ev == nil || ev.ProjectID == "" {
		return nil
	}
	return stmts.InsertEvent(ctx, ev)
}
