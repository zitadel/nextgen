package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/appstore"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// AppView is an app at one revision with the client_id of each client that
// revision lists, in document order.
type AppView struct {
	App     *domain.App
	Clients []*domain.AppClientID
}

type CreateAppOutput struct {
	AppView
	// Created tells a new app from a new revision of an existing one, which
	// the caller answers 200 to rather than 201.
	Created bool
	// Secrets are the secrets this write generated, by client slug: the
	// credential named `initial` of each new confidential client of a
	// registered app that holds no key. They are returned once and stored
	// only as hashes.
	Secrets map[string]GeneratedSecret
}

// GeneratedSecret is a secret the server generated, with the credential that
// holds it.
type GeneratedSecret struct {
	CredentialID string
	Secret       string
}

type ListAppsInput struct {
	ProjectID string
	Sorting   *Sorting // optional; defaults to created_at asc
	Filters   []Filter
	Limit     int
	PageToken string
}

type ListAppRevisionsInput struct {
	ProjectID string
	ID        string
	Limit     int
	PageToken string
}

type ListAppsOutput struct {
	Items         []*AppView
	NextPageToken string
}

// AddAppClientCredentialInput adds a named credential to a confidential
// client of a declared or a registered app. With none of Secret, Hash and
// PublicKey the server generates a secret; Secret imports a plaintext value,
// Hash an encoded hash another system wrote, such as v4's bcrypt, and
// PublicKey a JWK the client signs private_key_jwt assertions with.
type AddAppClientCredentialInput struct {
	ProjectID  string
	AppID      string
	ClientSlug string
	Name       string
	Secret     string
	Hash       string
	PublicKey  json.RawMessage
	ExpiresAt  *time.Time
}

type AddAppClientCredentialOutput struct {
	Credential *domain.AppClientCredential
	ClientID   string
	// Secret is the generated value, empty for an import or a key. Shown
	// once.
	Secret string
}

// AppClientCredentials are the credentials a client holds through the API.
type AppClientCredentials struct {
	ClientID    string
	Credentials []*domain.AppClientCredential
}

type AppService interface {
	// CreateOrRevise writes document as a registered app: a new app when its
	// slug is new in the project, a new revision of the registered app with
	// that slug otherwise. An app the release declares is refused.
	CreateOrRevise(ctx context.Context, projectID string, document []byte) (*CreateAppOutput, error)
	Get(ctx context.Context, projectID, id string) (*AppView, error)
	GetRevision(ctx context.Context, projectID, revisionID string) (*AppView, error)
	List(ctx context.Context, input ListAppsInput) (*ListAppsOutput, error)
	ListRevisions(ctx context.Context, input ListAppRevisionsInput) (*ListAppsOutput, error)
	AddClientCredential(ctx context.Context, input AddAppClientCredentialInput) (*AddAppClientCredentialOutput, error)
	ListClientCredentials(ctx context.Context, projectID, appID, clientSlug string) (*AppClientCredentials, error)
	RevokeClientCredential(ctx context.Context, projectID, appID, clientSlug, credentialID string) error
}

// ImportedHashVerifier reads hashes other systems wrote (bcrypt, argon2,
// scrypt, pbkdf2 and the rest passwap knows), for imported client secrets.
type ImportedHashVerifier interface {
	crypto.HashVerifier
	crypto.HashValidator
}

type appService struct {
	v2Pool   *DB
	schemas  BuiltinSchemaProvider
	imported ImportedHashVerifier
}

func NewAppService(v2Pool *DB, schemas BuiltinSchemaProvider, imported ImportedHashVerifier) *appService {
	return &appService{v2Pool: v2Pool, schemas: schemas, imported: imported}
}

// errAppSlugTaken reports that create lost the race for a slug.
var errAppSlugTaken = errors.New("app slug taken")

// ErrAppRegistered refuses a release that declares an app the API registered:
// every app has one writer, and a release never takes over an app someone
// else wrote.
func ErrAppRegistered() domain.Error {
	return domain.ErrAppDeclared().WithMessage("app: registered through the API, so a release cannot declare it")
}

func (s *appService) CreateOrRevise(ctx context.Context, projectID string, document []byte) (_ *CreateAppOutput, err error) {
	ctx, end := startSpan(ctx, "AppService.CreateOrRevise")
	defer end(&err)

	doc, err := s.validate(document, domain.AppSourceRegistered)
	if err != nil {
		return nil, err
	}
	var out *CreateAppOutput
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		var err error
		out, err = s.write(ctx, tx.Statements(), projectID, domain.AppSourceRegistered, doc, document, false)
		return err
	})
	if err != nil {
		return nil, mapAppWriteError(err)
	}
	return out, nil
}

