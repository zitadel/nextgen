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
	variablesQuery = `SELECT project_id, name, kind, value, is_secret, created_at, modified_at
FROM variables`

	// The conflict target is the natural key, so a rewrite at the same owner,
	// name and kind replaces the value instead of adding a second variable
	// there. The other kind's row under the same name is a different key and
	// is left alone.
	setVariableStmt = `INSERT INTO variables (project_id, name, kind, value, is_secret, created_at, modified_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (project_id, name, kind)
DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, modified_at = excluded.modified_at`

	// The owner column and the kind are matched exactly, which with the name
	// is the primary key -- so this addresses exactly one row, and an owner
	// cannot remove a variable another one entered, nor the other kind's
	// value under the same name.
	deleteVariableStmt = `DELETE FROM variables
WHERE project_id = ? AND name = ? AND kind = ?`
)

type variableStatements struct{ statement }

func newVariableStatements(client queryExecutor) variableStatements {
	return variableStatements{statement: statement{client: client}}
}

// GetVariables implements [service.VariableStatements].
func (s variableStatements) GetVariables(ctx context.Context, owner domain.VariableOwner, kind domain.OriginKind, names ...string) ([]*domain.Variable, error) {
	return readVariables(ctx, s.client, owner, kind, names...)
}

// readVariables is the read behind GetVariables on any executor, so a freeze
// can run it on its own transaction and copy the rows that transaction sees.
func readVariables(ctx context.Context, client queryExecutor, owner domain.VariableOwner, kind domain.OriginKind, names ...string) ([]*domain.Variable, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, variablesQuery, variable.VisibleTo(owner, kind, names...), variable.Schema); err != nil {
		return nil, err
	}

	rows, err := client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
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
		v.Owner.ProjectID, v.Name, v.Kind.String(),
		string(encoded), v.IsSecret, now, now,
	)
	return err
}

// DeleteVariable implements [service.VariableStatements].
func (s variableStatements) DeleteVariable(ctx context.Context, owner domain.VariableOwner, kind domain.OriginKind, name string) error {
	n, err := execAffected(ctx, s.client, deleteVariableStmt,
		owner.ProjectID, name, kind.String(),
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
		kindName     string
		encoded      string
		createdNano  int64
		modifiedNano int64
	)
	if err := rows.Scan(
		&row.ProjectID, &row.Name, &kindName,
		&encoded, &row.IsSecret, &createdNano, &modifiedNano,
	); err != nil {
		return nil, err
	}
	// Parsed from its name rather than scanned into the enum, so a kind this
	// server does not know fails the read instead of decoding to primary.
	kind, err := domain.OriginKindString(kindName)
	if err != nil {
		return nil, err
	}
	row.Kind = kind
	if err := json.Unmarshal([]byte(encoded), &row.Value); err != nil {
		return nil, err
	}
	row.CreatedAt = timeFromUnixNano(createdNano)
	row.ModifiedAt = timeFromUnixNano(modifiedNano)
	return &row, nil
}

var _ service.VariableStatements = (*variableStatements)(nil)
