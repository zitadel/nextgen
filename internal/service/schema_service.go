package service

import (
	"context"
	"errors"
	"net/url"
	"strings"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Input types -------------------------------------------------------------

type CreateSchemaInput struct {
	ProjectID string
	TeamID    string
	Schema    []byte
}

type CreateSchemaByURLInput struct {
	ProjectID string
	TeamID    string
	URL       url.URL
}

type ListSchemasInput struct {
	ProjectID string
	// IDs narrows the list to the given schema ids. Empty means no id filter.
	// Not exposed on the wire: it serves in-process batch resolution, such as
	// the flow-definition expand hydrator.
	IDs        []string
	ObjectType string
	// Kind is nil when the caller did not filter by one. It is a pointer rather
	// than a zero value because JSONSchemaKindUnknown is a real stored kind, so
	// it cannot double as "no filter".
	Kind *domain.JSONSchemaKind
	// LatestRevisionPerObjectType asks for the newest revision of each object
	// type instead of the full revision history.
	LatestRevisionPerObjectType bool
	PageToken                   string
	Limit                       int
}

type ListSchemasOutput struct {
	Items         []*domain.JSONSchema
	NextPageToken string
}

// ---- Secondary ports -------------------------------------------------------------

type SchemaService struct {
	v2Pool          *DB
	schemaResolver  *domain.JSONSchemaResolver
	schemaValidator *domain.SchemaValidator
}

func NewSchemaService(
	v2Pool *DB,
	schemaResolver *domain.JSONSchemaResolver,
	schemaValidator *domain.SchemaValidator,
) *SchemaService {
	return &SchemaService{
		v2Pool:          v2Pool,
		schemaResolver:  schemaResolver,
		schemaValidator: schemaValidator,
	}
}

func (s *SchemaService) CreateSchema(ctx context.Context, input CreateSchemaInput) (_ *domain.JSONSchema, err error) {
	model, err := domain.NewJSONSchema(input.ProjectID, input.Schema)
	if err != nil {
		return nil, err
	}

	err = s.schemaValidator.ValidateAgainstMetaSchema(input.Schema)
	if err != nil {
		return nil, domain.ErrJSONSchemaInvalid().WithParent(err)
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		if err := stmts.CreateJSONSchema(ctx, model); err != nil {
			if _, ok := errors.AsType[*database.IntegrityViolationError](err); ok {
				// Which of the two unique constraints fired is settled after the
				// transaction ends, by classifyCreateConflict.
				return err
			}
			return domain.ErrInternal(err).WithMessage("failed to create schema in database")
		}

		// Pass the just-created payload so Resolve does not re-load (or HTTP-refetch
		// and re-insert) the same URL inside this transaction — Spanner can surface
		// the duplicate as a commit-time AlreadyExists otherwise.
		_, err := s.schemaResolver.Resolve(ctx, stmts, input.ProjectID, model.URL, model.Schema)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to resolve schema when creating")
		}
		return audit.Emit(ctx, stmts, audit.EmitSpec{
			Type:       domain.EventTypeSchemaCreated,
			Category:   domain.EventCategoryAdmin,
			ProjectID:  model.ProjectID,
			EntityType: "json_schema",
			EntityID:   model.URL,
			Payload:    domain.SchemaCreatedPayloadSnapshot(model),
		})
	})
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		if _, ok := errors.AsType[*database.IntegrityViolationError](err); ok {
			return nil, s.classifyCreateConflict(ctx, input.ProjectID, model.URL, err)
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}

	return model, nil
}

// classifyCreateConflict tells the two unique constraints on json_schemas apart.
// Only Postgres reports which one a violation came from, so the URL is read back
// instead: a row under it means the `$id` was taken, and its absence means the
// insert lost the (object_type, created_at) race. An inconclusive read keeps the
// broader of the two answers.
func (s *SchemaService) classifyCreateConflict(ctx context.Context, projectID, schemaURL string, cause error) error {
	_, err := s.v2Pool.Statements().GetJSONSchemaByID(ctx, projectID, schemaURL)
	if _, missing := errors.AsType[*database.NoRowFoundError](err); missing {
		return domain.ErrJSONSchemaRevisionConflict().WithParent(cause)
	}
	return domain.ErrJSONSchemaAlreadyExists().WithParent(cause)
}

