package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	storageproject "github.com/zitadel/nextgen/internal/storage/project"
)

const (
	createProjectStmt = `INSERT INTO projects (id, name, password_hash_policy, created_at, updated_at)
VALUES (?, ?, ?, ?, ?) RETURNING id, created_at, updated_at`

	deleteByIDProjectStmt = `DELETE FROM projects WHERE id = ?`

	projectExistsStmt = `SELECT EXISTS (SELECT 1 FROM projects WHERE id = ?)`

	updateProjectStmt = `UPDATE projects SET name = ?, updated_at = ? WHERE id = ?
RETURNING id, name, password_hash_policy, created_at, updated_at`

	setProjectPasswordHashPolicyStmt = `UPDATE projects SET password_hash_policy = ?, updated_at = ? WHERE id = ?
RETURNING id`

	projectQuery = `SELECT id, name, password_hash_policy, created_at, updated_at FROM projects`
)

type projectStatements struct{ statement }

func newProjectStatements(client queryExecutor) projectStatements {
	return projectStatements{statement: statement{client: client}}
}

// CreateProject implements [service.ProjectStatements].
func (ps projectStatements) CreateProject(ctx context.Context, project *domain.Project) error {
	if err := ensureManagedID(&project.ID, domain.PrefixProject); err != nil {
		return err
	}
	policy, err := storageproject.MarshalPasswordHashPolicy(project.PasswordHashPolicy)
	if err != nil {
		return wrapError(err)
	}
	origins := domain.NormalizeOrigins(project.Origins)
	now := nowUnixNano()
	return withTransaction(ctx, ps.client, func(ctx context.Context, tx queryExecutor) error {
		var createdNano, updatedNano int64
		if err := tx.QueryRow(ctx, createProjectStmt,
			project.ID, project.Name, nullBytesArg(policy), now, now,
		).Scan(&project.ID, &createdNano, &updatedNano); err != nil {
			return wrapError(err)
		}
		project.CreatedAt = timeFromUnixNano(createdNano)
		project.UpdatedAt = timeFromUnixNano(updatedNano)
		rsi := newResourceScopeStatements(tx)
		if err := rsi.UpsertResourceScope(ctx, domain.NewProjectResourceScope(project.ID)); err != nil {
			return err
		}
		originsStmts := newOriginStatements(tx)
		for _, origin := range origins {
			if _, err := originsStmts.InsertOrigin(ctx, project.ID, origin); err != nil {
				return err
			}
		}
		project.Origins = origins
		return nil
	})
}

// DeleteProjectByID implements [service.ProjectStatements].
func (ps projectStatements) DeleteProjectByID(ctx context.Context, id string) (bool, error) {
	res, err := ps.client.Exec(ctx, deleteByIDProjectStmt, id)
	if err != nil {
		return false, wrapError(err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, wrapError(err)
	}
	return n > 0, nil
}

// ProjectExists implements [service.ProjectStatements].
func (ps projectStatements) ProjectExists(ctx context.Context, id string) (bool, error) {
	var exists bool
	if err := ps.client.QueryRow(ctx, projectExistsStmt, id).Scan(&exists); err != nil {
		return false, wrapError(err)
	}
	return exists, nil
}

// GetProjectByID implements [service.ProjectStatements].
func (ps projectStatements) GetProjectByID(ctx context.Context, id string) (*domain.Project, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, projectQuery, &database.ListOptions[domain.ProjectField]{
		Filter: database.Equal(database.Col(domain.ProjectFieldID), id),
	}, projectSchema); err != nil {
		return nil, err
	}
	rows, err := ps.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	project, err := collectExactlyOneRow(rows, scanProject)
	if err != nil {
		return nil, wrapError(err)
	}
	if err := ps.hydrateOrigins(ctx, project); err != nil {
		return nil, err
	}
	return project, nil
}

// UpdateProject implements [service.ProjectStatements].
func (ps projectStatements) UpdateProject(ctx context.Context, project *domain.Project) error {
	now := nowUnixNano()
	row := ps.client.QueryRow(ctx, updateProjectStmt, project.Name, now, project.ID)
	if err := wrapError(ps.scanProjectRow(row, project)); err != nil {
		return err
	}
	return ps.hydrateOrigins(ctx, project)
}