// resolveOrCreateDeclared writes a release's app on stmts: the newest of its
// revisions whose document matches is reused, a changed document appends a
// revision, and a new slug creates the app. The caller validated document.
func (s *appService) resolveOrCreateDeclared(ctx context.Context, stmts AllStatements, projectID string, doc domain.AppDocument, document []byte) (*CreateAppOutput, error) {
	return s.write(ctx, stmts, projectID, domain.AppSourceDeclared, doc, document, true)
}

// write creates or revises the app doc names, on stmts inside the caller's
// transaction. reuse reads back an earlier revision with the same document
// instead of appending one, as a release build does.
func (s *appService) write(ctx context.Context, stmts AllStatements, projectID string, source domain.AppSource, doc domain.AppDocument, document []byte, reuse bool) (*CreateAppOutput, error) {
	existing, err := stmts.GetApp(ctx, appBy(projectID, domain.AppFieldSlug, doc.Slug))
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		entity := &domain.App{ProjectID: projectID, Slug: doc.Slug, Source: source, Document: document}
		if err := stmts.CreateApp(ctx, entity); err != nil {
			if _, ok := errors.AsType[*database.UniqueError](err); ok {
				return nil, fmt.Errorf("%w: %w", errAppSlugTaken, err)
			}
			return nil, err
		}
		out, err := s.afterWrite(ctx, stmts, entity, nil, doc)
		if err != nil {
			return nil, err
		}
		out.Created = true
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	if existing.Source != source {
		if source == domain.AppSourceDeclared {
			return nil, ErrAppRegistered()
		}
		return nil, domain.ErrAppDeclared()
	}
	if err := stmts.LockApp(ctx, projectID, existing.ID); err != nil {
		return nil, err
	}
	current, err := stmts.GetApp(ctx, appBy(projectID, domain.AppFieldID, existing.ID))
	if err != nil {
		return nil, err
	}
	if err := checkDocumentKeys(ctx, stmts, current, doc); err != nil {
		return nil, err
	}
	if reuse {
		match, err := matchingAppRevision(ctx, stmts, current, document)
		if err != nil {
			return nil, err
		}
		if match != nil {
			// The release is back on a document the app had: nothing to write.
			// The index rows were written when that revision was.
			view, err := appView(ctx, stmts, match)
			if err != nil {
				return nil, err
			}
			return &CreateAppOutput{AppView: *view}, nil
		}
	}
	entity := &domain.App{
		ProjectID: current.ProjectID,
		ID:        current.ID,
		Slug:      current.Slug,
		Source:    current.Source,
		Document:  document,
		CreatedAt: current.CreatedAt,
	}
	if err := stmts.ReviseApp(ctx, entity); err != nil {
		return nil, err
	}
	return s.afterWrite(ctx, stmts, entity, current, doc)
}

// afterWrite brings the rows that outlive revisions in step with the revision
// just written, generates the initial secret of a registered app's new
// confidential clients, and emits the event, all in the write's transaction.
func (s *appService) afterWrite(ctx context.Context, stmts AllStatements, entity, previous *domain.App, doc domain.AppDocument) (*CreateAppOutput, error) {
	clients, created, err := syncAppClientIDs(ctx, stmts, entity, doc)
	if err != nil {
		return nil, err
	}
	if err := syncAppIdentifiers(ctx, stmts, entity, doc); err != nil {
		return nil, err
	}
	secrets := map[string]GeneratedSecret{}
	if entity.Source == domain.AppSourceRegistered {
		for i, client := range doc.Clients {
			// A client that brings its keys needs no secret, and an existing
			// client keeps the credentials it has.
			if client.Type != domain.ClientTypeConfidential || len(client.JWKS) > 0 || !created[client.Slug] {
				continue
			}
			plain, encoded, err := newClientSecret()
			if err != nil {
				return nil, err
			}
			credential := &domain.AppClientCredential{
				ProjectID:   entity.ProjectID,
				ClientRowID: clients[i].ID,
				Name:        initialCredentialName,
				Kind:        domain.CredentialKindSecret,
				EncodedHash: encoded,
			}
			if err := stmts.CreateAppClientCredential(ctx, credential); err != nil {
				return nil, err
			}
			if err := emitAppCredentialEvent(ctx, stmts, domain.EventTypeAppCredentialAdded, entity, clients[i], credential, "generated"); err != nil {
				return nil, err
			}
			secrets[client.Slug] = GeneratedSecret{CredentialID: credential.ID, Secret: plain}
		}
	}
	if previous == nil {
		err = emitAppEvent(ctx, stmts, domain.EventTypeAppCreated, entity, domain.AppPayloadSnapshot(entity, doc))
	} else {
		var payload domain.AppPayload
		payload, err = domain.AppPayloadDelta(previous, entity)
		if err == nil {
			err = emitAppEvent(ctx, stmts, domain.EventTypeAppUpdated, entity, payload)
		}
	}
	if err != nil {
		return nil, err
	}
	return &CreateAppOutput{AppView: AppView{App: entity, Clients: clients}, Secrets: secrets}, nil
}

