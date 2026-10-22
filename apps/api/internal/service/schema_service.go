package service

import (
	"context"
	"errors"
	"fmt"
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
	// ObjectTypes narrows the list to any of the given object types.
	ObjectTypes []string
	// Kind is nil when the caller did not filter by one. It is a pointer rather
	// than a zero value because JSONSchemaKindUnknown is a real stored kind, so
	// it cannot double as "no filter".
	Kind *domain.JSONSchemaKind
	// LatestRevisionPerObjectType asks for the newest revision of each object
	// type instead of the full revision history.
	LatestRevisionPerObjectType bool
	IncludeInUse                bool
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
	// builtinBases resolves a built-in schema's `$id` under whichever base the
	// project stores it (domain.BuiltinSchemaBases).
	builtinBases domain.BuiltinSchemaBases
}

func NewSchemaService(
	v2Pool *DB,
	schemaResolver *domain.JSONSchemaResolver,
	schemaValidator *domain.SchemaValidator,
	builtinBases domain.BuiltinSchemaBases,
) *SchemaService {
	return &SchemaService{
		v2Pool:          v2Pool,
		schemaResolver:  schemaResolver,
		schemaValidator: schemaValidator,
		builtinBases:    builtinBases,
	}
}

func (s *SchemaService) CreateSchema(ctx context.Context, input CreateSchemaInput) (_ *domain.JSONSchema, err error) {
	ctx, end := startSpan(ctx, "SchemaService.CreateSchema")
	defer end(&err)

	model, err := s.prepareSchema(input)
	if err != nil {
		return nil, err
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		return s.createSchema(ctx, tx.Statements(), model)
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

// prepareSchema validates and builds the domain model without writing.
func (s *SchemaService) prepareSchema(input CreateSchemaInput) (*domain.JSONSchema, error) {
	model, err := domain.NewJSONSchema(input.ProjectID, input.Schema)
	if err != nil {
		return nil, err
	}
	if err := s.schemaValidator.ValidateAgainstMetaSchema(input.Schema); err != nil {
		invalid := domain.ErrJSONSchemaInvalid().WithParent(err)
		if errors.Is(err, domain.ErrSchemaDesignationInvalid) {
			// The designation rules are semantic and their text is the only
			// pointer to which rule fired; Parent is never serialized
			// (ADR 030), so carry the message to the client.
			invalid = invalid.WithMessage(err.Error())
		}
		return nil, invalid
	}
	return model, nil
}

// createSchema inserts a prepared schema and emits its event on stmts.
// Callers that open their own transaction (CreateSchema, ReleaseService.Build)
// share this write path.
func (s *SchemaService) createSchema(ctx context.Context, stmts AllStatements, model *domain.JSONSchema) error {
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
	if _, err := s.schemaResolver.Resolve(ctx, stmts, model.ProjectID, model.URL, model.Schema); err != nil {
		return resolveSchemaError(err)
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeSchemaCreated,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  model.ProjectID,
		EntityType: "json_schema",
		EntityID:   model.URL,
		Payload:    domain.SchemaCreatedPayloadSnapshot(model),
	})
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

// resolveSchemaError maps a failed schema resolution onto the caller-visible
// error. The fetch_* re-stamps are runtime no-ops that put each code in a
// return position, which the OpenAPI error analysis needs: it cannot see
// through the resolver's $ref loader indirection (domain.classifyFetchError).
func resolveSchemaError(err error) error {
	de, ok := errors.AsType[domain.Error](err)
	if !ok {
		// The resolver reports an envelope that expired after the last
		// fetch as a bare context error (see domain.JSONSchemaResolver.Resolve).
		if errors.Is(err, context.DeadlineExceeded) {
			return domain.ErrJSONSchemaFetchTimeout().WithParent(err)
		}
		return domain.ErrInternal(err).WithMessage("failed to resolve schema when creating")
	}
	switch de.Code {
	case domain.ErrJSONSchemaFetchDenied().Code:
		return domain.ErrJSONSchemaFetchDenied().WithDetails(de.Details).WithParent(de.Parent)
	case domain.ErrJSONSchemaFetchTooLarge().Code:
		return domain.ErrJSONSchemaFetchTooLarge().WithDetails(de.Details).WithParent(de.Parent)
	case domain.ErrJSONSchemaFetchTooManyRedirects().Code:
		return domain.ErrJSONSchemaFetchTooManyRedirects().WithDetails(de.Details).WithParent(de.Parent)
	case domain.ErrJSONSchemaFetchDowngrade().Code:
		return domain.ErrJSONSchemaFetchDowngrade().WithDetails(de.Details).WithParent(de.Parent)
	case domain.ErrJSONSchemaFetchTimeout().Code:
		return domain.ErrJSONSchemaFetchTimeout().WithDetails(de.Details).WithParent(de.Parent)
	}
	return de
}

func (s *SchemaService) CreateSchemaByUrl(ctx context.Context, input CreateSchemaByURLInput) (_ *domain.JSONSchema, err error) {
	ctx, end := startSpan(ctx, "SchemaService.CreateSchemaByUrl")
	defer end(&err)

	strURI := input.URL.String()
	// A URL in the built-in namespace names a document the project either
	// already holds or never will: nothing under those bases is fetched, so
	// there is nothing to create. Answer with the row that exists, under the
	// base it is stored at, or say which it is.
	if _, inNamespace := s.builtinBases.RelPath(strURI); inNamespace {
		stored, err := s.builtinBases.GetJSONSchema(ctx, s.v2Pool.Statements(), input.ProjectID, strURI)
		if err == nil {
			if stored.URL == strURI {
				return stored, nil
			}
			return nil, domain.ErrJSONSchemaAlreadyExists().WithDetails(fmt.Sprintf("the schema exists as %q", stored.URL))
		}
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrJSONSchemaNotFound().WithDetails(fmt.Sprintf("no schema %q in this project; URLs under the built-in schema namespace are never fetched", strURI))
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get schema from database")
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		return s.createSchemaByURL(ctx, tx.Statements(), input.ProjectID, strURI)
	})
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to commit transaction")
	}

	return s.v2Pool.Statements().GetJSONSchemaByID(ctx, input.ProjectID, strURI)
}

