package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/zitadel/zitadel/v5/internal/audit"
	"github.com/zitadel/zitadel/v5/internal/domain"
	"github.com/zitadel/zitadel/v5/internal/storage/database"
	"github.com/zitadel/zitadel/v5/internal/storage/idpconnection"
)

type CreateIDPConnectionOutput struct {
	Connection *domain.IDPConnection
	// Created distinguishes a new connection from a new revision of an
	// existing one, which the caller answers 200 to rather than 201.
	Created bool
}

type ListIDPConnectionsInput struct {
	ProjectID string
	Sorting   *Sorting // optional; defaults to created_at asc
	Filters   []Filter
	Limit     int
	PageToken string
}

type ListIDPConnectionRevisionsInput struct {
	ProjectID string
	ID        string
	Limit     int
	PageToken string
}

type ListIDPConnectionsOutput struct {
	Items         []*domain.IDPConnection
	NextPageToken string
}

type IDPConnectionService interface {
	CreateOrRevise(ctx context.Context, projectID string, document []byte) (*CreateIDPConnectionOutput, error)
	Get(ctx context.Context, projectID, id string) (*domain.IDPConnection, error)
	// GetBySlugs returns the project's connections whose slug is in slugs,
	// each at its newest revision, in no particular order. A slug with no
	// connection is absent from the result rather than an error.
	GetBySlugs(ctx context.Context, projectID string, slugs []string) ([]*domain.IDPConnection, error)
	GetRevision(ctx context.Context, projectID, revisionID string) (*domain.IDPConnection, error)
	List(ctx context.Context, input ListIDPConnectionsInput) (*ListIDPConnectionsOutput, error)
	ListRevisions(ctx context.Context, input ListIDPConnectionRevisionsInput) (*ListIDPConnectionsOutput, error)
}

type idpConnectionService struct {
	v2Pool  *DB
	schemas BuiltinSchemaProvider
}

func NewIDPConnectionService(v2Pool *DB, schemas BuiltinSchemaProvider) IDPConnectionService {
	return &idpConnectionService{v2Pool: v2Pool, schemas: schemas}
}

// CreateOrRevise stores document as a new connection when its slug is new in
// the project, and as a new revision of the existing connection otherwise.
func (s *idpConnectionService) CreateOrRevise(ctx context.Context, projectID string, document []byte) (*CreateIDPConnectionOutput, error) {
	slug, err := s.validate(document)
	if err != nil {
		return nil, err
	}

	existing, err := s.get(ctx, projectID, domain.IDPConnectionFieldSlug, slug)
	if err == nil {
		return s.revise(ctx, projectID, existing.ID, document)
	}
	if !errors.Is(err, domain.ErrIDPConnectionNotFound()) {
		return nil, err
	}

	created, err := s.create(ctx, &domain.IDPConnection{ProjectID: projectID, Slug: slug, Document: document})
	if err == nil {
		return &CreateIDPConnectionOutput{Connection: created, Created: true}, nil
	}
	if !errors.Is(err, errIDPSlugTaken) {
		return nil, err
	}
	// Another caller created the slug between the read and the insert. Its
	// connection is the one this document now revises.
	existing, err = s.get(ctx, projectID, domain.IDPConnectionFieldSlug, slug)
	if err != nil {
		return nil, err
	}
	return s.revise(ctx, projectID, existing.ID, document)
}

// errIDPSlugTaken reports that create lost the race for a slug to another
// caller, which CreateOrRevise answers by revising the winner's connection.
var errIDPSlugTaken = errors.New("identity provider connection slug taken")

// validate checks document against the idp-connection.json schema and returns
// its slug. The request decoder cannot do this alone: its model drops the
// schema's root allOf, which ties each protocol to its block.
func (s *idpConnectionService) validate(document []byte) (string, error) {
	uri, err := s.schemas.LatestSchemaURI(domain.SchemaKindIDPConnection)
	if err != nil {
		return "", domain.ErrInternal(err).WithMessage("identity provider connection schema not registered")
	}
	schema, err := s.schemas.GetBuiltinSchema(uri)
	if err != nil {
		return "", domain.ErrInternal(err).WithMessage("identity provider connection schema not compiled")
	}
	var doc map[string]any
	if err := json.Unmarshal(document, &doc); err != nil {
		return "", domain.ErrRequestInvalid().WithParent(err)
	}
	if err := schema.Validate(doc); err != nil {
		return "", domain.ErrRequestInvalid().WithDetails(domain.FlattenValidationErrors(err)).WithParent(err)
	}
	slug, _ := doc["slug"].(string)
	return slug, nil
}

