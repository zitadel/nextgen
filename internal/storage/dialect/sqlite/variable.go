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
	variablesQuery = `SELECT name, project_id, environment_name, value, is_secret, created_at, modified_at
FROM variables`

	// The conflict target is the natural key, so a rewrite at the same owner and
	// name replaces the value instead of adding a second variable there.
	setVariableStmt = `INSERT INTO variables (name, project_id, environment_name, value, is_secret, created_at, modified_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (name, project_id, environment_name)
DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, modified_at = excluded.modified_at`

	// Both owner columns are matched exactly, which is the primary key minus
	// the name -- so this addresses exactly one row, and an owner cannot remove
	// a variable another one entered.
	deleteVariableStmt = `DELETE FROM variables
WHERE name = ? AND project_id = ? AND environment_name = ?`
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
	items, err := collectRows(rows, scanVariable)
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
	now := nowUnixNano()
	_, err = execAffected(ctx, s.client, setVariableStmt,
		v.Name, v.Owner.ProjectID, v.Owner.EnvironmentName,
		string(encoded), v.IsSecret, now, now,
	)
	return err
}

// DeleteVariable implements [service.VariableStatements].
func (s variableStatements) DeleteVariable(ctx context.Context, owner domain.VariableOwner, name string) error {
	n, err := execAffected(ctx, s.client, deleteVariableStmt,
		name, owner.ProjectID, owner.EnvironmentName,
	)
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
		&row.Name, &row.ProjectID, &row.EnvironmentName,
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