// createSchemaByURL resolves and stores a schema-url entry on stmts.
func (s *SchemaService) createSchemaByURL(ctx context.Context, stmts AllStatements, projectID, schemaURL string) error {
	_, err := s.schemaResolver.Resolve(ctx, stmts, projectID, schemaURL, nil)
	if err != nil {
		return resolveSchemaError(err)
	}
	return nil
}

// resolveOrCreateSchema reuses any existing revision of objectType whose
// document matches (ignoring $id; preferring the newest match), otherwise
// inserts the prepared model. When schemaURL is set, the project's copy of
// that URL is reused or fetched.
func (s *SchemaService) resolveOrCreateSchema(
	ctx context.Context,
	stmts AllStatements,
	projectID string,
	document []byte,
	prepared *domain.JSONSchema,
	schemaURL string,
) (*domain.JSONSchema, error) {
	if schemaURL != "" {
		return s.resolveOrCreateSchemaURL(ctx, stmts, projectID, schemaURL)
	}

	handle := ""
	if prepared.ObjectType != nil {
		handle = *prepared.ObjectType
	}
	match, err := matchingSchemaByObjectType(ctx, stmts, projectID, handle, document)
	if err != nil {
		return nil, err
	}
	if match != nil {
		return match, nil
	}
	if err := s.createSchema(ctx, stmts, prepared); err != nil {
		return nil, err
	}
	return prepared, nil
}