// initialCredentialName names the secret a registered app's new confidential
// client gets with the write that creates it.
const initialCredentialName = "initial"

// syncAppClientIDs gives each client doc lists its client_id: the one its row
// already holds, the one the document chose, or a minted one. It returns the
// rows in document order and the slugs of the clients this write created. A
// chosen id that differs from the client's stored one is refused, and so is
// one another client holds.
func syncAppClientIDs(ctx context.Context, stmts AllStatements, entity *domain.App, doc domain.AppDocument) ([]*domain.AppClientID, map[string]bool, error) {
	stored, err := stmts.ListAppClientIDs(ctx, entity.ProjectID, entity.ID)
	if err != nil {
		return nil, nil, err
	}
	bySlug := indexByID(stored, func(row *domain.AppClientID) string { return row.Slug })
	rows := make([]*domain.AppClientID, len(doc.Clients))
	created := map[string]bool{}
	for i, client := range doc.Clients {
		if row, ok := bySlug[client.Slug]; ok {
			if client.ClientID != "" && client.ClientID != row.ClientID {
				return nil, nil, domain.ErrAppFieldImmutable(map[string]string{"field": fmt.Sprintf("/clients/%d/client_id", i)})
			}
			rows[i] = row
			continue
		}
		if client.ClientID != "" {
			if _, err := stmts.GetAppClientIDByClientID(ctx, entity.ProjectID, client.ClientID); err == nil {
				return nil, nil, domain.ErrAppClientIDTaken(map[string]string{"field": fmt.Sprintf("/clients/%d/client_id", i)})
			} else if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
				return nil, nil, err
			}
		}
		row := &domain.AppClientID{ProjectID: entity.ProjectID, AppID: entity.ID, Slug: client.Slug, ClientID: client.ClientID}
		if err := stmts.CreateAppClientID(ctx, row); err != nil {
			if _, ok := errors.AsType[*database.UniqueError](err); ok {
				return nil, nil, domain.ErrAppClientIDTaken(map[string]string{"field": fmt.Sprintf("/clients/%d/client_id", i)}).WithParent(err)
			}
			return nil, nil, err
		}
		rows[i] = row
		created[client.Slug] = true
	}
	return rows, created, nil
}

// syncAppIdentifiers ties each API identifier doc lists to the app, for good.
// One another app holds is refused.
func syncAppIdentifiers(ctx context.Context, stmts AllStatements, entity *domain.App, doc domain.AppDocument) error {
	for i, identifier := range doc.Identifiers() {
		held, err := stmts.GetAppAPIIdentifier(ctx, entity.ProjectID, identifier)
		if err == nil {
			if held.AppID != entity.ID {
				return domain.ErrAppIdentifierTaken(map[string]string{"field": fmt.Sprintf("/apis/%d/identifier", i)})
			}
			continue
		}
		if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
			return err
		}
		row := &domain.AppAPIIdentifier{ProjectID: entity.ProjectID, Identifier: identifier, AppID: entity.ID}
		if err := stmts.CreateAppAPIIdentifier(ctx, row); err != nil {
			if _, ok := errors.AsType[*database.UniqueError](err); ok {
				return domain.ErrAppIdentifierTaken(map[string]string{"field": fmt.Sprintf("/apis/%d/identifier", i)}).WithParent(err)
			}
			return err
		}
	}
	return nil
}

// matchingAppRevision returns the newest revision of app whose document
// equals want, or nil when none does.
func matchingAppRevision(ctx context.Context, stmts AllStatements, app *domain.App, want []byte) (*domain.App, error) {
	same, err := domain.JSONEqual(app.Document, want)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to compare app documents")
	}
	if same {
		return app, nil
	}
	result, err := stmts.ListAppRevisions(WithAuthzListUnrestricted(ctx), app.ProjectID, app.ID, database.Page[domain.AppField]{
		Limit:   maxHistoricalRevisions,
		OrderBy: appstore.RevisionsNewestFirst(),
	})
	if err != nil {
		return nil, err
	}
	for _, item := range result.Items {
		same, err := domain.JSONEqual(item.Document, want)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to compare app documents")
		}
		if same {
			return item, nil
		}
	}
	return nil, nil
}