func (s *SchemaService) CreateSchemaByUrl(ctx context.Context, input CreateSchemaByURLInput) (*domain.JSONSchema, error) {
	strURI := input.URL.String()
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		_, err := s.schemaResolver.Resolve(ctx, tx.Statements(), input.ProjectID, strURI, nil)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to resolve schema when creating")
		}
		return nil
	})
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}

	return s.v2Pool.Statements().GetJSONSchemaByID(ctx, input.ProjectID, strURI)
}

func (s *SchemaService) GetSchema(ctx context.Context, projectID string, teamID string, schemaID string) (*domain.JSONSchema, error) {
	schema, err := s.v2Pool.Statements().GetJSONSchemaByID(ctx, projectID, schemaID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrJSONSchemaNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get schema from database")
	}
	return schema, nil
}

func (s *SchemaService) ListSchemas(ctx context.Context, input ListSchemasInput) (*ListSchemasOutput, error) {
	filters := []database.Filter[domain.JSONSchemaField]{
		database.Equal(database.Col(domain.JSONSchemaFieldProjectID), input.ProjectID),
	}
	// The ids are ORed with each other and ANDed with everything else, so they
	// narrow the caller's already-authorized rows rather than reaching outside
	// them: an id from another project matches nothing, like an unknown one.
	if len(input.IDs) > 0 {
		ids := make([]database.Filter[domain.JSONSchemaField], len(input.IDs))
		for i, id := range input.IDs {
			ids[i] = database.Equal(database.Col(domain.JSONSchemaFieldURL), id)
		}
		filters = append(filters, database.Or(ids...))
	}
	if input.ObjectType != "" {
		filters = append(filters,
			database.Equal(database.Col(domain.JSONSchemaFieldObjectType), input.ObjectType),
		)
	}
	// Schemas persisted without their document being parsed — ingested by URL,
	// or a $ref target pulled in during resolution (#812) — are stored as
	// domain.JSONSchemaKindUnknown, which no filterable kind matches.
	if input.Kind != nil {
		filters = append(filters,
			database.Equal(database.Col(domain.JSONSchemaFieldKind), input.Kind.String()),
		)
	}

	cursor, err := revisionsCursor(input.PageToken, input.LatestRevisionPerObjectType)
	if err != nil {
		return nil, err
	}

	result, err := s.v2Pool.Statements().ListJSONSchemas(ctx, &database.ListOptions[domain.JSONSchemaField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.JSONSchemaField]{
			Limit:  uint32(normalizeLimit(input.Limit)),
			Cursor: cursor,
			OrderBy: database.OrderBy[domain.JSONSchemaField]{
				// url is the resource id and, with project_id fixed by the
				// filter, makes the order total so page boundaries cannot
				// skip or repeat rows sharing a created_at.
				Columns: []database.Column[domain.JSONSchemaField]{
					database.Col(domain.JSONSchemaFieldCreatedAt),
					database.Col(domain.JSONSchemaFieldURL),
				},
				Direction: database.OrderDesc,
			},
		},
	}, JSONSchemaQueryOptions{LatestRevisionPerObjectType: input.LatestRevisionPerObjectType})
	if err != nil {
		return nil, mapListError(err, "failed to list schemas")
	}

	return &ListSchemasOutput{
		Items:         result.Items,
		NextPageToken: stampRevisionsMode(result.NextCursor, input.LatestRevisionPerObjectType),
	}, nil
}

// Both revision modes sort by the same columns in the same direction — they
// have to, or a keyset boundary would tie-break differently on either side of
// it — so the cursor's own MatchesOrderBy cannot tell a token minted in one
// from a token minted in the other. The mode is stamped onto the token instead.
const (
	revisionsModeAll       = "all"
	revisionsModeLatest    = "latest"
	revisionsModeSeparator = "."
)

func revisionsMode(latest bool) string {
	if latest {
		return revisionsModeLatest
	}
	return revisionsModeAll
}

func stampRevisionsMode(cursor []byte, latest bool) string {
	if len(cursor) == 0 {
		return ""
	}
	return revisionsMode(latest) + revisionsModeSeparator + string(cursor)
}

// revisionsCursor strips the mode a page token was minted in, rejecting one
// that names the other mode: the keyset predicate would resume happily against
// a different row set and silently skip everything between the two.
func revisionsCursor(pageToken string, latest bool) ([]byte, error) {
	if pageToken == "" {
		return nil, nil
	}
	mode, cursor, ok := strings.Cut(pageToken, revisionsModeSeparator)
	if !ok || mode != revisionsMode(latest) {
		return nil, domain.ErrRequestInvalid().WithDetails("page token was issued for a different revisions mode")
	}
	return []byte(cursor), nil
}