func (s *idpConnectionService) create(ctx context.Context, entity *domain.IDPConnection) (*domain.IDPConnection, error) {
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().CreateIDPConnection(ctx, entity); err != nil {
			return err
		}
		payload, err := domain.IDPConnectionPayloadSnapshot(entity)
		if err != nil {
			return err
		}
		return emitIDPConnectionEvent(ctx, tx, domain.EventTypeIDPCreated, entity, payload)
	})
	if err == nil {
		return entity, nil
	}
	// project_id is the only foreign key on a new connection, so a violation
	// means the project was deleted underneath the call.
	if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return nil, domain.ErrIDPConnectionNotFound().WithParent(err)
	}
	if _, ok := errors.AsType[*database.UniqueError](err); ok {
		return nil, fmt.Errorf("%w: %w", errIDPSlugTaken, err)
	}
	return nil, domain.ErrInternal(err).WithMessage("failed to create identity provider connection")
}

// revise appends document as a new revision of connection id. The newest
// revision is read inside the transaction, so the immutability check and the
// event delta compare against the revision this one follows, not a copy read
// before a concurrent revise landed.
//
// The connection row is locked before that read. Without the lock two
// concurrent revisions could both read the same newest revision (a plain
// read does not wait at READ COMMITTED), and the later one would compute its
// delta against a revision that is no longer the one it follows.
func (s *idpConnectionService) revise(ctx context.Context, projectID, id string, document []byte) (*CreateIDPConnectionOutput, error) {
	var entity *domain.IDPConnection
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := tx.Statements().LockIDPConnection(ctx, projectID, id); err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrIDPConnectionNotFound().WithParent(err)
			}
			return err
		}
		current, err := tx.Statements().GetIDPConnection(ctx, idpConnectionBy(projectID, domain.IDPConnectionFieldID, id))
		if err != nil {
			return err
		}
		changed, err := domain.IDPConnectionImmutableFieldsChanged(current.Document, document)
		if err != nil {
			return err
		}
		if len(changed) > 0 {
			return domain.ErrIDPConnectionFieldImmutable(map[string][]string{"fields": changed})
		}
		entity = &domain.IDPConnection{
			ProjectID: current.ProjectID,
			ID:        current.ID,
			Slug:      current.Slug,
			Document:  document,
			CreatedAt: current.CreatedAt,
		}
		if err := tx.Statements().ReviseIDPConnection(ctx, entity); err != nil {
			return err
		}
		payload, err := domain.IDPConnectionPayloadDelta(current, entity)
		if err != nil {
			return err
		}
		return emitIDPConnectionEvent(ctx, tx, domain.EventTypeIDPUpdated, entity, payload)
	})
	if err != nil {
		// Two revisions of one connection on the same instant have no newest,
		// so the storage unique index rejects the second one.
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			return nil, domain.ErrIDPConnectionRevisionConflict().WithParent(err)
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to revise identity provider connection")
	}
	return &CreateIDPConnectionOutput{Connection: entity}, nil
}

func emitIDPConnectionEvent(ctx context.Context, tx Statementer[AllStatements], eventType domain.EventType, entity *domain.IDPConnection, payload domain.IDPConnectionPayload) error {
	return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
		Type:       eventType,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "idp_connection",
		EntityID:   entity.ID,
		Payload:    payload,
	})
}

func (s *idpConnectionService) Get(ctx context.Context, projectID, id string) (*domain.IDPConnection, error) {
	return s.get(ctx, projectID, domain.IDPConnectionFieldID, id)
}

// GetBySlugs reads the whole slug set in one statement. The flow render calls
// it outside any management request, so the list runs unrestricted, like the
// flow definition lookup on the same path. A zero limit compiles to no LIMIT,
// so one page holds every match.
func (s *idpConnectionService) GetBySlugs(ctx context.Context, projectID string, slugs []string) ([]*domain.IDPConnection, error) {
	// An empty OR compiles to nothing and leaves a dangling AND in the WHERE.
	if len(slugs) == 0 {
		return nil, nil
	}
	result, err := s.v2Pool.Statements().ListIDPConnections(WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.IDPConnectionField]{
		Filter: database.And(
			database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
			database.Or(equalIDFilters(domain.IDPConnectionFieldSlug, slugs)...),
		),
	})
	if err != nil {
		return nil, mapListError(err, "failed to list identity provider connections")
	}
	return result.Items, nil
}

