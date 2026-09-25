package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	storageproject "github.com/zitadel/nextgen/internal/storage/project"
)

const createProjectStmt = `INSERT INTO zitadel_nextgen.projects (id, name, preview_origins, password_hash_policy) VALUES ($1, $2, $3, $4) RETURNING id, created_at, updated_at`

type projectStatements struct{ statement }

func newProjectStatements(client queryExecutor) projectStatements {
	return projectStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateProject implements [service.ProjectStatements].
func (ps projectStatements) CreateProject(ctx context.Context, project *domain.Project) error {
	if err := ensureManagedID(&project.ID, domain.PrefixProject); err != nil {
		return err
	}
	origins := project.PreviewOrigins
	if origins == nil {
		origins = []string{}
	}
	policy, err := storageproject.MarshalPasswordHashPolicy(project.PasswordHashPolicy)
	if err != nil {
		return err
	}
	return withTransaction(ctx, ps.client, func(ctx context.Context, tx queryExecutor) error {
		if err := wrapError(tx.QueryRow(ctx, createProjectStmt, project.ID, project.Name, origins, policy).
			Scan(&project.ID, &project.CreatedAt, &project.UpdatedAt)); err != nil {
			return err
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewProjectResourceScope(project.ID))
	})
}

const deleteByIDProjectStmt = `DELETE FROM zitadel_nextgen.projects WHERE id = $1`

// DeleteProjectByID implements [service.ProjectStatements].
// resource_scope_index rows for this project cascade via the project_id FK.
func (ps projectStatements) DeleteProjectByID(ctx context.Context, id string) (bool, error) {
	tag, err := ps.client.Exec(ctx, deleteByIDProjectStmt, id)
	if err != nil {
		return false, wrapError(err)
	}
	return tag.RowsAffected() > 0, nil
}

const projectQuery = "SELECT id, name, preview_origins, password_hash_policy, created_at, updated_at FROM zitadel_nextgen.projects"

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
	project, err := pgx.CollectExactlyOneRow(rows, ps.scanProject)
	if err != nil {
		return nil, wrapError(err)
	}
	return project, nil
}

const updateProjectStmt = `UPDATE zitadel_nextgen.projects SET name = $2, updated_at = now() WHERE id = $1 RETURNING id, name, preview_origins, password_hash_policy, created_at, updated_at`

const setProjectPasswordHashPolicyStmt = `UPDATE zitadel_nextgen.projects SET password_hash_policy = $2, updated_at = now() WHERE id = $1 RETURNING updated_at`

// UpdateProject implements [service.ProjectStatements].
// Only the name is updated; preview origins are left untouched. The whole row is
// read back onto the project.
func (ps projectStatements) UpdateProject(ctx context.Context, project *domain.Project) error {
	var policy []byte
	if err := wrapError(ps.client.QueryRow(ctx, updateProjectStmt, project.ID, project.Name).
		Scan(&project.ID, &project.Name, &project.PreviewOrigins, &policy, &project.CreatedAt, &project.UpdatedAt)); err != nil {
		return err
	}
	decoded, err := storageproject.UnmarshalPasswordHashPolicy(policy)
	if err != nil {
		return err
	}
	project.PasswordHashPolicy = decoded
	return nil
}

// SetProjectPasswordHashPolicy implements [service.ProjectStatements].
// A nil policy writes NULL, which hands the project back to the deployment
// default.
func (ps projectStatements) SetProjectPasswordHashPolicy(ctx context.Context, projectID string, policy *domain.PasswordHashPolicy) error {
	encoded, err := storageproject.MarshalPasswordHashPolicy(policy)
	if err != nil {
		return err
	}
	var updatedAt time.Time
	return wrapError(ps.client.QueryRow(ctx, setProjectPasswordHashPolicyStmt, projectID, encoded).Scan(&updatedAt))
}

// ListProjects implements [service.ProjectStatements].
func (ps projectStatements) ListProjects(ctx context.Context, filter *database.ListOptions[domain.ProjectField]) (*database.ListResult[*domain.Project], error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, projectQuery, filter, projectSchema); err != nil {
		return nil, err
	}

	rows, err := ps.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}

	projects, err := pgx.CollectRows(rows, ps.scanProject)
	if err != nil {
		return nil, wrapError(err)
	}

	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		projects,
		projectSchema,
		filter.Pagination.Limit,
	)

	return &database.ListResult[*domain.Project]{
		Items:      projects,
		NextCursor: nextCursor,
	}, nil
}

func (ps projectStatements) scanProject(row pgx.CollectableRow) (*domain.Project, error) {
	project := new(domain.Project)
	var policy []byte
	if err := row.Scan(&project.ID, &project.Name, &project.PreviewOrigins, &policy, &project.CreatedAt, &project.UpdatedAt); err != nil {
		return nil, err
	}
	decoded, err := storageproject.UnmarshalPasswordHashPolicy(policy)
	if err != nil {
		return nil, err
	}
	project.PasswordHashPolicy = decoded
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
	domain.ProjectFieldPreviewOrigins: {
		SQLName:  "preview_origins",
		Accessor: func(p *domain.Project) any { return p.PreviewOrigins },
		Coerce:   database.CoerceSliceAsAny(database.CoerceStringValue),
	},
})
