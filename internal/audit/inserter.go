package audit

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// PoolInserter adapts a statement-pool insert func to EventInserter.
type PoolInserter struct {
	Insert func(ctx context.Context, event *domain.Event) error
}

func (p PoolInserter) InsertEvent(ctx context.Context, event *domain.Event) error {
	return p.Insert(ctx, event)
}
