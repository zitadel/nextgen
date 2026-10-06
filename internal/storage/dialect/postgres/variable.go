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
	variablesQuery = `SELECT name, project_id, applies_to, value, is_secret, created_at, modified_at
FROM zitadel_nextgen.variables`

	// The conflict target is the primary key, so a rewrite of the same name
	// and applies_to replaces the value instead of adding a second row.
	setVariableStmt = `INSERT INTO zitadel_nextgen.variables (name, project_id, applies_to, value, is_secret)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (project_id, name, applies_to)
DO UPDATE SET value = EXCLUDED.value, is_secret = EXCLUDED.is_secret, modified_at = NOW()`

	deleteVariableStmt = `DELETE FROM zitadel_nextgen.variables
WHERE name = $1 AND project_id = $2 AND applies_to = $3`
)

type variableStatements struct{ statement }

func newVariableStatements(client queryExecutor) variableStatements {
	return variableStatements{statement: statement{client: client}}
}

// GetVariables implements [service.VariableStatements].
func (s variableStatements) GetVariables(ctx context.Context, projectID string, appliesTo *domain.VariableAppliesTo, names ...string) ([]*domain.Variable, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, variablesQuery, variable.VisibleTo(projectID, appliesTo, names...), variable.Schema); err != nil {
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
	return variable.ToDomain(items)
}

// SetVariable implements [service.VariableStatements].
func (s variableStatements) SetVariable(ctx context.Context, v *domain.Variable) error {
	encoded, err := json.Marshal(v.Value)
	if err != nil {
		return err
	}
	if _, err := s.client.Exec(ctx, setVariableStmt,
		v.Name, v.Owner.ProjectID, v.AppliesTo.String(),
		encoded, v.IsSecret,
	); err != nil {
		return wrapError(err)
	}
	return nil
}

// DeleteVariable implements [service.VariableStatements].
func (s variableStatements) DeleteVariable(ctx context.Context, projectID string, appliesTo domain.VariableAppliesTo, name string) error {
	tag, err := s.client.Exec(ctx, deleteVariableStmt, name, projectID, appliesTo.String())
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
		&stored.Name, &stored.ProjectID, &stored.AppliesTo,
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
