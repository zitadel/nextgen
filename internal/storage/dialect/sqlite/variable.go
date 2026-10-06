package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/variable"
)

const (
	variablesQuery = `SELECT name, project_id, applies_to, value, is_secret, created_at, modified_at
FROM variables`

	// The conflict target is the primary key, so a rewrite of the same name
	// and applies_to replaces the value instead of adding a second row.
	setVariableStmt = `INSERT INTO variables (name, project_id, applies_to, value, is_secret, created_at, modified_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (project_id, name, applies_to)
DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, modified_at = excluded.modified_at`

	deleteVariableStmt = `DELETE FROM variables
WHERE name = ? AND project_id = ? AND applies_to = ?`
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
	defer rows.Close()
	items, err := collectRows(rows, scanVariable)
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
	now := nowUnixNano()
	_, err = execAffected(ctx, s.client, setVariableStmt,
		v.Name, v.Owner.ProjectID, v.AppliesTo.String(),
		string(encoded), v.IsSecret, now, now,
	)
	return err
}

// DeleteVariable implements [service.VariableStatements].
func (s variableStatements) DeleteVariable(ctx context.Context, projectID string, appliesTo domain.VariableAppliesTo, name string) error {
	n, err := execAffected(ctx, s.client, deleteVariableStmt, name, projectID, appliesTo.String())
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func scanVariable(rows *sql.Rows) (*variable.VariableStorage, error) {
	var (
		row          variable.VariableStorage
		encoded      string
		createdNano  int64
		modifiedNano int64
	)
	if err := rows.Scan(
		&row.Name, &row.ProjectID, &row.AppliesTo,
		&encoded, &row.IsSecret, &createdNano, &modifiedNano,
	); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(encoded), &row.Value); err != nil {
		return nil, err
	}
	row.CreatedAt = timeFromUnixNano(createdNano)
	row.ModifiedAt = timeFromUnixNano(modifiedNano)
	return &row, nil
}

var _ service.VariableStatements = (*variableStatements)(nil)
