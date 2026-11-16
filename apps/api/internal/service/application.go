package service

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
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

// ServedApplicationClient is a client as it serves a request: its
// application at the revision serving the request, the client's document in
// that revision, and its stored row.
type ServedApplicationClient struct {
	Application *domain.Application
	Document    domain.ApplicationClientDocument
	Stored      *domain.ApplicationClient
}

type ApplicationService interface {
	CreateOrRevise(ctx context.Context, projectID string, document []byte) (*CreateApplicationOutput, error)
	Get(ctx context.Context, projectID, id string) (*domain.Application, error)
	// GetRevision reads one revision by its id, the one a release pins.
	GetRevision(ctx context.Context, projectID, revisionID string) (*domain.Application, error)
	// Client finds the client clientID names, as it serves the request in ctx:
	// a registered application at its newest revision, a declared one at the
	// revision the request's release pins (ADR 082 §3). Errors:
	// app.client_not_found when no client serving the request holds clientID,
	// rel.not_deployed when it is declared and the request resolved no
	// release.
	Client(ctx context.Context, projectID, clientID string) (*ServedApplicationClient, error)
	// AuthenticateClient is [ApplicationService.Client] for a client that
	// presents secret: a registered client's must match one of its stored
	// hashes, a declared one's the variable its `secret` names, as the
	// request's deployment froze it. Errors: those of Client, and
	// app.client_secret_invalid when the client is not confidential or the
	// secret does not match.
	AuthenticateClient(ctx context.Context, projectID, clientID, secret string) (*ServedApplicationClient, error)
}

type applicationService struct {
	v2Pool    *DB
	schemas   BuiltinSchemaProvider
	secrets   secrets.Generator
	variables VariableService
	keys      KeyService
}

// NewApplicationService wires the API's and the release build's application
// writes, and the client lookup. variables and keys read a declared client's
// secret.
func NewApplicationService(v2Pool *DB, schemas BuiltinSchemaProvider, generator secrets.Generator, variables VariableService, keys KeyService) *applicationService {
	return &applicationService{v2Pool: v2Pool, schemas: schemas, secrets: generator, variables: variables, keys: keys}
}

// CreateOrRevise stores document as a new registered application when its
// slug is new in the project, and as a new revision of the existing
// registered application otherwise. Each client the write adds gets a secret,
// returned once in the output. An application a release declares has the
// release as its one writer, so its slug is refused.
func (s *applicationService) CreateOrRevise(ctx context.Context, projectID string, document []byte) (_ *CreateApplicationOutput, err error) {
	ctx, end := startSpan(ctx, "ApplicationService.CreateOrRevise")
	defer end(&err)

	next, err := s.validate(document, false)
	if err != nil {
		return nil, err
	}

	existing, err := s.get(ctx, projectID, domain.ApplicationFieldSlug, next.Slug)
	if err == nil {
		return s.revise(ctx, existing.ProjectID, existing.ID, next, document)
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

func (s *applicationService) GetRevision(ctx context.Context, projectID, revisionID string) (_ *domain.Application, err error) {
	ctx, end := startSpan(ctx, "ApplicationService.GetRevision")
	defer end(&err)

	entity, err := s.v2Pool.Statements().GetApplicationRevision(ctx, projectID, revisionID)
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return nil, domain.ErrApplicationNotFound()
	}
	if err != nil {
		return nil, applicationReadError(err)
	}
	return entity, nil
}

// validate checks document against the application.json schema, then against
// the rules of the authorization server the schema cannot express, for the
// writer: declared for a release, registered for the API.
func (s *applicationService) validate(document []byte, declared bool) (domain.ApplicationDocument, error) {
	if _, err := validateBuiltinSchema(s.schemas, domain.SchemaKindApplication, document); err != nil {
		return domain.ApplicationDocument{}, err
	}
	doc, err := domain.ParseApplicationDocument(document)
	if err != nil {
		return domain.ApplicationDocument{}, domain.ErrRequestInvalid().WithParent(err)
	}
	if declared {
		return doc, domain.ValidateDeclaredApplication(doc)
	}
	return doc, domain.ValidateRegisteredApplication(doc)
}

func (s *applicationService) create(ctx context.Context, projectID string, next domain.ApplicationDocument, document []byte) (*CreateApplicationOutput, error) {
	app, clients, plainSecrets, err := domain.NewRegisteredApplication(projectID, next, document, s.secrets)
	if err != nil {
		return nil, err
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		if err := stmts.CreateApplication(ctx, app, clients); err != nil {
			return err
		}
		if err := storeClientSecrets(ctx, stmts, clients, plainSecrets); err != nil {
			return err
		}
		return emitApplicationEvent(ctx, stmts, domain.EventTypeApplicationCreated, app, domain.ApplicationPayloadSnapshot(app, next, clients))
	})
	if err == nil {
		return &CreateApplicationOutput{Application: app, Secrets: clientSecrets(clients, plainSecrets), Created: true}, nil
	}

	// project_id is the only foreign key on a new application, so a violation
	// means the project was deleted underneath the call.
	if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return nil, domain.ErrApplicationNotFound().WithParent(err)
	}
	if _, ok := errors.AsType[*database.UnavailableError](err); ok {
		return nil, domain.ErrUnavailable().WithParent(err)
	}
	if _, ok := errors.AsType[*database.UniqueError](err); !ok {
		return nil, domain.ErrInternal(err).WithMessage("failed to create application")
	}

	// sqlite and spanner leave the constraint name empty, so read the state.
	// The slug comes first: when another caller created the same application,
	// its client holds the same client_id and the right answer is a revision.
	existing, getErr := s.get(ctx, projectID, domain.ApplicationFieldSlug, next.Slug)
	if getErr != nil {
		if !errors.Is(getErr, domain.ErrApplicationNotFound()) {
			return nil, getErr
		}
		if takenErr := s.clientIDTaken(ctx, clients); takenErr != nil {
			return nil, takenErr
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to create application")
	}

	return s.revise(ctx, existing.ProjectID, existing.ID, next, document)
}

