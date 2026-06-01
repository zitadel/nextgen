package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

const pgTableProjects = "zitadel_nextgen.projects"
const spannerTableProjects = "projects"

type projectRow struct {
	ID             string            `db:"id"`
	CreatedAt      time.Time         `db:"created_at"`
	UpdatedAt      time.Time         `db:"updated_at"`
	ProjectSecret  string            `db:"project_secret"`
	PreviewSecret  string            `db:"preview_secret"`
	PreviewOrigins JSONArray[string] `db:"preview_origins"`
	Lifecycle      string            `db:"lifecycle"`
	TeamID         *string           `db:"team_id"`
	Tier           *string           `db:"tier"`
	ClaimedAt      *time.Time        `db:"claimed_at"`
}

type projectMeta struct{ tableName string }

func (m projectMeta) PrimaryKeyColumns() []database.Column {
	return []database.Column{database.NewColumn(m.tableName, "id")}
}

func (m projectMeta) UpdatedAtColumn() database.Column {
	return database.NewColumn(m.tableName, "updated_at")
}

func (m projectMeta) IDColumn() database.Column {
	return database.NewColumn(m.tableName, "id")
}

func (m projectMeta) qualifiedTableName() string { return m.tableName }

var _ updatable = (*projectMeta)(nil)
var _ deletable = (*projectMeta)(nil)

// ProjectRepository implements [domain.ProjectRepository].
type ProjectRepository struct {
	meta projectMeta
	now  database.Instruction
}

var _ domain.ProjectRepository = (*ProjectRepository)(nil)

// NewProjectRepository returns a dialect-specific [ProjectRepository].
func NewProjectRepository(client database.QueryExecutor) *ProjectRepository {
	switch client.(type) {
	case spanner.SpannerPooler:
		return &ProjectRepository{
			meta: projectMeta{tableName: spannerTableProjects},
			now:  database.CurrentTimestampInstruction,
		}
	case postgres.PostgresPooler:
		return &ProjectRepository{
			meta: projectMeta{tableName: pgTableProjects},
			now:  database.NowInstruction,
		}
	}
	panic("NewProjectRepository: unsupported client type")
}

func (r *ProjectRepository) Create(ctx context.Context, client database.QueryExecutor, project *domain.Project) error {
	origins := project.PreviewOrigins
	if origins == nil {
		origins = []string{}
	}
	originsJSON, err := json.Marshal(origins)
	if err != nil {
		return err
	}
	b := database.NewStatementBuilder("INSERT INTO ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" (id, created_at, updated_at, project_secret, preview_secret, preview_origins, lifecycle) VALUES (")
	b.WriteArg(project.ID)
	b.WriteString(", ")
	b.WriteArg(r.now)
	b.WriteString(", ")
	b.WriteArg(r.now)
	b.WriteString(", ")
	b.WriteArg(project.ProjectSecret)
	b.WriteString(", ")
	b.WriteArg(project.PreviewSecret)
	b.WriteString(", ")
	b.WriteArg(string(originsJSON))
	b.WriteString(", ")
	b.WriteArg(string(project.Lifecycle))
	b.WriteString(")")
	_, err = client.Exec(ctx, b.String(), b.Args()...)
	return err
}

func (r *ProjectRepository) Get(ctx context.Context, client database.QueryExecutor, id string) (*domain.Project, error) {
	b := database.NewStatementBuilder("SELECT id, created_at, updated_at, project_secret, preview_secret, preview_origins, lifecycle, team_id, tier, claimed_at FROM ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" WHERE id = ")
	b.WriteArg(id)
	row, err := getOne[projectRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	return projectFromRow(row), nil
}

func (r *ProjectRepository) GetBySecret(ctx context.Context, client database.QueryExecutor, secret string) (*domain.Project, error) {
	b := database.NewStatementBuilder("SELECT id, created_at, updated_at, project_secret, preview_secret, preview_origins, lifecycle, team_id, tier, claimed_at FROM ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" WHERE project_secret = ")
	b.WriteArg(secret)
	b.WriteString(" OR preview_secret = ")
	b.WriteArg(secret)
	row, err := getOne[projectRow](ctx, client, b)
	if err != nil {
		return nil, err
	}
	return projectFromRow(row), nil
}

func projectFromRow(row *projectRow) *domain.Project {
	lifecycle := domain.ProjectLifecycle(row.Lifecycle)
	if lifecycle == "" {
		lifecycle = domain.ProjectLifecycleUnclaimed
	}
	project := &domain.Project{
		ID:             row.ID,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
		ProjectSecret:  row.ProjectSecret,
		PreviewSecret:  row.PreviewSecret,
		PreviewOrigins: []string(row.PreviewOrigins),
		Lifecycle:      lifecycle,
		ClaimedAt:      row.ClaimedAt,
	}
	if row.TeamID != nil {
		project.TeamID = *row.TeamID
	}
	if row.Tier != nil {
		project.Tier = domain.ProjectTier(*row.Tier)
	}
	return project
}

func (r *ProjectRepository) Update(ctx context.Context, client database.QueryExecutor, project *domain.Project) error {
	var teamID *string
	if project.TeamID != "" {
		teamID = &project.TeamID
	}
	var tier *string
	if project.Tier != "" {
		t := string(project.Tier)
		tier = &t
	}
	condition := database.NewTextCondition(r.meta.IDColumn(), database.TextOperationEqual, project.ID)
	_, err := updateOne(ctx, client, r.meta, condition,
		database.NewChange(database.NewColumn(r.meta.tableName, "project_secret"), project.ProjectSecret),
		database.NewChange(database.NewColumn(r.meta.tableName, "lifecycle"), string(project.Lifecycle)),
		database.NewChangePtr(database.NewColumn(r.meta.tableName, "team_id"), teamID),
		database.NewChangePtr(database.NewColumn(r.meta.tableName, "tier"), tier),
		database.NewChangePtr(database.NewColumn(r.meta.tableName, "claimed_at"), project.ClaimedAt),
		database.NewChange(r.meta.UpdatedAtColumn(), r.now),
	)
	return err
}