func (s *SchemaService) resolveOrCreateSchemaURL(
	ctx context.Context,
	stmts AllStatements,
	projectID, schemaURL string,
) (*domain.JSONSchema, error) {
	existing, err := s.builtinBases.GetJSONSchema(ctx, stmts, projectID, schemaURL)
	if err == nil {
		return existing, nil
	}
	if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
		return nil, domain.ErrInternal(err).WithMessage("failed to look up schema by url")
	}
	if _, inNamespace := s.builtinBases.RelPath(schemaURL); inNamespace {
		return nil, domain.ErrJSONSchemaNotFound().WithDetails(fmt.Sprintf("no schema %q in this project; URLs under the built-in schema namespace are never fetched", schemaURL))
	}
	if err := s.createSchemaByURL(ctx, stmts, projectID, schemaURL); err != nil {
		return nil, err
	}
	return stmts.GetJSONSchemaByID(ctx, projectID, schemaURL)
}

// matchingSchemaByObjectType returns the newest revision of objectType whose
// document equals want (ignoring $id), or nil when none match.
func matchingSchemaByObjectType(ctx context.Context, stmts AllStatements, projectID, objectType string, want []byte) (*domain.JSONSchema, error) {
	if objectType == "" {
		return nil, nil
	}
	result, err := stmts.ListJSONSchemas(WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.JSONSchemaField]{
		Filter: database.And(
			database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID),
			database.Equal(database.Col(domain.JSONSchemaFieldObjectType), objectType),
		),
		Pagination: database.Page[domain.JSONSchemaField]{
			Limit: maxHistoricalRevisions,
			OrderBy: database.OrderBy[domain.JSONSchemaField]{
				Columns: []database.Column[domain.JSONSchemaField]{
					database.Col(domain.JSONSchemaFieldCreatedAt),
					database.Col(domain.JSONSchemaFieldURL),
				},
				Direction: database.OrderDesc,
			},
		},
	}, JSONSchemaQueryOptions{})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list schemas")
	}
	for _, item := range result.Items {
		same, eqErr := domain.JSONEqual(want, item.Schema, "$id")
		if eqErr != nil {
			return nil, domain.ErrInternal(eqErr).WithMessage("failed to compare schema documents")
		}
		if same {
			return item, nil
		}
	}
	return nil, nil
}

// LatestSchemaByObjectType is the project's newest schema declaring objectType,
// nil when it has none.
func LatestSchemaByObjectType(ctx context.Context, stmts AllStatements, projectID, objectType string) (*domain.JSONSchema, error) {
	if objectType == "" {
		return nil, nil
	}
	result, err := stmts.ListJSONSchemas(WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.JSONSchemaField]{
		Filter: database.And(
			database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID),
			database.Equal(database.Col(domain.JSONSchemaFieldObjectType), objectType),
		),
		Pagination: database.Page[domain.JSONSchemaField]{Limit: 1},
	}, JSONSchemaQueryOptions{LatestRevisionPerObjectType: true})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list schemas")
	}
	if len(result.Items) == 0 {
		return nil, nil
	}
	return result.Items[0], nil
}

func (s *SchemaService) GetSchema(ctx context.Context, projectID string, teamID string, schemaID string) (_ *domain.JSONSchema, err error) {
	ctx, end := startSpan(ctx, "SchemaService.GetSchema")
	defer end(&err)

	schema, err := s.builtinBases.GetJSONSchema(ctx, s.v2Pool.Statements(), projectID, schemaID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrJSONSchemaNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get schema from database")
	}
	return schema, nil
}

func (s *SchemaService) ListSchemas(ctx context.Context, input ListSchemasInput) (_ *ListSchemasOutput, err error) {
	ctx, end := startSpan(ctx, "SchemaService.ListSchemas")
	defer end(&err)

	filters := []database.Filter[domain.JSONSchemaField]{
		database.Equal(database.Col(domain.JSONSchemaFieldProjectID), input.ProjectID),
	}
	if len(input.ObjectTypes) > 0 {
		objectTypes := make([]database.Filter[domain.JSONSchemaField], len(input.ObjectTypes))
		for i, objectType := range input.ObjectTypes {
			objectTypes[i] = database.Equal(database.Col(domain.JSONSchemaFieldObjectType), objectType)
		}
		filters = append(filters, database.Or(objectTypes...))
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
	}, JSONSchemaQueryOptions{
		LatestRevisionPerObjectType: input.LatestRevisionPerObjectType,
		IncludeInUse:                input.IncludeInUse,
	})
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
