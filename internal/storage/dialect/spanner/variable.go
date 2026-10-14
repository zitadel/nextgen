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
	variablesQuery = `SELECT project_id, name, kind, value, is_secret, created_at, modified_at
FROM variables`

	// INSERT OR UPDATE keys on the primary key, which is the natural key
	// here, so a rewrite at the same owner, name and kind replaces the value
	// instead of adding a second variable there. The other kind's row under
	// the same name is a different key and is left alone.
	setVariableStmt = `INSERT OR UPDATE INTO variables (project_id, name, kind, value, is_secret, modified_at)
VALUES (@p1, @p2, @p3, @p4, @p5, CURRENT_TIMESTAMP())`

	// The owner column and the kind are matched exactly, which with the name
	// is the primary key -- so this addresses exactly one row, and an owner
	// cannot remove a variable another one entered, nor the other kind's
	// value under the same name.
	deleteVariableStmt = `DELETE FROM variables
WHERE project_id = @p1 AND name = @p2 AND kind = @p3`
)

type variableStatements struct{ statement }

func newVariableStatements(db queryExecutor) variableStatements {
	return variableStatements{statement: statement{db: db}}
}

// GetVariables implements [service.VariableStatements].
func (s variableStatements) GetVariables(ctx context.Context, owner domain.VariableOwner, kind domain.TargetKind, names ...string) ([]*domain.Variable, error) {
	return readVariables(ctx, s.db, owner, kind, names...)
}

// readVariables is the read behind GetVariables on any executor, so a freeze
// can run it on its own transaction and copy the rows that transaction sees.
func readVariables(ctx context.Context, db queryExecutor, owner domain.VariableOwner, kind domain.TargetKind, names ...string) ([]*domain.Variable, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, variablesQuery, variable.VisibleTo(owner, kind, names...), variable.Schema); err != nil {
		return nil, err
	}

	var items []*variable.VariableStorage
	if err := db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
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
	// The kind is bound as its name, never as the enum, which the Spanner
	// client cannot encode.
	stmt := buildStatement(setVariableStmt,
		v.Owner.ProjectID, v.Name, v.Kind.String(),
		spanner.NullJSON{Value: json.RawMessage(encoded), Valid: true}, v.IsSecret,
	).statement()
	if _, err := s.db.Update(ctx, stmt); err != nil {
		return wrapError(err)
	}
	return nil
}

// DeleteVariable implements [service.VariableStatements].
func (s variableStatements) DeleteVariable(ctx context.Context, owner domain.VariableOwner, kind domain.TargetKind, name string) error {
	stmt := buildStatement(deleteVariableStmt,
		owner.ProjectID, name, kind.String(),
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
		kindName   string
		encoded    spanner.NullJSON
		createdAt  time.Time
		modifiedAt time.Time
	)
	if err := row.Columns(
		&stored.ProjectID, &stored.Name, &kindName,
		&encoded, &stored.IsSecret, &createdAt, &modifiedAt,
	); err != nil {
		return nil, err
	}
	// Parsed from its name rather than scanned into the enum, so a kind this
	// server does not know fails the read instead of decoding to primary.
	kind, err := domain.TargetKindString(kindName)
	if err != nil {
		return nil, err
	}
	stored.Kind = kind
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
