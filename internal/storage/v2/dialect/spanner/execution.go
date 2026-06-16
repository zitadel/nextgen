package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type execution struct {
	client queryExecutor
	stmt   spanner.Statement
	scan   func(iter *spanner.RowIterator) error
}

// Execute implements [database.Execution].
func (e *execution) Execute(ctx context.Context) error {
	err := e.client.
}

var _ database.Execution = (*execution)(nil)