// revise appends document as a new revision of existing. The row is locked
// before the newest revision is read, so two concurrent revisions cannot both
// treat the same client as new.
func (s *applicationService) revise(ctx context.Context, projectID string, applicationID string, newDoc domain.ApplicationDocument, newDocBs []byte) (*CreateApplicationOutput, error) {
	var revisedApp *domain.Application
	var addedClients []*domain.ApplicationClient
	var plainSecrets []string
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		if err := stmts.LockApplication(ctx, projectID, applicationID); err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrApplicationNotFound().WithParent(err)
			}
			return err
		}
		oldApp, err := stmts.GetApplication(ctx, applicationBy(projectID, domain.ApplicationFieldID, applicationID))
		if err != nil {
			return err
		}

		revisedApp, addedClients, plainSecrets, err = domain.ReviseRegisteredApplication(oldApp, newDoc, newDocBs, s.secrets)
		oldDoc, err := domain.ParseApplicationDocument(oldApp.Document)
		if err != nil {
			return err
		}
		if err := stmts.ReviseApplication(ctx, revisedApp, addedClients); err != nil {
			return err
		}
		if err := storeClientSecrets(ctx, stmts, addedClients, plainSecrets); err != nil {
			return err
		}
		return emitApplicationEvent(ctx, stmts, domain.EventTypeApplicationUpdated, revisedApp, domain.ApplicationPayloadDelta(oldDoc, newDoc, revisedApp, addedClients))
	})

	if err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			if takenErr := s.clientIDTaken(ctx, addedClients); takenErr != nil {
				return nil, takenErr
			}
			return nil, domain.ErrApplicationRevisionConflict().WithParent(err)
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		if _, ok := errors.AsType[*database.UnavailableError](err); ok {
			return nil, domain.ErrUnavailable().WithParent(err)
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to revise application")
	}

	return &CreateApplicationOutput{Application: revisedApp, Secrets: clientSecrets(addedClients, plainSecrets)}, nil
}

// addedClients builds the row of each client of next whose slug is in added,
// in document order.
func addedClients(projectID string, next domain.ApplicationDocument, added []string) []*domain.ApplicationClient {
	clients := make([]*domain.ApplicationClient, 0, len(added))
	for _, client := range next.Clients {
		if !slices.Contains(added, client.Slug) {
			continue
		}
		stored := &domain.ApplicationClient{ProjectID: projectID, Slug: client.Slug}
		if client.ClientID != nil {
			stored.ClientID = *client.ClientID
		}
		clients = append(clients, stored)
	}
	return clients
}

// newSecrets generates count plaintext client secrets.
func (s *applicationService) newSecrets(count int) ([]string, error) {
	plain := make([]string, 0, count)
	for range count {
		secret, err := s.secrets.New(string(domain.PrefixApplicationClient))
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to generate client secret")
		}
		plain = append(plain, secret)
	}
	return plain, nil
}

