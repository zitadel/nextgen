package repository

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func writeCondition(
	builder *database.StatementBuilder,
	condition database.Condition,
) {
	if condition == nil {
		return
	}
	builder.WriteString(" WHERE ")
	condition.Write(builder)
}

func checkRestrictingColumns(
	condition database.Condition,
	requiredColumns ...database.Column,
) error {
	for _, col := range requiredColumns {
		if !condition.IsRestrictingColumn(col) {
			return database.NewMissingConditionError(col)
		}
	}
	return nil
}

// uniqueKeyLocator is implemented by repositories whose rows can also be
// addressed by a database UNIQUE constraint (natural key) in addition to
// the primary key.
type uniqueKeyLocator interface {
	UniqueKeyColumns() []database.Column
}

// checkPKOrUniqueKeyCondition ensures the condition restricts either all primary
// key columns or, when supported, all columns of an alternate unique key.
func checkPKOrUniqueKeyCondition(
	repo domain.Repository,
	condition database.Condition,
) error {
	pkErr := checkRestrictingColumns(condition, repo.PrimaryKeyColumns()...)
	if pkErr == nil {
		return nil
	}
	if u, ok := repo.(uniqueKeyLocator); ok {
		if cols := u.UniqueKeyColumns(); len(cols) > 0 {
			if err := checkRestrictingColumns(condition, cols...); err == nil {
				return nil
			}
		}
	}
	return pkErr
}

func getOne[Target any](ctx context.Context, querier database.Querier, builder *database.StatementBuilder) (*Target, error) {
	rows, err := querier.Query(ctx, builder.String(), builder.Args()...)
	if err != nil {
		return nil, err
	}
	var target Target
	if err := rows.(database.CollectableRows).CollectExactlyOneRow(&target); err != nil {
		return nil, err
	}
	return &target, nil
}

func getMany[Target any](ctx context.Context, querier database.Querier, builder *database.StatementBuilder) ([]*Target, error) {
	rows, err := querier.Query(ctx, builder.String(), builder.Args()...)
	if err != nil {
		return nil, err
	}
	var targets []*Target
	if err := rows.(database.CollectableRows).Collect(&targets); err != nil {
		return nil, err
	}
	return targets, nil
}

type updatable interface {
	PrimaryKeyColumns() []database.Column
	UpdatedAtColumn() database.Column
	qualifiedTableName() string
}

func updateOne[Target updatable](ctx context.Context, client database.QueryExecutor, target Target, condition database.Condition, changes ...database.Change) (int64, error) {
	if len(changes) == 0 {
		return 0, database.ErrNoChanges
	}
	if err := checkPKOrUniqueKeyCondition(target, condition); err != nil {
		return 0, err
	}
	if !database.Changes(changes).IsOnColumn(target.UpdatedAtColumn()) {
		changes = append(changes, database.NewChange(target.UpdatedAtColumn(), database.NullInstruction))
	}
	builder := database.NewStatementBuilder("UPDATE ")
	builder.WriteString(target.qualifiedTableName())
	builder.WriteString(" SET ")
	if err := database.Changes(changes).Write(builder); err != nil {
		return 0, err
	}
	writeCondition(builder, condition)

	return client.Exec(ctx, builder.String(), builder.Args()...)
}

type deletable interface {
	PrimaryKeyColumns() []database.Column
	qualifiedTableName() string
}

func deleteOne[Target deletable](ctx context.Context, client database.QueryExecutor, target Target, condition database.Condition) (int64, error) {
	if err := checkPKOrUniqueKeyCondition(target, condition); err != nil {
		return 0, err
	}

	builder := database.NewStatementBuilder("DELETE FROM ")
	builder.WriteString(target.qualifiedTableName())
	builder.WriteRune(' ')
	writeCondition(builder, condition)

	return client.Exec(ctx, builder.String(), builder.Args()...)
}
