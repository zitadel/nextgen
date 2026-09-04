package spanner

import (
	"context"
	"encoding/json"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/variable"
)

const (
	variablesQuery = `SELECT name, project_id, environment_name, team_id, user_schema_id, user_id, value, is_secret, created_at, modified_at
FROM variables`

	// INSERT OR UPDATE keys on the primary key, which is the natural key here,
	// so a rewrite at the same owner and name replaces the value instead of
	// adding a second variable there.
	setVariableStmt = `INSERT OR UPDATE INTO variables (name, project_id, environment_name, team_id, user_schema_id, user_id, value, is_secret, modified_at)
VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, CURRENT_TIMESTAMP())`

	// Every owner column is matched exactly, so this can only remove the
	// variable the caller owns -- never one it merely inherits.
	deleteVariableStmt = `DELETE FROM variables
WHERE name = @p1 AND project_id = @p2 AND environment_name = @p3 AND team_id = @p4 AND user_schema_id = @p5 AND user_id = @p6`
)

type variableStatements struct{ statement }

func newVariableStatements(db queryExecutor) variableStatements {
	return variableStatements{statement: statement{db: db}}
}

// GetVariables implements [service.VariableStatements].
func (s variableStatements) GetVariables(ctx context.Context, requester domain.VariableOwner, names ...string) ([]*domain.Variable, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, variablesQuery, variable.VisibleTo(requester, names...), variable.Schema); err != nil {
		return nil, err
	}

	var items []*variable.VariableStorage
	if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		items, err = collectRows(iter, scanVariable)
		return err
	}); err != nil {
		return nil, returnQueryError(err)
	}
	return variable.ToDomain(items), nil
}

// SetVariable implements [service.VariableStatements].
func (s variableStatements) SetVariable(ctx context.Context, v *domain.Variable) error {
	encoded, err := json.Marshal(v.Value)
	if err != nil {
		return err
	}
	stmt := buildStatement(setVariableStmt,
		v.Name, v.Owner.ProjectID, v.Owner.EnvironmentName, v.Owner.TeamID, v.Owner.UserSchemaID, v.Owner.UserID,
		spanner.NullJSON{Value: json.RawMessage(encoded), Valid: true}, v.IsSecret,
	).statement()
	if _, err := s.db.Update(ctx, stmt); err != nil {
		return wrapError(err)
	}
	return nil
}

// DeleteVariable implements [service.VariableStatements].
func (s variableStatements) DeleteVariable(ctx context.Context, owner domain.VariableOwner, name string) error {
	stmt := buildStatement(deleteVariableStmt,
		name, owner.ProjectID, owner.EnvironmentName, owner.TeamID, owner.UserSchemaID, owner.UserID,
	).statement()
	n, err := s.db.Update(ctx, stmt)
	if err != nil {
		return wrapError(err)
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func scanVariable(row *spanner.Row) (*variable.VariableStorage, error) {
	var (
		stored     variable.VariableStorage
		encoded    spanner.NullJSON
		createdAt  time.Time
		modifiedAt time.Time
	)
	if err := row.Columns(
		&stored.Name, &stored.ProjectID, &stored.EnvironmentName, &stored.TeamID, &stored.UserSchemaID, &stored.UserID,
		&encoded, &stored.IsSecret, &createdAt, &modifiedAt,
	); err != nil {
		return nil, err
	}
	raw, err := decodeNullJSON(encoded)
	if err != nil {
		return nil, err
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &stored.Value); err != nil {
			return nil, err
		}
	}
	stored.CreatedAt = createdAt.UTC()
	stored.ModifiedAt = modifiedAt.UTC()
	return &stored, nil
}

var _ service.VariableStatements = (*variableStatements)(nil)