// storeClientSecrets stores the hash of plain[i] as the secret of clients[i].
// It runs after the write that gave the clients their ids, in the same
// transaction.
func storeClientSecrets(ctx context.Context, stmts AllStatements, clients []*domain.ApplicationClient, plain []string) error {
	for i, client := range clients {
		secret := &domain.ApplicationClientSecret{ProjectID: client.ProjectID, ApplicationClientID: client.ID, SecretHash: domain.HashSecret(plain[i])}
		if err := stmts.CreateApplicationClientSecret(ctx, secret); err != nil {
			return err
		}
	}
	return nil
}

// clientIDTaken runs after a unique error, to tell whether the client_id index
// was the one hit: it returns client_id_taken when another client of the
// project holds the client_id of one of clients, and nil when none does.
func (s *applicationService) clientIDTaken(ctx context.Context, clients []*domain.ApplicationClient) error {
	for _, client := range clients {
		_, err := s.v2Pool.Statements().GetApplicationClientByClientID(ctx, client.ProjectID, client.ClientID)
		if err == nil {
			return domain.ErrApplicationClientIDTaken().WithDetails(map[string]string{"client_id": client.ClientID})
		}
		if _, ok := errors.AsType[*database.UnavailableError](err); ok {
			return domain.ErrUnavailable().WithParent(err)
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
	if _, ok := errors.AsType[*database.UnavailableError](err); ok {
		return nil, domain.ErrUnavailable().WithParent(err)
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

// declaredWriteRefusals is everything that refuses a release declaring next,
// read on stmts inside the build's transaction and before any write, so every
// refusal lands in the build's failures: a slug the API registered, a changed
// client_id, a client_id another client of the project holds or once held,
// and a secret variable another client of the project names or once named.
// The error is a failed read.
func (s *applicationService) declaredWriteRefusals(ctx context.Context, stmts AllStatements, projectID string, next domain.ApplicationDocument) ([]error, error) {
	var (
		applicationID string
		stored        []*domain.ApplicationClient
	)
	existing, err := stmts.GetApplication(ctx, applicationBy(projectID, domain.ApplicationFieldSlug, next.Slug))
	if err == nil {
		if !existing.IsDeclared {
			return []error{domain.ErrApplicationRegistered()}, nil
		}
		applicationID = existing.ID
		if stored, err = stmts.ListApplicationClients(ctx, projectID, existing.ID); err != nil {
			return nil, applicationReadError(err)
		}
	} else if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
		return nil, applicationReadError(err)
	}
	var refusals []error
	if _, err := domain.DeclaredClientsToCreate(stored, next); err != nil {
		refusals = append(refusals, err)
	}
	storedIDs := make(map[string]string, len(stored))
	for _, client := range stored {
		storedIDs[client.Slug] = client.ID
	}
	variables := make(map[string]string)
	for i, client := range next.Clients {
		holder, err := stmts.GetApplicationClientByClientID(ctx, projectID, *client.ClientID)
		if err == nil && (holder.ApplicationID != applicationID || holder.Slug != client.Slug) {
			refusals = append(refusals, domain.ErrApplicationClientIDTaken().WithDetails(map[string]string{"client_id": *client.ClientID}))
		} else if _, ok := errors.AsType[*database.NoRowFoundError](err); err != nil && !ok {
			return nil, applicationReadError(err)
		}
		name, ok := client.SecretVariable()
		if !ok {
			continue
		}
		claim, err := stmts.GetApplicationSecretVariable(ctx, projectID, name)
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			continue
		}
		if err != nil {
			return nil, applicationReadError(err)
		}
		if id, ok := storedIDs[client.Slug]; !ok || claim.ApplicationClientID != id {
			variables[fmt.Sprintf("/clients/%d/secret", i)] = "another client in the project names this variable"
		}
	}
	if len(variables) > 0 {
		refusals = append(refusals, domain.ErrApplicationInvalid(variables, nil))
	}
	return refusals, nil
}

// resolveOrCreateDeclared writes the application a release declares, on stmts
// inside the build's transaction: a new slug creates it, a document equal to
// its newest revision reuses that revision, and any other appends one. Each
// client's secret variable is claimed for that client. The caller validated
// document and found no declaredWriteRefusals. A declared client's secret is
// a variable, so no secret is generated.
//
// A concurrent build or API call can still take the slug or a client_id
// first. Then the refusal it causes is returned, and when there is none, the
// write goes on against what the other writer stored.
func (s *applicationService) resolveOrCreateDeclared(ctx context.Context, stmts AllStatements, projectID string, next domain.ApplicationDocument, document []byte) (*domain.Application, error) {
	existing, err := stmts.GetApplication(ctx, applicationBy(projectID, domain.ApplicationFieldSlug, next.Slug))
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		added, err := domain.DeclaredClientsToCreate(nil, next)
		if err != nil {
			return nil, err
		}
		clients := addedClients(projectID, next, added)
		entity := &domain.Application{ProjectID: projectID, Slug: next.Slug, IsDeclared: true, Document: document}
		err = stmts.CreateApplication(ctx, entity, clients)
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			refusals, readErr := s.declaredWriteRefusals(ctx, stmts, projectID, next)
			if readErr != nil {
				return nil, readErr
			}
			if len(refusals) > 0 {
				return nil, refusals[0]
			}
			if existing, err = stmts.GetApplication(ctx, applicationBy(projectID, domain.ApplicationFieldSlug, next.Slug)); err != nil {
				return nil, declaredWriteError(err)
			}
			return s.reviseDeclared(ctx, stmts, existing, next, document)
		}
		if err != nil {
			return nil, declaredWriteError(err)
		}
		if err := claimSecretVariables(ctx, stmts, next, clients); err != nil {
			return nil, err
		}
		return entity, emitApplicationEvent(ctx, stmts, domain.EventTypeApplicationCreated, entity, domain.ApplicationPayloadSnapshot(entity, next, clients))
	}
	if err != nil {
		return nil, applicationReadError(err)
	}
	return s.reviseDeclared(ctx, stmts, existing, next, document)
}