// validate checks document against the app.json meta-schema and the rules
// across its fields, for an app source writes, and returns it parsed.
func (s *appService) validate(document []byte, source domain.AppSource) (domain.AppDocument, error) {
	uri, err := s.schemas.LatestSchemaURI(domain.SchemaKindApp)
	if err != nil {
		return domain.AppDocument{}, domain.ErrInternal(err).WithMessage("app schema not registered")
	}
	schema, err := s.schemas.GetBuiltinSchema(uri)
	if err != nil {
		return domain.AppDocument{}, domain.ErrInternal(err).WithMessage("app schema not compiled")
	}
	var raw map[string]any
	if err := json.Unmarshal(document, &raw); err != nil {
		return domain.AppDocument{}, domain.ErrAppInvalid(nil).WithParent(err)
	}
	if err := schema.Validate(raw); err != nil {
		return domain.AppDocument{}, domain.ErrAppInvalid(domain.FlattenValidationErrors(err)).WithParent(err)
	}
	doc, err := domain.ParseAppDocument(document)
	if err != nil {
		return domain.AppDocument{}, domain.ErrAppInvalid(nil).WithParent(err)
	}
	if err := doc.Validate(source); err != nil {
		return domain.AppDocument{}, err
	}
	return doc, nil
}

func mapAppWriteError(err error) error {
	if errors.Is(err, errAppSlugTaken) {
		// Another caller created the slug between the read and the insert.
		return domain.ErrAppRevisionConflict().WithParent(err)
	}
	// A domain error first: one that wraps the unique violation it reports,
	// such as a taken client_id or credential name, keeps its own code.
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
	}
	if _, ok := errors.AsType[*database.UniqueError](err); ok {
		// Two revisions of one app on the same instant have no newest.
		return domain.ErrAppRevisionConflict().WithParent(err)
	}
	if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		// project_id is the only foreign key on a new app, so the project was
		// deleted underneath the call.
		return domain.ErrAppNotFound().WithParent(err)
	}
	return domain.ErrInternal(err).WithMessage("failed to write app")
}

func (s *appService) Get(ctx context.Context, projectID, id string) (_ *AppView, err error) {
	ctx, end := startSpan(ctx, "AppService.Get")
	defer end(&err)

	stmts := s.v2Pool.Statements()
	entity, err := stmts.GetApp(ctx, appBy(projectID, domain.AppFieldID, id))
	if err != nil {
		return nil, mapAppReadError(err)
	}
	return appView(ctx, stmts, entity)
}

func (s *appService) GetRevision(ctx context.Context, projectID, revisionID string) (_ *AppView, err error) {
	ctx, end := startSpan(ctx, "AppService.GetRevision")
	defer end(&err)

	stmts := s.v2Pool.Statements()
	entity, err := stmts.GetAppRevision(ctx, projectID, revisionID)
	if err != nil {
		return nil, mapAppReadError(err)
	}
	return appView(ctx, stmts, entity)
}

// List returns each app of the project once, at its newest revision.
func (s *appService) List(ctx context.Context, input ListAppsInput) (_ *ListAppsOutput, err error) {
	ctx, end := startSpan(ctx, "AppService.List")
	defer end(&err)

	filters := []database.Filter[domain.AppField]{database.Equal(database.Col(domain.AppFieldProjectID), input.ProjectID)}
	for _, f := range input.Filters {
		filter, err := appFilter(f)
		if err != nil {
			return nil, err
		}
		filters = append(filters, filter)
	}
	orderBy, err := listOrderBy(input.Sorting, domain.AppFieldCreatedAt, database.OrderAsc, appField, domain.AppFieldID)
	if err != nil {
		return nil, err
	}
	stmts := s.v2Pool.Statements()
	result, err := stmts.ListApps(ctx, &database.ListOptions[domain.AppField]{
		Filter: database.And(filters...),
		Pagination: database.Page[domain.AppField]{
			Limit:   uint32(normalizeLimit(input.Limit)),
			OrderBy: orderBy,
			Cursor:  []byte(input.PageToken),
		},
	})
	if err != nil {
		return nil, mapListError(err, "failed to list apps")
	}
	return appViews(ctx, stmts, result)
}