func (s *idpConnectionService) get(ctx context.Context, projectID string, field domain.IDPConnectionField, value string) (*domain.IDPConnection, error) {
	entity, err := s.v2Pool.Statements().GetIDPConnection(ctx, idpConnectionBy(projectID, field, value))
	return entity, mapIDPConnectionReadError(err)
}

func idpConnectionBy(projectID string, field domain.IDPConnectionField, value string) database.Filter[domain.IDPConnectionField] {
	return database.And(
		database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
		database.Equal(database.Col(field), value),
	)
}

func (s *idpConnectionService) GetRevision(ctx context.Context, projectID, revisionID string) (*domain.IDPConnection, error) {
	entity, err := s.v2Pool.Statements().GetIDPConnectionRevision(ctx, projectID, revisionID)
	return entity, mapIDPConnectionReadError(err)
}

func mapIDPConnectionReadError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return domain.ErrIDPConnectionNotFound()
	}
	return domain.ErrInternal(err).WithMessage("failed to get identity provider connection")
}

// List returns each connection of the project once, at its newest revision.
func (s *idpConnectionService) List(ctx context.Context, input ListIDPConnectionsInput) (*ListIDPConnectionsOutput, error) {
	filters := make([]database.Filter[domain.IDPConnectionField], 0, len(input.Filters)+1)
	filters = append(filters, database.Equal(database.Col(domain.IDPConnectionFieldProjectID), input.ProjectID))
	for _, f := range input.Filters {
		filter, err := idpConnectionFilter(f)
		if err != nil {
			return nil, err
		}
		filters = append(filters, filter)
	}

	orderBy, err := listOrderBy(input.Sorting, domain.IDPConnectionFieldCreatedAt, database.OrderAsc, idpConnectionField, domain.IDPConnectionFieldID)
	if err != nil {
		return nil, err
	}

	result, err := s.v2Pool.Statements().ListIDPConnections(ctx, &database.ListOptions[domain.IDPConnectionField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.IDPConnectionField]{
			Limit:   uint32(normalizeLimit(input.Limit)),
			OrderBy: orderBy,
			Cursor:  []byte(input.PageToken),
		},
	})
	if err != nil {
		return nil, mapListError(err, "failed to list identity provider connections")
	}
	return &ListIDPConnectionsOutput{Items: result.Items, NextPageToken: string(result.NextCursor)}, nil
}

// ListRevisions pages one connection's revisions, newest first.
func (s *idpConnectionService) ListRevisions(ctx context.Context, input ListIDPConnectionRevisionsInput) (*ListIDPConnectionsOutput, error) {
	// The revisions statement answers an unknown connection with an empty
	// page, so the lookup is what tells a miss from a connection's history.
	if _, err := s.Get(ctx, input.ProjectID, input.ID); err != nil {
		return nil, err
	}
	result, err := s.v2Pool.Statements().ListIDPConnectionRevisions(ctx, input.ProjectID, input.ID, database.Page[domain.IDPConnectionField]{
		Limit:   uint32(normalizeLimit(input.Limit)),
		OrderBy: idpconnection.RevisionsNewestFirst(),
		Cursor:  []byte(input.PageToken),
	})
	if err != nil {
		return nil, mapListError(err, "failed to list identity provider connection revisions")
	}
	return &ListIDPConnectionsOutput{Items: result.Items, NextPageToken: string(result.NextCursor)}, nil
}

// idpConnectionFilter maps an API filter predicate to a storage filter.
func idpConnectionFilter(f Filter) (database.Filter[domain.IDPConnectionField], error) {
	switch f.Field {
	case "created_at":
		return createdAtFilter(f.Operation, database.Col(domain.IDPConnectionFieldCreatedAt), f.Value)
	case "slug":
		value, err := stringFilterValue(f)
		if err != nil {
			return nil, err
		}
		return stringFilter(f.Operation, database.Col(domain.IDPConnectionFieldSlug), value)
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", f.Field))
	}
}

// idpConnectionField maps an API sort field to its [domain.IDPConnectionField].
func idpConnectionField(field string) (domain.IDPConnectionField, error) {
	switch field {
	case "created_at":
		return domain.IDPConnectionFieldCreatedAt, nil
	case "slug":
		return domain.IDPConnectionFieldSlug, nil
	default:
		return domain.IDPConnectionFieldUnspecified, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", field))
	}
}
