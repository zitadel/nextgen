package sqlite

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
	// row. The conflict named is the only one swallowed; a CHECK violation
	// is still reported, which is what INSERT OR IGNORE would not do -- it
	// swallows every UNIQUE, NOT NULL, CHECK and PRIMARY KEY conflict the
	// row raises. (A foreign key violation is reported either way: SQLite's
	// conflict resolution never applies to FOREIGN KEY constraints.)
	insertVariableSetStmt = `INSERT INTO variable_sets (project_id, content_hash, entries, created_at)
VALUES (?, ?, ?, ?)
ON CONFLICT (project_id, content_hash) DO NOTHING`

	// A plain insert: the primary key is what makes a second freeze of the
	// same deployment a UniqueError. The deployment key is a safety net only;
	// a deployment the project does not hold is already a NoRowFoundError
	// from the kind read above.
	linkDeploymentVariableSetStmt = `INSERT INTO deployment_variable_sets (project_id, deployment_id, set_hash)
VALUES (?, ?, ?)`

	// Which rows to freeze is the deployment's own kind, read on the freeze's
	// transaction; a deployment the project does not hold is no row.
	deploymentOriginKindQuery = `SELECT origin_kind FROM deployments WHERE project_id = ? AND id = ?`

	// The link row and the set it names, in one round trip. A deployment that
	// was never frozen has no link row, which QueryRow reports as no row.
	deploymentVariableSetQuery = `SELECT s.project_id, s.content_hash, s.entries
FROM deployment_variable_sets l
JOIN variable_sets s ON s.project_id = l.project_id AND s.content_hash = l.set_hash
WHERE l.project_id = ? AND l.deployment_id = ?`
)

type variableSetStatements struct{ statement }

func newVariableSetStatements(client queryExecutor) variableSetStatements {
	return variableSetStatements{statement: statement{client: client}}
}

// FreezeDeploymentVariables implements [service.VariableSetStatements].
func (s variableSetStatements) FreezeDeploymentVariables(ctx context.Context, projectID, deploymentID string) (*domain.VariableSet, error) {
	// Stamped in Go, as everywhere else in this dialect. Only the first freeze
	// of a set keeps it: a later one finds the row and inserts nothing.
	now := nowUnixNano()
	// Set inside the callback and reset per attempt. SQLite never replays
	// the callback, but the Spanner dialect does, and the three dialects
	// keep the same shape so a reader of one knows the others.
	var set *domain.VariableSet
	err := withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		set = nil
		// Read on the transaction rather than the client, so the set holds
		// the rows the link lands beside, or nothing lands at all. The pool
		// also has one connection, and the transaction holds it.
		kind, err := readDeploymentOriginKind(ctx, tx, projectID, deploymentID)
		if err != nil {
			return err
		}
		variables, err := readVariables(ctx, tx, domain.VariableOwner{ProjectID: projectID}, kind)
		if err != nil {
			return err
		}
		frozen, err := domain.NewVariableSet(projectID, variables)
		if err != nil {
			return err
		}
		entries, err := variableset.MarshalEntries(frozen.Entries)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, insertVariableSetStmt, projectID, frozen.Hash, string(entries), now); err != nil {
			return wrapError(err)
		}
		if _, err := tx.Exec(ctx, linkDeploymentVariableSetStmt, projectID, deploymentID, frozen.Hash); err != nil {
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

// EnsureVariableSet implements [service.VariableSetStatements].
func (s variableSetStatements) EnsureVariableSet(ctx context.Context, set *domain.VariableSet) error {
	entries, err := variableset.MarshalEntries(set.Entries)
	if err != nil {
		return err
	}
	_, err = s.client.Exec(ctx, insertVariableSetStmt, set.ProjectID, set.Hash, string(entries), nowUnixNano())
	return wrapError(err)
}

// LinkDeploymentVariableSet implements [service.VariableSetStatements].
func (s variableSetStatements) LinkDeploymentVariableSet(ctx context.Context, projectID, deploymentID, setHash string) error {
	_, err := s.client.Exec(ctx, linkDeploymentVariableSetStmt, projectID, deploymentID, setHash)
	return wrapError(err)
}

// readDeploymentOriginKind returns the kind of target deploymentID went to,
// which is the kind of variables it freezes. The column holds the kind's
// name under a CHECK, so a name the enum does not know is a broken row.
func readDeploymentOriginKind(ctx context.Context, client queryExecutor, projectID, deploymentID string) (domain.DeploymentOriginKind, error) {
	var name string
	if err := client.QueryRow(ctx, deploymentOriginKindQuery, projectID, deploymentID).Scan(&name); err != nil {
		return 0, wrapError(err)
	}
	return domain.DeploymentOriginKindString(name)
}

// GetDeploymentVariables implements [service.VariableSetStatements].
func (s variableSetStatements) GetDeploymentVariables(ctx context.Context, projectID, deploymentID string) (*domain.VariableSet, error) {
	var (
		row     variableset.Row
		entries string
	)
	if err := s.client.QueryRow(ctx, deploymentVariableSetQuery, projectID, deploymentID).
		Scan(&row.ProjectID, &row.Hash, &entries); err != nil {
		return nil, wrapError(err)
	}
	row.Entries = []byte(entries)
	return variableset.ToDomain(row)
}

var _ service.VariableSetStatements = (*variableSetStatements)(nil)