// ListRevisions pages one app's revisions, newest first.
func (s *appService) ListRevisions(ctx context.Context, input ListAppRevisionsInput) (_ *ListAppsOutput, err error) {
	ctx, end := startSpan(ctx, "AppService.ListRevisions")
	defer end(&err)

	// The revisions statement answers an unknown app with an empty page, so
	// the lookup is what tells a miss from an app's history.
	if _, err := s.Get(ctx, input.ProjectID, input.ID); err != nil {
		return nil, err
	}
	stmts := s.v2Pool.Statements()
	result, err := stmts.ListAppRevisions(ctx, input.ProjectID, input.ID, database.Page[domain.AppField]{
		Limit:   uint32(normalizeLimit(input.Limit)),
		OrderBy: appstore.RevisionsNewestFirst(),
		Cursor:  []byte(input.PageToken),
	})
	if err != nil {
		return nil, mapListError(err, "failed to list app revisions")
	}
	return appViews(ctx, stmts, result)
}

func appViews(ctx context.Context, stmts AllStatements, result *database.ListResult[*domain.App]) (*ListAppsOutput, error) {
	out := &ListAppsOutput{Items: make([]*AppView, 0, len(result.Items))}
	for _, item := range result.Items {
		view, err := appView(ctx, stmts, item)
		if err != nil {
			return nil, err
		}
		out.Items = append(out.Items, view)
	}
	out.NextPageToken = string(result.NextCursor)
	return out, nil
}

// appView pairs entity with the client_id of each client its document lists.
func appView(ctx context.Context, stmts AllStatements, entity *domain.App) (*AppView, error) {
	doc, err := domain.ParseAppDocument(entity.Document)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("stored app document does not parse")
	}
	stored, err := stmts.ListAppClientIDs(ctx, entity.ProjectID, entity.ID)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to read client ids")
	}
	bySlug := indexByID(stored, func(row *domain.AppClientID) string { return row.Slug })
	view := &AppView{App: entity}
	for _, client := range doc.Clients {
		if row, ok := bySlug[client.Slug]; ok {
			view.Clients = append(view.Clients, row)
		}
	}
	return view, nil
}

func appBy(projectID string, field domain.AppField, value string) database.Filter[domain.AppField] {
	return database.And(
		database.Equal(database.Col(domain.AppFieldProjectID), projectID),
		database.Equal(database.Col(field), value),
	)
}

func mapAppReadError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return domain.ErrAppNotFound()
	}
	return domain.ErrInternal(err).WithMessage("failed to get app")
}

// appFilter maps an API filter predicate to a storage filter.
func appFilter(f Filter) (database.Filter[domain.AppField], error) {
	var field domain.AppField
	switch f.Field {
	case "created_at":
		return createdAtFilter(f.Operation, database.Col(domain.AppFieldCreatedAt), f.Value)
	case "slug":
		field = domain.AppFieldSlug
	case "source":
		field = domain.AppFieldSource
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", f.Field))
	}
	value, err := stringFilterValue(f)
	if err != nil {
		return nil, err
	}
	return stringFilter(f.Operation, database.Col(field), value)
}

// appField maps an API sort field to its [domain.AppField].
func appField(field string) (domain.AppField, error) {
	switch field {
	case "created_at":
		return domain.AppFieldCreatedAt, nil
	case "slug":
		return domain.AppFieldSlug, nil
	default:
		return domain.AppFieldUnspecified, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown field %q", field))
	}
}

// maxClientCredentials bounds the credentials one client holds, so a list
// needs no paging and a token request checks a handful of hashes.
const maxClientCredentials = 20

