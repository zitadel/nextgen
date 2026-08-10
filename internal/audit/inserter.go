package audit

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// PoolInserter inserts events via a statement pool.
type PoolInserter struct {
	Insert func(ctx context.Context, event *domain.Event) error
}

func (p PoolInserter) InsertEvent(ctx context.Context, event *domain.Event) error {
	if p.Insert == nil {
		return nil
	}
	return p.Insert(ctx, event)
}
