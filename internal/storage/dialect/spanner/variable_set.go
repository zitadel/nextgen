package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/variableset"
)

const (
	// OR IGNORE rather than OR UPDATE: a set is immutable and addressed by
	// the hash of its content, so a row that exists already holds exactly
	// these entries, and a deployment whose values did not change writes no
	// row. Only a row at the same primary key is ignored; a CHECK or foreign
	// key violation is still reported. (Unlike SQLite's INSERT OR IGNORE,
	// which swallows every UNIQUE, NOT NULL, CHECK and PRIMARY KEY conflict,
	// though never a foreign key violation.)
	insertVariableSetStmt = `INSERT OR IGNORE INTO variable_sets (project_id, content_hash, entries)
VALUES (@p1, @p2, @p3)`

	// A plain insert: the primary key is what makes a second freeze of the
	// same deployment a UniqueError, and the deployment key is what makes a
	// deployment the project does not hold a ForeignKeyError.
	linkDeploymentVariableSetStmt = `INSERT INTO deployment_variable_sets (project_id, deployment_id, kind, set_hash)
VALUES (@p1, @p2, @p3, @p4)`

	// The link row and the set it names, in one round trip. A deployment that
	// was never frozen has no link row, which collectOneRow reports as no row.
	deploymentVariableSetQuery = `SELECT s.project_id, s.content_hash, s.entries
FROM deployment_variable_sets l
JOIN variable_sets s ON s.project_id = l.project_id AND s.content_hash = l.set_hash
WHERE l.project_id = @p1 AND l.deployment_id = @p2`
)

type variableSetStatements struct{ statement }

func newVariableSetStatements(db queryExecutor) variableSetStatements {
	return variableSetStatements{statement: statement{db: db}}
}

// FreezeDeploymentVariables implements [service.VariableSetStatements].
func (s variableSetStatements) FreezeDeploymentVariables(ctx context.Context, projectID, deploymentID string, kind domain.TargetKind) (*domain.VariableSet, error) {
	// Set inside the callback and reset per attempt: ReadWriteTransaction
	// retries an aborted attempt by running the whole callback again, and the
	// retry must not report the set an aborted attempt read.
	var set *domain.VariableSet
	err := withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		set = nil
		// Read on the transaction rather than the client, so the set holds
		// the rows the link lands beside, or nothing lands at all.
		variables, err := readVariables(ctx, tx, domain.VariableOwner{ProjectID: projectID}, kind)
		if err != nil {
			return err
		}
		frozen, err := domain.NewVariableSet(projectID, variables)
		if err != nil {
			return err
		}
		raw, err := variableset.MarshalEntries(frozen.Entries)
		if err != nil {
			return err
		}
		entries, err := encodeNullJSON(raw)
		if err != nil {
			return err
		}
		// The kind is bound as its name, never as the enum, which the Spanner
		// client cannot encode. Causes stay wrapped: an abort has to keep its
		// status for the retry to see.
		if _, err := tx.Update(ctx, buildStatement(insertVariableSetStmt, projectID, frozen.Hash, entries).statement()); err != nil {
			return wrapError(err)
		}
		if _, err := tx.Update(ctx, buildStatement(linkDeploymentVariableSetStmt, projectID, deploymentID, kind.String(), frozen.Hash).statement()); err != nil {
			return wrapError(err)
		}
		set = frozen
		return nil
	})
	if err != nil {
		return nil, err
	}
	return set, nil
}

// GetDeploymentVariables implements [service.VariableSetStatements].
func (s variableSetStatements) GetDeploymentVariables(ctx context.Context, projectID, deploymentID string) (*domain.VariableSet, error) {
	var set *domain.VariableSet
	if err := s.db.Query(ctx, buildStatement(deploymentVariableSetQuery, projectID, deploymentID).statement(), func(iter *spanner.RowIterator) error {
		var err error
		set, err = collectOneRow(iter, scanVariableSet)
		return err
	}); err != nil {
		return nil, returnQueryError(err)
	}
	return set, nil
}

func scanVariableSet(row *spanner.Row) (*domain.VariableSet, error) {
	var (
		scanned variableset.Row
		entries spanner.NullJSON
	)
	if err := row.Columns(&scanned.ProjectID, &scanned.Hash, &entries); err != nil {
		return nil, err
	}
	raw, err := decodeNullJSON(entries)
	if err != nil {
		return nil, err
	}
	scanned.Entries = raw
	return variableset.ToDomain(scanned)
}

var _ service.VariableSetStatements = (*variableSetStatements)(nil)