func (s *appService) AddClientCredential(ctx context.Context, input AddAppClientCredentialInput) (_ *AddAppClientCredentialOutput, err error) {
	ctx, end := startSpan(ctx, "AppService.AddClientCredential")
	defer end(&err)

	given := 0
	for _, set := range []bool{input.Secret != "", input.Hash != "", len(input.PublicKey) > 0} {
		if set {
			given++
		}
	}
	if given > 1 {
		return nil, domain.ErrAppInvalid(nil).WithMessage("app: give a secret, a hash or a public key, not several")
	}
	credential := &domain.AppClientCredential{
		ProjectID: input.ProjectID,
		Name:      input.Name,
		Kind:      domain.CredentialKindSecret,
		ExpiresAt: input.ExpiresAt,
	}
	out := &AddAppClientCredentialOutput{Credential: credential}
	origin := "imported"
	switch {
	case len(input.PublicKey) > 0:
		kid, err := domain.PublicJWKKeyID(input.PublicKey)
		if err != nil {
			return nil, domain.ErrAppInvalid(map[string]string{"field": "public_key"}).WithParent(err).WithMessage("app: " + err.Error())
		}
		credential.Kind, credential.PublicKey, credential.KeyID = domain.CredentialKindKey, input.PublicKey, kid
		origin = ""
	case input.Hash != "":
		if err := s.imported.ValidateHash(input.Hash); err != nil {
			return nil, domain.ErrAppInvalid(map[string]string{"field": "hash"}).WithParent(err).WithMessage("app: the hash is in no format the server reads")
		}
		credential.EncodedHash = input.Hash
	case input.Secret != "":
		// A value in the generated form is checked by its checksum before any
		// hash runs, so one that fails it could never authenticate.
		if !clientSecretWellFormed(input.Secret) {
			return nil, domain.ErrAppInvalid(map[string]string{"field": "secret"}).
				WithMessage("app: a secret with the " + clientSecretPrefix + " prefix must be one the server generated, and its checksum fails")
		}
		credential.EncodedHash = sha256Encoded(input.Secret)
	default:
		origin = "generated"
		out.Secret, credential.EncodedHash, err = newClientSecret()
		if err != nil {
			return nil, err
		}
	}
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		entity, row, err := lockedClient(ctx, stmts, input.ProjectID, input.AppID, input.ClientSlug)
		if err != nil {
			return err
		}
		doc, err := domain.ParseAppDocument(entity.Document)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("stored app document does not parse")
		}
		// A client the newest revision removed takes no new credential.
		client, ok := doc.Client(input.ClientSlug)
		if !ok {
			return domain.ErrAppClientNotFound()
		}
		if client.Type != domain.ClientTypeConfidential {
			return domain.ErrAppInvalid(nil).WithMessage("app: a public client holds no credential: it proves itself with PKCE")
		}
		stored, err := stmts.ListAppClientCredentials(ctx, input.ProjectID, row.ID)
		if err != nil {
			return err
		}
		if len(stored) >= maxClientCredentials {
			return domain.ErrAppInvalid(nil).WithMessage(fmt.Sprintf("app: a client holds at most %d credentials; revoke one first", maxClientCredentials))
		}
		if credential.Kind == domain.CredentialKindKey {
			if slices.ContainsFunc(stored, func(c *domain.AppClientCredential) bool { return c.KeyID == credential.KeyID }) {
				return domain.ErrAppCredentialTaken(map[string]string{"field": "public_key/kid"})
			}
			clash, err := documentKeyClash(ctx, stmts, entity, client, credential.KeyID, credential.PublicKey)
			if err != nil {
				return err
			}
			if clash {
				return domain.ErrAppCredentialTaken(map[string]string{"field": "public_key/kid"}).
					WithMessage(fmt.Sprintf("app: kid %q names another key in the client's jwks, at the newest revision or one a deployment may serve", credential.KeyID))
			}
		}
		credential.ClientRowID = row.ID
		if err := stmts.CreateAppClientCredential(ctx, credential); err != nil {
			if _, ok := errors.AsType[*database.UniqueError](err); ok {
				return domain.ErrAppCredentialTaken(map[string]string{"field": "name"}).WithParent(err)
			}
			return err
		}
		out.ClientID = row.ClientID
		return emitAppCredentialEvent(ctx, stmts, domain.EventTypeAppCredentialAdded, entity, row, credential, origin)
	})
	if err != nil {
		return nil, mapAppWriteError(err)
	}
	return out, nil
}

func (s *appService) ListClientCredentials(ctx context.Context, projectID, appID, clientSlug string) (_ *AppClientCredentials, err error) {
	ctx, end := startSpan(ctx, "AppService.ListClientCredentials")
	defer end(&err)

	stmts := s.v2Pool.Statements()
	_, row, err := appClient(ctx, stmts, projectID, appID, clientSlug)
	if err != nil {
		return nil, err
	}
	stored, err := stmts.ListAppClientCredentials(ctx, projectID, row.ID)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list client credentials")
	}
	return &AppClientCredentials{ClientID: row.ClientID, Credentials: stored}, nil
}

func (s *appService) RevokeClientCredential(ctx context.Context, projectID, appID, clientSlug, credentialID string) (err error) {
	ctx, end := startSpan(ctx, "AppService.RevokeClientCredential")
	defer end(&err)

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		entity, row, err := lockedClient(ctx, stmts, projectID, appID, clientSlug)
		if err != nil {
			return err
		}
		stored, err := stmts.ListAppClientCredentials(ctx, projectID, row.ID)
		if err != nil {
			return err
		}
		i := slices.IndexFunc(stored, func(c *domain.AppClientCredential) bool { return c.ID == credentialID })
		if i < 0 {
			return domain.ErrAppCredentialNotFound()
		}
		if err := stmts.DeleteAppClientCredential(ctx, projectID, row.ID, credentialID); err != nil {
			return err
		}
		return emitAppCredentialEvent(ctx, stmts, domain.EventTypeAppCredentialRevoked, entity, row, stored[i], "")
	})
	if err != nil {
		return mapAppWriteError(err)
	}
	return nil
}

