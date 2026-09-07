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
	createProjectStmt = `INSERT INTO projects (id, name, preview_origins, password_hash_policy, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?) RETURNING id, created_at, updated_at`

	deleteByIDProjectStmt = `DELETE FROM projects WHERE id = ?`

	updateProjectStmt = `UPDATE projects SET name = ?, updated_at = ? WHERE id = ?
RETURNING id, name, preview_origins, password_hash_policy, created_at, updated_at`

	setProjectPasswordHashPolicyStmt = `UPDATE projects SET password_hash_policy = ?, updated_at = ? WHERE id = ?
RETURNING id`

	projectQuery = `SELECT id, name, preview_origins, password_hash_policy, created_at, updated_at FROM projects`
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
	origins, err := encodeJSON(project.PreviewOrigins)
	if err != nil {
		return wrapError(err)
	}
	policy, err := storageproject.MarshalPasswordHashPolicy(project.PasswordHashPolicy)
	if err != nil {
		return wrapError(err)
	}
	now := nowUnixNano()
	return withTransaction(ctx, ps.client, func(ctx context.Context, tx queryExecutor) error {
		var createdNano, updatedNano int64
		if err := tx.QueryRow(ctx, createProjectStmt,
			project.ID, project.Name, origins, nullBytesArg(policy), now, now,
		).Scan(&project.ID, &createdNano, &updatedNano); err != nil {
			return wrapError(err)
		}
		project.CreatedAt = timeFromUnixNano(createdNano)
		project.UpdatedAt = timeFromUnixNano(updatedNano)
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewProjectResourceScope(project.ID))
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
	return project, nil
}

// UpdateProject implements [service.ProjectStatements].
func (ps projectStatements) UpdateProject(ctx context.Context, project *domain.Project) error {
	now := nowUnixNano()
	row := ps.client.QueryRow(ctx, updateProjectStmt, project.Name, now, project.ID)
	return wrapError(ps.scanProjectRow(row, project))
}

// SetProjectPasswordHashPolicy implements [service.ProjectStatements].
// A nil policy writes NULL, which hands the project back to the deployment
// default.
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
		originsStr           string
		policyStr            sql.NullString
		createdNano, updNano int64
	)
	if err := row.Scan(&project.ID, &project.Name, &originsStr, &policyStr, &createdNano, &updNano); err != nil {
		return err
	}
	origins, err := decodeJSONStrings(originsStr)
	if err != nil {
		return err
	}
	policy, err := storageproject.UnmarshalPasswordHashPolicy([]byte(policyStr.String))
	if err != nil {
		return err
	}
	project.PreviewOrigins = origins
	project.PasswordHashPolicy = policy
	project.CreatedAt = timeFromUnixNano(createdNano)
	project.UpdatedAt = timeFromUnixNano(updNano)
	return nil
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
	defer rows.Close()
	projects, err := collectRows(rows, scanProject)
	if err != nil {
		return nil, wrapError(err)
	}
	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		projects,
		projectSchema,
		filter.Pagination.Limit,
	)
	return &database.ListResult[*domain.Project]{Items: projects, NextCursor: nextCursor}, nil
}

func scanProject(rows *sql.Rows) (*domain.Project, error) {
	project := new(domain.Project)
	var (
		originsStr           string
		policyStr            sql.NullString
		createdNano, updNano int64
	)
	if err := rows.Scan(&project.ID, &project.Name, &originsStr, &policyStr, &createdNano, &updNano); err != nil {
		return nil, err
	}
	origins, err := decodeJSONStrings(originsStr)
	if err != nil {
		return nil, fmt.Errorf("decode preview_origins: %w", err)
	}
	policy, err := storageproject.UnmarshalPasswordHashPolicy([]byte(policyStr.String))
	if err != nil {
		return nil, fmt.Errorf("decode password_hash_policy: %w", err)
	}
	project.PreviewOrigins = origins
	project.PasswordHashPolicy = policy
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
	domain.ProjectFieldPreviewOrigins: {
		SQLName:  "preview_origins",
		Accessor: func(p *domain.Project) any { return p.PreviewOrigins },
		Coerce:   database.CoerceSliceAsAny(database.CoerceStringValue),
	},
})