// reviseDeclared is resolveOrCreateDeclared for a slug already stored.
func (s *applicationService) reviseDeclared(ctx context.Context, stmts AllStatements, existing *domain.Application, next domain.ApplicationDocument, document []byte) (*domain.Application, error) {
	if err := stmts.LockApplication(ctx, existing.ProjectID, existing.ID); err != nil {
		return nil, declaredWriteError(err)
	}
	current, err := stmts.GetApplication(ctx, applicationBy(existing.ProjectID, domain.ApplicationFieldID, existing.ID))
	if err != nil {
		return nil, applicationReadError(err)
	}
	if !current.IsDeclared {
		return nil, domain.ErrApplicationRegistered()
	}
	same, err := domain.JSONEqual(current.Document, document)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to compare application documents")
	}
	if same {
		return current, nil
	}
	stored, err := stmts.ListApplicationClients(ctx, current.ProjectID, current.ID)
	if err != nil {
		return nil, applicationReadError(err)
	}
	added, err := domain.DeclaredClientsToCreate(stored, next)
	if err != nil {
		return nil, err
	}
	previous, err := domain.ParseApplicationDocument(current.Document)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to parse stored application")
	}
	clients := addedClients(current.ProjectID, next, added)
	entity := &domain.Application{
		ProjectID:  current.ProjectID,
		ID:         current.ID,
		Slug:       current.Slug,
		IsDeclared: true,
		Document:   document,
		CreatedAt:  current.CreatedAt,
	}
	if err := stmts.ReviseApplication(ctx, entity, clients); err != nil {
		return nil, declaredWriteError(err)
	}
	if err := claimSecretVariables(ctx, stmts, next, append(stored, clients...)); err != nil {
		return nil, err
	}
	return entity, emitApplicationEvent(ctx, stmts, domain.EventTypeApplicationUpdated, entity, domain.ApplicationPayloadDelta(previous, next, entity, clients))
}

// claimSecretVariables stores, for each client of next that names a secret
// variable, the claim that the name is that client's. stored holds the
// application's client rows, the ones the write just added among them. A name
// the client claimed before is left as it is.
func claimSecretVariables(ctx context.Context, stmts AllStatements, next domain.ApplicationDocument, stored []*domain.ApplicationClient) error {
	for _, client := range next.Clients {
		name, ok := client.SecretVariable()
		if !ok {
			continue
		}
		i := slices.IndexFunc(stored, func(row *domain.ApplicationClient) bool { return row.Slug == client.Slug })
		row := stored[i]
		claim, err := stmts.GetApplicationSecretVariable(ctx, row.ProjectID, name)
		if err == nil && claim.ApplicationClientID == row.ID {
			continue
		}
		if _, ok := errors.AsType[*database.NoRowFoundError](err); err != nil && !ok {
			return applicationReadError(err)
		}
		if err := stmts.CreateApplicationSecretVariable(ctx, &domain.ApplicationSecretVariable{
			ProjectID:           row.ProjectID,
			Name:                name,
			ApplicationClientID: row.ID,
		}); err != nil {
			return declaredWriteError(err)
		}
	}
	return nil
}