// appClient reads the app id names at its newest revision and the row of the
// client slug names. Credentials hang off that row, which outlives revisions:
// a client a newer revision removed keeps it, and a deployment that pins an
// older revision still accepts the client's credentials, so they stay listed
// and revocable.
func appClient(ctx context.Context, stmts AllStatements, projectID, appID, slug string) (*domain.App, *domain.AppClientID, error) {
	entity, err := stmts.GetApp(ctx, appBy(projectID, domain.AppFieldID, appID))
	if err != nil {
		return nil, nil, mapAppReadError(err)
	}
	rows, err := stmts.ListAppClientIDs(ctx, projectID, entity.ID)
	if err != nil {
		return nil, nil, err
	}
	i := slices.IndexFunc(rows, func(row *domain.AppClientID) bool { return row.Slug == slug })
	if i < 0 {
		return nil, nil, domain.ErrAppClientNotFound()
	}
	return entity, rows[i], nil
}

// lockedClient is appClient under the app's lock, so credential writes to one
// app serialize with each other and with its revisions, and a kid or the count
// is checked against what is stored.
func lockedClient(ctx context.Context, stmts AllStatements, projectID, appID, slug string) (*domain.App, *domain.AppClientID, error) {
	if err := stmts.LockApp(ctx, projectID, appID); err != nil {
		return nil, nil, mapAppReadError(err)
	}
	return appClient(ctx, stmts, projectID, appID, slug)
}

// documentKeys returns the keys in the client's document by kid. A set's
// only key may have none, and is left out.
func documentKeys(client domain.AppClient) map[string]json.RawMessage {
	var set struct {
		Keys []json.RawMessage `json:"keys"`
	}
	if len(client.JWKS) == 0 || json.Unmarshal(client.JWKS, &set) != nil {
		return nil
	}
	keys := make(map[string]json.RawMessage, len(set.Keys))
	for _, raw := range set.Keys {
		var key struct {
			Kid string `json:"kid"`
		}
		if json.Unmarshal(raw, &key) == nil && key.Kid != "" {
			keys[key.Kid] = raw
		}
	}
	return keys
}

// documentKeyClash reports whether kid names a key other than key in the
// client's document: at the newest revision and, for a declared app, at every
// revision, since a deployment serves the one its release pins. A kid names
// one key of a client wherever it sits, so an assertion's kid picks one; the
// same key in the file and through the API is one key, which lets it move
// between them without a gap.
func documentKeyClash(ctx context.Context, stmts AllStatements, entity *domain.App, client domain.AppClient, kid string, key json.RawMessage) (bool, error) {
	clashes := func(client domain.AppClient) bool {
		other, ok := documentKeys(client)[kid]
		return ok && !domain.SamePublicKey(other, key)
	}
	if clashes(client) {
		return true, nil
	}
	if entity.Source != domain.AppSourceDeclared {
		// A registered app serves its newest revision only.
		return false, nil
	}
	page := database.Page[domain.AppField]{Limit: maxListLimit, OrderBy: appstore.RevisionsNewestFirst()}
	for {
		result, err := stmts.ListAppRevisions(WithAuthzListUnrestricted(ctx), entity.ProjectID, entity.ID, page)
		if err != nil {
			return false, err
		}
		for _, revision := range result.Items {
			doc, err := domain.ParseAppDocument(revision.Document)
			if err != nil {
				return false, domain.ErrInternal(err).WithMessage("stored app document does not parse")
			}
			if old, ok := doc.Client(client.Slug); ok && clashes(old) {
				return true, nil
			}
		}
		if len(result.NextCursor) == 0 {
			return false, nil
		}
		page.Cursor = result.NextCursor
	}
}

