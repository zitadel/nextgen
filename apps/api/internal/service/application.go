package service

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/secrets"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type CreateApplicationOutput struct {
	Application *domain.Application
	// Secrets holds the plaintext secret of each client this write created,
	// in document order. Storage keeps only the hash.
	Secrets []ApplicationClientSecret
	Created bool
}

type ApplicationClientSecret struct {
	Slug     string
	ClientID string
	Secret   string
}

type ApplicationService interface {
	CreateOrRevise(ctx context.Context, projectID string, document []byte) (*CreateApplicationOutput, error)
	Get(ctx context.Context, projectID, id string) (*domain.Application, error)
}

type applicationService struct {
	v2Pool  *DB
	schemas BuiltinSchemaProvider
	secrets secrets.Generator
}

func NewApplicationService(v2Pool *DB, schemas BuiltinSchemaProvider, generator secrets.Generator) *applicationService {
	return &applicationService{v2Pool: v2Pool, schemas: schemas, secrets: generator}
}

// CreateOrRevise stores document as a new application when its slug is new in
// the project, and as a new revision of the existing application otherwise.
// Each client the write adds gets a secret, returned once in the output.
func (s *applicationService) CreateOrRevise(ctx context.Context, projectID string, document []byte) (_ *CreateApplicationOutput, err error) {
	ctx, end := startSpan(ctx, "ApplicationService.CreateOrRevise")
	defer end(&err)

	next, err := s.validate(document)
	if err != nil {
		return nil, err
	}

	existing, err := s.get(ctx, projectID, domain.ApplicationFieldSlug, next.Slug)
	if err == nil {
		return s.revise(ctx, existing, next, document)
	}
	if !errors.Is(err, domain.ErrApplicationNotFound()) {
		return nil, err
	}
	return s.create(ctx, projectID, next, document)
}

func (s *applicationService) Get(ctx context.Context, projectID, id string) (_ *domain.Application, err error) {
	ctx, end := startSpan(ctx, "ApplicationService.Get")
	defer end(&err)

	return s.get(ctx, projectID, domain.ApplicationFieldID, id)
}

// validate checks document against the application.json schema, then against
// the rules of the authorization server the schema cannot express.
func (s *applicationService) validate(document []byte) (domain.ApplicationDocument, error) {
	uri, err := s.schemas.LatestSchemaURI(domain.SchemaKindApplication)
	if err != nil {
		return domain.ApplicationDocument{}, domain.ErrInternal(err).WithMessage("application schema not registered")
	}
	schema, err := s.schemas.GetBuiltinSchema(uri)
	if err != nil {
		return domain.ApplicationDocument{}, domain.ErrInternal(err).WithMessage("application schema not compiled")
	}
	var raw map[string]any
	if err := json.Unmarshal(document, &raw); err != nil {
		return domain.ApplicationDocument{}, domain.ErrRequestInvalid().WithParent(err)
	}
	if err := schema.Validate(raw); err != nil {
		return domain.ApplicationDocument{}, domain.ErrRequestInvalid().WithDetails(domain.FlattenValidationErrors(err)).WithParent(domain.SchemaValidationCause(err))
	}
	doc, err := domain.ParseApplicationDocument(document)
	if err != nil {
		return domain.ApplicationDocument{}, domain.ErrRequestInvalid().WithParent(err)
	}
	return doc, domain.ValidateApplicationDocument(doc)
}

func (s *applicationService) create(ctx context.Context, projectID string, next domain.ApplicationDocument, document []byte) (*CreateApplicationOutput, error) {
	added, err := domain.ApplicationRevisionNewClients(domain.ApplicationDocument{}, next)
	if err != nil {
		return nil, err
	}
	clients, plain, err := s.newClients(projectID, next, added)
	if err != nil {
		return nil, err
	}
	entity := &domain.Application{ProjectID: projectID, Slug: next.Slug, Document: document}
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		if err := stmts.CreateApplication(ctx, entity, clients); err != nil {
			return err
		}
		return emitApplicationEvent(ctx, stmts, domain.EventTypeApplicationCreated, entity, domain.ApplicationPayloadSnapshot(entity, next, clients))
	})
	if err == nil {
		return &CreateApplicationOutput{Application: entity, Secrets: clientSecrets(clients, plain), Created: true}, nil
	}
	// project_id is the only foreign key on a new application, so a violation
	// means the project was deleted underneath the call.
	if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return nil, domain.ErrApplicationNotFound().WithParent(err)
	}
	if _, ok := errors.AsType[*database.UniqueError](err); !ok {
		return nil, domain.ErrInternal(err).WithMessage("failed to create application")
	}
	// sqlite and spanner leave the constraint name empty, so read the state.
	// The slug comes first: when another caller created the same application,
	// its client holds the same client_id and the right answer is a revision.
	existing, getErr := s.get(ctx, projectID, domain.ApplicationFieldSlug, next.Slug)
	if getErr == nil {
		return s.revise(ctx, existing, next, document)
	}
	if !errors.Is(getErr, domain.ErrApplicationNotFound()) {
		return nil, getErr
	}
	if takenErr := s.clientIDTaken(ctx, clients); takenErr != nil {
		return nil, takenErr
	}
	return nil, domain.ErrInternal(err).WithMessage("failed to create application")
}