// declaredWriteError maps a failed write of a declared application. A unique
// index tripped after declaredWriteRefusals passed means a concurrent build or
// API call wrote the same revision instant or claimed the same variable
// first; building again sees its result.
func declaredWriteError(err error) error {
	if _, ok := errors.AsType[*database.UniqueError](err); ok {
		return domain.ErrApplicationRevisionConflict().WithParent(err)
	}
	return applicationReadError(err)
}

func (s *applicationService) Client(ctx context.Context, projectID, clientID string) (_ *ServedApplicationClient, err error) {
	ctx, end := startSpan(ctx, "ApplicationService.Client")
	defer end(&err)

	stmts := s.v2Pool.Statements()
	stored, err := stmts.GetApplicationClientByClientID(ctx, projectID, clientID)
	if err != nil {
		return nil, clientLookupError(err)
	}
	entity, err := stmts.GetApplication(ctx, applicationBy(projectID, domain.ApplicationFieldID, stored.ApplicationID))
	if err != nil {
		return nil, clientLookupError(err)
	}
	if entity.IsDeclared {
		pins, err := runtimePins(ctx, domain.ReleasePointerKindApplication)
		if err != nil {
			return nil, err
		}
		pin, ok := pins[entity.Slug]
		if !ok {
			return nil, domain.ErrApplicationClientNotFound()
		}
		if entity, err = stmts.GetApplicationRevision(ctx, projectID, pin.RevisionID); err != nil {
			return nil, clientLookupError(err)
		}
	}
	doc, err := domain.ParseApplicationDocument(entity.Document)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to parse stored application")
	}
	i := slices.IndexFunc(doc.Clients, func(client domain.ApplicationClientDocument) bool { return client.Slug == stored.Slug })
	if i < 0 {
		// The pinned revision predates the client: the release does not serve it.
		return nil, domain.ErrApplicationClientNotFound()
	}
	return &ServedApplicationClient{Application: entity, Document: doc.Clients[i], Stored: stored}, nil
}

func (s *applicationService) AuthenticateClient(ctx context.Context, projectID, clientID, secret string) (_ *ServedApplicationClient, err error) {
	ctx, end := startSpan(ctx, "ApplicationService.AuthenticateClient")
	defer end(&err)

	served, err := s.Client(ctx, projectID, clientID)
	if err != nil {
		return nil, err
	}
	if !served.Document.IsConfidential() || secret == "" {
		return nil, domain.ErrApplicationClientSecretInvalid()
	}
	if served.Application.IsDeclared {
		name, ok := served.Document.SecretVariable()
		if !ok {
			return nil, domain.ErrApplicationClientSecretInvalid()
		}
		want, err := secretVariable(ctx, s.variables, decrypterOfWritingKey(ctx, s.keys), projectID, sealedDeploymentID(ctx), name)
		if err != nil {
			return nil, err
		}
		if want == "" {
			// The deploy refuses a release whose secret variable is not a
			// secret, so this is the server's fault, not the caller's.
			return nil, domain.ErrInternal(nil).WithMessage("declared client secret variable is missing, not a secret, or not a string").
				WithDetails(map[string]string{"variable": name})
		}
		// Hashes of equal length, so the comparison's time does not reveal
		// the secret's length.
		if subtle.ConstantTimeCompare([]byte(domain.HashSecret(want)), []byte(domain.HashSecret(secret))) != 1 {
			return nil, domain.ErrApplicationClientSecretInvalid()
		}
		return served, nil
	}
	hashes, err := s.v2Pool.Statements().ListApplicationClientSecrets(ctx, projectID, served.Stored.ID)
	if err != nil {
		return nil, applicationReadError(err)
	}
	presented := domain.HashSecret(secret)
	for _, hash := range hashes {
		if subtle.ConstantTimeCompare([]byte(hash.SecretHash), []byte(presented)) == 1 {
			return served, nil
		}
	}
	return nil, domain.ErrApplicationClientSecretInvalid()
}

// clientLookupError answers a missing row as a client the request does not
// serve, and anything else as a read error, so an outage never reads as an
// unknown client.
func clientLookupError(err error) error {
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return domain.ErrApplicationClientNotFound()
	}
	return applicationReadError(err)
}

// applicationReadError maps a failed statement that is not a refusal.
func applicationReadError(err error) error {
	if _, ok := errors.AsType[*database.UnavailableError](err); ok {
		return domain.ErrUnavailable().WithParent(err)
	}
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
	}
	return domain.ErrInternal(err).WithMessage("failed to read or write application")
}