// checkDocumentKeys refuses a revision whose document gives a client a key
// under the kid of another key the client holds through the API: the
// reciprocal of documentKeyClash, which keeps those keys from taking a kid
// the document has.
func checkDocumentKeys(ctx context.Context, stmts AllStatements, entity *domain.App, doc domain.AppDocument) error {
	if !slices.ContainsFunc(doc.Clients, func(client domain.AppClient) bool { return len(client.JWKS) > 0 }) {
		return nil
	}
	rows, err := stmts.ListAppClientIDs(ctx, entity.ProjectID, entity.ID)
	if err != nil {
		return err
	}
	for i, client := range doc.Clients {
		keys := documentKeys(client)
		j := slices.IndexFunc(rows, func(row *domain.AppClientID) bool { return row.Slug == client.Slug })
		if len(keys) == 0 || j < 0 {
			continue
		}
		stored, err := stmts.ListAppClientCredentials(ctx, entity.ProjectID, rows[j].ID)
		if err != nil {
			return err
		}
		for _, credential := range stored {
			if key, ok := keys[credential.KeyID]; ok && credential.Kind == domain.CredentialKindKey && !domain.SamePublicKey(key, credential.PublicKey) {
				return domain.ErrAppCredentialTaken(map[string]string{"field": fmt.Sprintf("/clients/%d/jwks", i)}).
					WithMessage(fmt.Sprintf("app: kid %q in jwks names another key, which the client holds through the API", credential.KeyID))
			}
		}
	}
	return nil
}

// clientSecretPrefix marks a secret the server generated, so a scanner can
// find one that leaked and a log can tell it from a PAT. The exact string is
// open (apps-and-machine-identities note).
const clientSecretPrefix = "zcs_"

// sha256Scheme marks a stored hash the server wrote. A generated secret has
// 256 random bits, so a fast hash is enough, and a slow one would turn every
// bogus token request into CPU load.
const sha256Scheme = "sha256:"

const (
	base62Digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	// secretBodyLength is 256 random bits in base62, and checksumLength a
	// CRC32 in base62, each padded to a fixed width.
	secretBodyLength = 43
	checksumLength   = 6
)

// newClientSecret returns a generated secret and its encoded hash. The secret
// is the prefix, 256 random bits and a CRC32 of both, in base62 at fixed
// widths: it has no `:` to break HTTP Basic, needs no escaping in a URL, and
// a scanner or the server tells a typo from a secret before hashing it.
func newClientSecret() (plain, encoded string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", domain.ErrInternal(err).WithMessage("failed to generate client secret")
	}
	body := clientSecretPrefix + base62(new(big.Int).SetBytes(b), secretBodyLength)
	plain = body + secretChecksum(body)
	return plain, sha256Encoded(plain), nil
}

// clientSecretWellFormed reports whether secret can be one the server
// generated: a generated one's checksum must hold. An imported secret keeps
// the customer's value, which carries no prefix and passes.
func clientSecretWellFormed(secret string) bool {
	if !strings.HasPrefix(secret, clientSecretPrefix) {
		return true
	}
	if len(secret) != len(clientSecretPrefix)+secretBodyLength+checksumLength {
		return false
	}
	body := secret[:len(secret)-checksumLength]
	return subtle.ConstantTimeCompare([]byte(secretChecksum(body)), []byte(secret[len(body):])) == 1
}

func secretChecksum(body string) string {
	return base62(big.NewInt(int64(crc32.ChecksumIEEE([]byte(body)))), checksumLength)
}

// base62 writes n in base62, padded with zeros to width.
func base62(n *big.Int, width int) string {
	digits := make([]byte, 0, width)
	base := big.NewInt(int64(len(base62Digits)))
	rest := new(big.Int).Set(n)
	digit := new(big.Int)
	for rest.Sign() > 0 {
		rest.DivMod(rest, base, digit)
		digits = append(digits, base62Digits[digit.Int64()])
	}
	for len(digits) < width {
		digits = append(digits, '0')
	}
	slices.Reverse(digits)
	return string(digits)
}

func sha256Encoded(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return sha256Scheme + hex.EncodeToString(sum[:])
}

// matchSHA256 compares secret with a hash the server wrote, in constant time.
func matchSHA256(encoded, secret string) bool {
	want, err := hex.DecodeString(strings.TrimPrefix(encoded, sha256Scheme))
	if err != nil {
		return false
	}
	sum := sha256.Sum256([]byte(secret))
	return subtle.ConstantTimeCompare(want, sum[:]) == 1
}

func emitAppEvent(ctx context.Context, stmts AllStatements, eventType domain.EventType, entity *domain.App, payload domain.AppPayload) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       eventType,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "app",
		EntityID:   entity.ID,
		Payload:    payload,
	})
}

func emitAppCredentialEvent(ctx context.Context, stmts AllStatements, eventType domain.EventType, entity *domain.App, client *domain.AppClientID, credential *domain.AppClientCredential, origin string) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       eventType,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "app",
		EntityID:   entity.ID,
		Payload: domain.AppCredentialPayload{
			Client:       client.Slug,
			ClientID:     client.ClientID,
			CredentialID: credential.ID,
			Name:         credential.Name,
			Kind:         string(credential.Kind),
			Origin:       origin,
		},
	})
}
