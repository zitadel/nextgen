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

type BrandingRepository struct {
	table         string
	now           database.Instruction
	encodePayload func([]byte) any

	columnProjectID  database.Column
	columnID         database.Column
	columnCreatedAt  database.Column
	columnDefinition database.Column
}

func NewBrandingRepository(client database.QueryExecutor) *BrandingRepository {
	const pgTable = "zitadel_nextgen.branding"
	const spannerTable = "branding"

	switch client.(type) {
	case spanner.SpannerPooler:
		return newBrandingRepository(spannerTable, database.CurrentTimestampInstruction, func(b []byte) any { return string(b) })
	case postgres.PostgresPooler:
		return newBrandingRepository(pgTable, database.NowInstruction, func(b []byte) any { return b })
	}
	panic("NewBrandingRepository: unsupported client type")
}

func newBrandingRepository(table string, now database.Instruction, encodePayload func([]byte) any) *BrandingRepository {
	return &BrandingRepository{
		table:            table,
		now:              now,
		encodePayload:    encodePayload,
		columnProjectID:  database.NewColumn(table, "project_id"),
		columnID:         database.NewColumn(table, "id"),
		columnCreatedAt:  database.NewColumn(table, "created_at"),
		columnDefinition: database.NewColumn(table, "definition"),
	}
}

func (r *BrandingRepository) qualifiedTableName() string {
	return r.table
}

func (r *BrandingRepository) PrimaryKeyColumns() []database.Column {
	return []database.Column{r.ProjectID(), r.ID()}
}

func (r *BrandingRepository) ProjectID() database.Column {
	return r.columnProjectID
}

func (r *BrandingRepository) ID() database.Column {
	return r.columnID
}

func (r *BrandingRepository) CreatedAt() database.Column {
	return r.columnCreatedAt
}

func (r *BrandingRepository) Definition() database.Column {
	return r.columnDefinition
}

func (r *BrandingRepository) PrimaryKeyCondition(projectID, id string) database.Condition {
	return database.And(
		r.ProjectIDCondition(projectID),
		database.NewTextCondition(r.ID(), database.TextOperationEqual, id),
	)
}

func (r *BrandingRepository) ProjectIDCondition(projectID string) database.Condition {
	return database.NewTextCondition(r.ProjectID(), database.TextOperationEqual, projectID)
}

func (r *BrandingRepository) Create(ctx context.Context, client database.QueryExecutor, branding *domain.Branding) error {
	definition, err := marshalBrandingDefinition(branding)
	if err != nil {
		return err
	}
	builder := database.NewStatementBuilder("INSERT INTO ")
	builder.WriteString(r.qualifiedTableName())
	builder.WriteString(" (")
	database.Columns{
		r.ProjectID(),
		r.ID(),
		r.Definition(),
		r.CreatedAt(),
	}.WriteUnqualified(builder)
	builder.WriteString(") VALUES (")
	builder.WriteArgs(
		branding.ProjectID,
		branding.ID,
		r.encodePayload(definition),
		r.now,
	)
	builder.WriteString(")")
	_, err = client.Exec(ctx, builder.String(), builder.Args()...)
	return err
}

func (r *BrandingRepository) GetByID(ctx context.Context, client database.QueryExecutor, projectID, id string) (*domain.Branding, error) {
	return r.get(ctx, client, database.WithCondition(r.PrimaryKeyCondition(projectID, id)))
}

func (r *BrandingRepository) GetLatest(ctx context.Context, client database.QueryExecutor, projectID string) (*domain.Branding, error) {
	// id (a ULID, time-ordered) breaks created_at ties deterministically —
	// e.g. revisions published within one transaction share NOW().
	return r.get(ctx, client,
		database.WithCondition(r.ProjectIDCondition(projectID)),
		database.WithOrderByDescending(r.CreatedAt(), r.ID()),
		database.WithLimit(1),
	)
}

func (r *BrandingRepository) get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*domain.Branding, error) {
	builder := r.selectBuilder(opts...)
	row, err := getOne[brandingRow](ctx, client, builder)
	if err != nil {
		return nil, err
	}
	return row.toDomain()
}

func (r *BrandingRepository) List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*domain.Branding, error) {
	builder := r.selectBuilder(opts...)
	rows, err := getMany[brandingRow](ctx, client, builder)
	if err != nil {
		return nil, err
	}
	brandings := make([]*domain.Branding, 0, len(rows))
	for _, row := range rows {
		b, err := row.toDomain()
		if err != nil {
			return nil, err
		}
		brandings = append(brandings, b)
	}
	return brandings, nil
}

func (r *BrandingRepository) selectBuilder(opts ...database.QueryOption) *database.StatementBuilder {
	builder := database.NewStatementBuilder("SELECT ")
	database.Columns{
		r.ProjectID(),
		r.ID(),
		r.CreatedAt(),
		r.Definition(),
	}.WriteQualified(builder)
	builder.WriteString(" FROM ")
	builder.WriteString(r.qualifiedTableName())
	queryOpts := new(database.QueryOpts)
	for _, opt := range opts {
		opt(queryOpts)
	}
	queryOpts.Write(builder)
	return builder
}

// brandingDefinition is the JSON payload stored in the definition column. It
// carries the branding content so future structured extensions (palette,
// typography, theme) need no migration.
type brandingDefinition struct {
	Layout         string `json:"layout"`
	LiquidTemplate string `json:"liquid_template,omitempty"`
	LogoURL        string `json:"logo_url,omitempty"`
	FontURL        string `json:"font_url,omitempty"`
	HeroURL        string `json:"hero_url,omitempty"`
}

func marshalBrandingDefinition(b *domain.Branding) ([]byte, error) {
	return json.Marshal(brandingDefinition{
		Layout:         b.Layout,
		LiquidTemplate: b.LiquidTemplate,
		LogoURL:        b.LogoURL,
		FontURL:        b.FontURL,
		HeroURL:        b.HeroURL,
	})
}

type brandingRow struct {
	ProjectID  string                   `db:"project_id"`
	ID         string                   `db:"id"`
	CreatedAt  time.Time                `db:"created_at"`
	Definition JSON[brandingDefinition] `db:"definition"`
}

func (r *brandingRow) toDomain() (*domain.Branding, error) {
	return &domain.Branding{
		ProjectID:      r.ProjectID,
		ID:             r.ID,
		Layout:         r.Definition.Value.Layout,
		LiquidTemplate: r.Definition.Value.LiquidTemplate,
		LogoURL:        r.Definition.Value.LogoURL,
		FontURL:        r.Definition.Value.FontURL,
		HeroURL:        r.Definition.Value.HeroURL,
		CreatedAt:      r.CreatedAt,
	}, nil
}

var _ domain.BrandingRepository = (*BrandingRepository)(nil)
