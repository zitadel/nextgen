package postgres

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/variable"
)

const (
	variablesQuery = `SELECT name, project_id, value, is_secret, created_at, modified_at
FROM zitadel_nextgen.variables`

	// The conflict target is the natural key, so a rewrite at the same owner and
	// name replaces the value instead of adding a second variable there.
	setVariableStmt = `INSERT INTO zitadel_nextgen.variables (name, project_id, value, is_secret)
VALUES ($1, $2, $3, $4)
ON CONFLICT (name, project_id)
DO UPDATE SET value = EXCLUDED.value, is_secret = EXCLUDED.is_secret, modified_at = NOW()`

	// The owner column is matched exactly, which is the primary key minus the
	// name -- so this addresses exactly one row, and an owner cannot remove a
	// variable another one entered.
	deleteVariableStmt = `DELETE FROM zitadel_nextgen.variables
WHERE name = $1 AND project_id = $2`
)

type variableStatements struct{ statement }

func newVariableStatements(client queryExecutor) variableStatements {
	return variableStatements{statement: statement{client: client}}
}

// GetVariables implements [service.VariableStatements].
func (s variableStatements) GetVariables(ctx context.Context, owner domain.VariableOwner, names ...string) ([]*domain.Variable, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, variablesQuery, variable.VisibleTo(owner, names...), variable.Schema); err != nil {
		return nil, err
	}

	rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, scanVariable)
	if err != nil {
		return nil, wrapError(err)
	}
	return variable.ToDomain(items), nil
}

// SetVariable implements [service.VariableStatements].
func (s variableStatements) SetVariable(ctx context.Context, v *domain.Variable) error {
	encoded, err := json.Marshal(v.Value)
	if err != nil {
		return err
	}
	if _, err := s.client.Exec(ctx, setVariableStmt,
		v.Name, v.Owner.ProjectID, encoded, v.IsSecret,
	); err != nil {
		return wrapError(err)
	}
	return nil
}

// DeleteVariable implements [service.VariableStatements].
func (s variableStatements) DeleteVariable(ctx context.Context, owner domain.VariableOwner, name string) error {
	tag, err := s.client.Exec(ctx, deleteVariableStmt, name, owner.ProjectID)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func scanVariable(row pgx.CollectableRow) (*variable.VariableStorage, error) {
	var (
		stored  variable.VariableStorage
		encoded []byte
	)
	if err := row.Scan(
		&stored.Name, &stored.ProjectID,
		&encoded, &stored.IsSecret, &stored.CreatedAt, &stored.ModifiedAt,
	); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(encoded, &stored.Value); err != nil {
		return nil, err
	}
	stored.CreatedAt = stored.CreatedAt.UTC()
	stored.ModifiedAt = stored.ModifiedAt.UTC()
	return &stored, nil
}

var _ service.VariableStatements = (*variableStatements)(nil)