// SetProjectPasswordHashPolicy implements [service.ProjectStatements].
func (ps projectStatements) SetProjectPasswordHashPolicy(ctx context.Context, projectID string, policy *domain.PasswordHashPolicy) error {
	encoded, err := storageproject.MarshalPasswordHashPolicy(policy)
	if err != nil {
		return wrapError(err)
	}
	var id string
	return wrapError(ps.client.QueryRow(ctx, setProjectPasswordHashPolicyStmt, nullBytesArg(encoded), nowUnixNano(), projectID).Scan(&id))
}

func (ps projectStatements) scanProjectRow(row *sql.Row, project *domain.Project) error {
	var (
		policyStr            sql.NullString
		createdNano, updNano int64
	)
	if err := row.Scan(&project.ID, &project.Name, &policyStr, &createdNano, &updNano); err != nil {
		return err
	}
	policy, err := storageproject.UnmarshalPasswordHashPolicy([]byte(policyStr.String))
	if err != nil {
		return err
	}
	project.PasswordHashPolicy = policy
	project.Origins = []domain.Origin{}
	project.CreatedAt = timeFromUnixNano(createdNano)
	project.UpdatedAt = timeFromUnixNano(updNano)
	return nil
}

// ListProjects implements [service.ProjectStatements].
func (ps projectStatements) ListProjects(ctx context.Context, filter *database.ListOptions[domain.ProjectField]) (*database.ListResult[*domain.Project], error) {
	projects, nextCursor, err := pagination.Page(filter.Pagination, projectSchema, func(limit uint32) ([]*domain.Project, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		if err := compileRead(&compiler, projectQuery, filter, projectSchema); err != nil {
			return nil, err
		}
		rows, err := ps.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		defer rows.Close()
		projects, err := collectRows(rows, scanProject)
		if err != nil {
			return nil, wrapError(err)
		}
		return projects, nil
	})
	if err != nil {
		return nil, err
	}
	if err := ps.hydrateOrigins(ctx, projects...); err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.Project]{Items: projects, NextCursor: nextCursor}, nil
}

func (ps projectStatements) hydrateOrigins(ctx context.Context, projects ...*domain.Project) error {
	if len(projects) == 0 {
		return nil
	}
	ids := make([]string, len(projects))
	for i, p := range projects {
		ids[i] = p.ID
	}
	listed, err := newOriginStatements(ps.client).ListOrigins(ctx, storageproject.ListOriginsOptions(ids))
	if err != nil {
		return err
	}
	storageproject.AssignOrigins(projects, listed.Items)
	return nil
}

func scanProject(rows *sql.Rows) (*domain.Project, error) {
	project := new(domain.Project)
	var (
		policyStr            sql.NullString
		createdNano, updNano int64
	)
	if err := rows.Scan(&project.ID, &project.Name, &policyStr, &createdNano, &updNano); err != nil {
		return nil, err
	}
	policy, err := storageproject.UnmarshalPasswordHashPolicy([]byte(policyStr.String))
	if err != nil {
		return nil, fmt.Errorf("decode password_hash_policy: %w", err)
	}
	project.PasswordHashPolicy = policy
	project.Origins = []domain.Origin{}
	project.CreatedAt = timeFromUnixNano(createdNano)
	project.UpdatedAt = timeFromUnixNano(updNano)
	return project, nil
}

var _ service.ProjectStatements = (*projectStatements)(nil)

var projectSchema = database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
	domain.ProjectFieldID: {
		SQLName:  "id",
		Accessor: func(p *domain.Project) any { return p.ID },
		Coerce:   database.CoerceString,
	},
	domain.ProjectFieldName: {
		SQLName:  "name",
		Accessor: func(p *domain.Project) any { return p.Name },
		Coerce:   database.CoerceString,
	},
	domain.ProjectFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(p *domain.Project) any { return p.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.ProjectFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(p *domain.Project) any { return p.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
})