// revise appends document as a new revision of existing. The row is locked
// before the newest revision is read, so two concurrent revisions cannot both
// treat the same client as new.
func (s *applicationService) revise(ctx context.Context, existing *domain.Application, next domain.ApplicationDocument, document []byte) (*CreateApplicationOutput, error) {
	var entity *domain.Application
	var clients []*domain.ApplicationClient
	var plain []string
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		if err := stmts.LockApplication(ctx, existing.ProjectID, existing.ID); err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrApplicationNotFound().WithParent(err)
			}
			return err
		}
		current, err := stmts.GetApplication(ctx, applicationBy(existing.ProjectID, domain.ApplicationFieldID, existing.ID))
		if err != nil {
			return err
		}
		// The stored document holds every client with its client_id, since a
		// revision can neither remove a client nor drop its id.
		stored, err := domain.ParseApplicationDocument(current.Document)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to parse stored application")
		}
		added, err := domain.ApplicationRevisionNewClients(stored, next)
		if err != nil {
			return err
		}
		clients, plain, err = s.newClients(current.ProjectID, next, added)
		if err != nil {
			return err
		}
		entity = &domain.Application{
			ProjectID: current.ProjectID,
			ID:        current.ID,
			Slug:      current.Slug,
			Document:  document,
			CreatedAt: current.CreatedAt,
		}
		if err := stmts.ReviseApplication(ctx, entity, clients); err != nil {
			return err
		}
		return emitApplicationEvent(ctx, stmts, domain.EventTypeApplicationUpdated, entity, domain.ApplicationPayloadDelta(stored, next, entity, clients))
	})
	if err == nil {
		return &CreateApplicationOutput{Application: entity, Secrets: clientSecrets(clients, plain)}, nil
	}
	if _, ok := errors.AsType[*database.UniqueError](err); ok {
		if takenErr := s.clientIDTaken(ctx, clients); takenErr != nil {
			return nil, takenErr
		}
		return nil, domain.ErrApplicationRevisionConflict().WithParent(err)
	}
	if de, ok := errors.AsType[domain.Error](err); ok {
		return nil, de
	}
	return nil, domain.ErrInternal(err).WithMessage("failed to revise application")
}

// newClients builds a stored client with a fresh secret for each slug in
// added, and returns the plaintext secrets in the same order.
func (s *applicationService) newClients(projectID string, next domain.ApplicationDocument, added []string) ([]*domain.ApplicationClient, []string, error) {
	clients := make([]*domain.ApplicationClient, 0, len(added))
	plain := make([]string, 0, len(added))
	for _, client := range next.Clients {
		if !slices.Contains(added, client.Slug) {
			continue
		}
		secret, err := s.secrets.New(string(domain.PrefixApplicationClient))
		if err != nil {
			return nil, nil, domain.ErrInternal(err).WithMessage("failed to generate client secret")
		}
		stored := &domain.ApplicationClient{ProjectID: projectID, Slug: client.Slug, SecretHash: domain.HashSecret(secret)}
		if client.ClientID != nil {
			stored.ClientID = *client.ClientID
		}
		clients = append(clients, stored)
		plain = append(plain, secret)
	}
	return clients, plain, nil
}

// clientIDTaken returns client_id_taken when another client of the project
// holds the client_id of one of clients, and nil when none does.
func (s *applicationService) clientIDTaken(ctx context.Context, clients []*domain.ApplicationClient) error {
	for _, client := range clients {
		_, err := s.v2Pool.Statements().GetApplicationClientByClientID(ctx, client.ProjectID, client.ClientID)
		if err == nil {
			return domain.ErrApplicationClientIDTaken().WithDetails(map[string]string{"client_id": client.ClientID})
		}
		if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
			return domain.ErrInternal(err).WithMessage("failed to look up application client")
		}
	}
	return nil
}

func emitApplicationEvent(ctx context.Context, stmts AllStatements, eventType domain.EventType, entity *domain.Application, payload domain.ApplicationPayload) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       eventType,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "application",
		EntityID:   entity.ID,
		Payload:    payload,
	})
}

func (s *applicationService) get(ctx context.Context, projectID string, field domain.ApplicationField, value string) (*domain.Application, error) {
	entity, err := s.v2Pool.Statements().GetApplication(ctx, applicationBy(projectID, field, value))
	if err == nil {
		return entity, nil
	}
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return nil, domain.ErrApplicationNotFound()
	}
	return nil, domain.ErrInternal(err).WithMessage("failed to get application")
}

func applicationBy(projectID string, field domain.ApplicationField, value string) database.Filter[domain.ApplicationField] {
	return database.And(
		database.Equal(database.Col(domain.ApplicationFieldProjectID), projectID),
		database.Equal(database.Col(field), value),
	)
}

func clientSecrets(clients []*domain.ApplicationClient, plain []string) []ApplicationClientSecret {
	out := make([]ApplicationClientSecret, len(clients))
	for i, client := range clients {
		out[i] = ApplicationClientSecret{Slug: client.Slug, ClientID: client.ClientID, Secret: plain[i]}
	}
	return out
}
