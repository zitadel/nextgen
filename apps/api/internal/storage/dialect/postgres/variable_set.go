package postgres

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/variableset"
)

const (
	// DO NOTHING rather than DO UPDATE: a set is immutable and addressed by
	// the hash of its content, so a row that exists already holds exactly
	// these entries, and a deployment whose values did not change writes no
	// row. The conflict named is the only one swallowed; a CHECK or foreign
	// key violation is still reported. (SQLite's INSERT OR IGNORE would
	// swallow a UNIQUE, NOT NULL, CHECK or PRIMARY KEY conflict too, though
	// never a foreign key violation, which is why that dialect uses the same
	// ON CONFLICT form.)
	insertVariableSetStmt = `INSERT INTO zitadel_nextgen.variable_sets (project_id, content_hash, entries)
VALUES ($1, $2, $3)
ON CONFLICT (project_id, content_hash) DO NOTHING`

	// A plain insert: the primary key is what makes a second link of the
	// same deployment a UniqueError. A deployment or a set the project does
	// not hold is a foreign key error.
	linkDeploymentVariableSetStmt = `INSERT INTO zitadel_nextgen.deployment_variable_sets (project_id, deployment_id, set_hash)
VALUES ($1, $2, $3)`

	// The link row and the set it names, in one round trip. A deployment that
	// was never linked has no link row, which QueryRow reports as no row.
	deploymentVariableSetQuery = `SELECT s.project_id, s.content_hash, s.entries
FROM zitadel_nextgen.deployment_variable_sets l
JOIN zitadel_nextgen.variable_sets s ON s.project_id = l.project_id AND s.content_hash = l.set_hash
WHERE l.project_id = $1 AND l.deployment_id = $2`
)

type variableSetStatements struct{ statement }

func newVariableSetStatements(client queryExecutor) variableSetStatements {
	return variableSetStatements{statement: statement{client: client}}
}

// EnsureVariableSet implements [service.VariableSetStatements].
func (s variableSetStatements) EnsureVariableSet(ctx context.Context, set *domain.VariableSet) error {
	entries, err := variableset.MarshalEntries(set.Entries)
	if err != nil {
		return err
	}
	_, err = s.client.Exec(ctx, insertVariableSetStmt, set.ProjectID, set.Hash, entries)
	return wrapError(err)
}

// LinkDeploymentVariableSet implements [service.VariableSetStatements].
func (s variableSetStatements) LinkDeploymentVariableSet(ctx context.Context, projectID, deploymentID, setHash string) error {
	_, err := s.client.Exec(ctx, linkDeploymentVariableSetStmt, projectID, deploymentID, setHash)
	return wrapError(err)
}

// GetDeploymentVariables implements [service.VariableSetStatements].
func (s variableSetStatements) GetDeploymentVariables(ctx context.Context, projectID, deploymentID string) (*domain.VariableSet, error) {
	var row variableset.Row
	if err := s.client.QueryRow(ctx, deploymentVariableSetQuery, projectID, deploymentID).
		Scan(&row.ProjectID, &row.Hash, &row.Entries); err != nil {
		return nil, wrapError(err)
	}
	return variableset.ToDomain(row)
}

var _ service.VariableSetStatements = (*variableSetStatements)(nil)
