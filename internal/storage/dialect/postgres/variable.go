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
	variablesQuery = `SELECT project_id, name, kind, value, is_secret, created_at, modified_at
FROM zitadel_nextgen.variables`

	// The conflict target is the natural key, so a rewrite at the same owner,
	// name and kind replaces the value instead of adding a second variable
	// there. The other kind's row under the same name is a different key and
	// is left alone.
	setVariableStmt = `INSERT INTO zitadel_nextgen.variables (project_id, name, kind, value, is_secret)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (project_id, name, kind)
DO UPDATE SET value = EXCLUDED.value, is_secret = EXCLUDED.is_secret, modified_at = NOW()`

	// The owner column and the kind are matched exactly, which with the name
	// is the primary key -- so this addresses exactly one row, and an owner
	// cannot remove a variable another one entered, nor the other kind's
	// value under the same name.
	deleteVariableStmt = `DELETE FROM zitadel_nextgen.variables
WHERE project_id = $1 AND name = $2 AND kind = $3`
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
		v.Owner.ProjectID, v.Name, v.Kind.String(),
		encoded, v.IsSecret,
	); err != nil {
		return wrapError(err)
	}
	return nil
}

// DeleteVariable implements [service.VariableStatements].
func (s variableStatements) DeleteVariable(ctx context.Context, owner domain.VariableOwner, kind domain.OriginKind, name string) error {
	tag, err := s.client.Exec(ctx, deleteVariableStmt,
		owner.ProjectID, name, kind.String(),
	)
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
		stored   variable.VariableStorage
		kindName string
		encoded  []byte
	)
	if err := row.Scan(
		&stored.ProjectID, &stored.Name, &kindName,
		&encoded, &stored.IsSecret, &stored.CreatedAt, &stored.ModifiedAt,
	); err != nil {
		return nil, err
	}
	// Parsed from its name rather than scanned into the enum, so a kind this
	// server does not know fails the read instead of decoding to primary.
	kind, err := domain.OriginKindString(kindName)
	if err != nil {
		return nil, err
	}
	stored.Kind = kind
	if err := json.Unmarshal(encoded, &stored.Value); err != nil {
		return nil, err
	}
	stored.CreatedAt = stored.CreatedAt.UTC()
	stored.ModifiedAt = stored.ModifiedAt.UTC()
	return &stored, nil
}

var _ service.VariableStatements = (*variableStatements)(nil)
