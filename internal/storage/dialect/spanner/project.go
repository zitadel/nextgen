package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	storageproject "github.com/zitadel/nextgen/internal/storage/project"
)

const (
	projectsTable         = "projects"
	createProjectStmt     = `INSERT INTO projects (id, name, password_hash_policy) VALUES (@p1, @p2, @p3) THEN RETURN id, created_at, updated_at`
	updateProjectStmt     = `UPDATE projects SET name = @p2, updated_at = CURRENT_TIMESTAMP() WHERE id = @p1 THEN RETURN id, name, password_hash_policy, created_at, updated_at`
	deleteByIDProjectStmt = `DELETE FROM projects WHERE id = @p1`
	projectExistsStmt     = `SELECT EXISTS (SELECT 1 FROM projects WHERE id = @p1)`
	projectQuery          = "SELECT id, name, password_hash_policy, created_at, updated_at FROM projects"

	setProjectPasswordHashPolicyStmt = `UPDATE projects SET password_hash_policy = @p2, updated_at = CURRENT_TIMESTAMP() WHERE id = @p1 THEN RETURN id`
)

var projectColumns = []string{
	"id", "name", "password_hash_policy", "created_at", "updated_at",
}

type projectStatements struct{ statement }

func newProjectStatements(db queryExecutor) projectStatements {
	return projectStatements{
		statement: statement{
			db: db,
		},
	}
}

// CreateProject implements [service.ProjectStatements].
func (ps projectStatements) CreateProject(ctx context.Context, project *domain.Project) error {
	if err := ensureManagedID(&project.ID, domain.PrefixProject); err != nil {
		return err
	}
	policy, err := encodePasswordHashPolicy(project.PasswordHashPolicy)
	if err != nil {
		return wrapError(err)
	}
	origins := domain.NormalizeOrigins(project.Origins)
	return withTransaction(ctx, ps.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createProjectStmt, project.ID, project.Name, policy).statement()
		if err := tx.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
			_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
				return struct{}{}, row.Columns(&project.ID, &project.CreatedAt, &project.UpdatedAt)
			})
			return err
		}); err != nil {
			return err
		}
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
	n, err := ps.db.Update(ctx, buildStatement(deleteByIDProjectStmt, id).statement())
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// ProjectExists implements [service.ProjectStatements].
func (ps projectStatements) ProjectExists(ctx context.Context, id string) (bool, error) {
	var exists bool
	err := ps.db.Query(ctx, buildStatement(projectExistsStmt, id).statement(),
		func(iter *spanner.RowIterator) error {
			var qErr error
			exists, qErr = collectOneRow(iter, func(row *spanner.Row) (bool, error) {
				var found bool
				return found, row.Columns(&found)
			})
			return qErr
		})
	if err != nil {
		return false, wrapError(err)
	}
	return exists, nil
}

// GetProjectByID implements [service.ProjectStatements].
func (ps projectStatements) GetProjectByID(ctx context.Context, id string) (*domain.Project, error) {
	row, err := ps.db.ReadRow(ctx, projectsTable, spanner.Key{id}, projectColumns)
	if err != nil {
		return nil, err
	}
	project, err := ps.scanProject(row)
	if err != nil {
		return nil, err
	}
	if err := ps.hydrateOrigins(ctx, project); err != nil {
		return nil, err
	}
	return project, nil
}

// UpdateProject implements [service.ProjectStatements].
func (ps projectStatements) UpdateProject(ctx context.Context, project *domain.Project) error {
	stmt := buildStatement(updateProjectStmt, project.ID, project.Name).statement()
	if err := ps.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		updated, err := collectOneRow(iter, ps.scanProject)
		if err != nil {
			return err
		}
		*project = *updated
		return nil
	}); err != nil {
		return err
	}
	return ps.hydrateOrigins(ctx, project)
}

// SetProjectPasswordHashPolicy implements [service.ProjectStatements].
func (ps projectStatements) SetProjectPasswordHashPolicy(ctx context.Context, projectID string, policy *domain.PasswordHashPolicy) error {
	encoded, err := encodePasswordHashPolicy(policy)
	if err != nil {
		return wrapError(err)
	}
	stmt := buildStatement(setProjectPasswordHashPolicyStmt, projectID, encoded).statement()
	return ps.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			var id string
			return struct{}{}, row.Columns(&id)
		})
		return err
	})
}

// ListProjects implements [service.ProjectStatements].
func (ps projectStatements) ListProjects(ctx context.Context, filter *database.ListOptions[domain.ProjectField]) (*database.ListResult[*domain.Project], error) {
	projects, nextCursor, err := pagination.Page(filter.Pagination, projectSchema, func(limit uint32) ([]*domain.Project, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		if err := compileRead(&compiler, projectQuery, filter, projectSchema); err != nil {
			return nil, err
		}

		var projects []*domain.Project
		err := ps.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
			var err error
			projects, err = collectRows(iter, ps.scanProject)
			return err
		})
		if err != nil {
			return nil, err
		}

		return projects, nil
	})
	if err != nil {
		return nil, err
	}
	if err := ps.hydrateOrigins(ctx, projects...); err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.Project]{
		Items:      projects,
		NextCursor: nextCursor,
	}, nil
}

func (ps projectStatements) hydrateOrigins(ctx context.Context, projects ...*domain.Project) error {
	if len(projects) == 0 {
		return nil
	}
	ids := make([]string, len(projects))
	for i, p := range projects {
		ids[i] = p.ID
	}
	listed, err := newOriginStatements(ps.db).ListOrigins(ctx, storageproject.ListOriginsOptions(ids))
	if err != nil {
		return err
	}
	storageproject.AssignOrigins(projects, listed.Items)
	return nil
}

func (ps projectStatements) scanProject(row *spanner.Row) (*domain.Project, error) {
	project := new(domain.Project)
	var policyJSON spanner.NullJSON
	if err := row.Columns(&project.ID, &project.Name, &policyJSON, &project.CreatedAt, &project.UpdatedAt); err != nil {
		return nil, err
	}
	policy, err := decodePasswordHashPolicy(policyJSON)
	if err != nil {
		return nil, err
	}
	project.PasswordHashPolicy = policy
	project.Origins = []domain.Origin{}
	return project, nil
}

func encodePasswordHashPolicy(policy *domain.PasswordHashPolicy) (spanner.NullJSON, error) {
	raw, err := storageproject.MarshalPasswordHashPolicy(policy)
	if err != nil {
		return spanner.NullJSON{}, err
	}
	return encodeNullJSON(raw)
}

func decodePasswordHashPolicy(value spanner.NullJSON) (*domain.PasswordHashPolicy, error) {
	raw, err := decodeNullJSON(value)
	if err != nil {
		return nil, err
	}
	return storageproject.UnmarshalPasswordHashPolicy(raw)
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
