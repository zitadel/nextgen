package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

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
	// Secrets are the client secrets this write generated, by client slug.
	// They are returned once and stored only as hashes.
	Secrets map[string]string
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

// AddAppClientSecretInput adds a secret to a registered app's confidential
// client. With neither Secret nor Hash the server generates one; Secret
// imports a plaintext value and Hash an encoded hash another system wrote,
// such as v4's bcrypt.
type AddAppClientSecretInput struct {
	ProjectID  string
	AppID      string
	ClientSlug string
	Secret     string
	Hash       string
}

type AddAppClientSecretOutput struct {
	SecretID string
	ClientID string
	// Secret is the generated value, empty for an import. Shown once.
	Secret string
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
	AddClientSecret(ctx context.Context, input AddAppClientSecretInput) (*AddAppClientSecretOutput, error)
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
// just written, generates the secrets a registered app's new confidential
// clients need, and emits the event, all in the write's transaction.
func (s *appService) afterWrite(ctx context.Context, stmts AllStatements, entity, previous *domain.App, doc domain.AppDocument) (*CreateAppOutput, error) {
	clients, err := syncAppClientIDs(ctx, stmts, entity, doc)
	if err != nil {
		return nil, err
	}
	if err := syncAppIdentifiers(ctx, stmts, entity, doc); err != nil {
		return nil, err
	}
	secrets := map[string]string{}
	if entity.Source == domain.AppSourceRegistered {
		for i, client := range doc.Clients {
			// A private_key_jwt client authenticates with its keys.
			if !client.EffectiveAuthMethod().UsesSecret() {
				continue
			}
			stored, err := stmts.ListAppClientSecrets(ctx, entity.ProjectID, clients[i].ID)
			if err != nil {
				return nil, err
			}
			if len(stored) > 0 {
				continue
			}
			plain, encoded, err := newClientSecret()
			if err != nil {
				return nil, err
			}
			secret := &domain.AppClientSecret{ProjectID: entity.ProjectID, ClientRowID: clients[i].ID, EncodedHash: encoded}
			if err := stmts.CreateAppClientSecret(ctx, secret); err != nil {
				return nil, err
			}
			if err := emitAppClientSecretAdded(ctx, stmts, entity, clients[i], secret, "generated"); err != nil {
				return nil, err
			}
			secrets[client.Slug] = plain
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

// syncAppClientIDs gives each client doc lists its client_id: the one its row
// already holds, the one the document chose, or a minted one. It returns the
// rows in document order. A chosen id that differs from the client's stored
// one is refused, and so is one another client holds.
func syncAppClientIDs(ctx context.Context, stmts AllStatements, entity *domain.App, doc domain.AppDocument) ([]*domain.AppClientID, error) {
	stored, err := stmts.ListAppClientIDs(ctx, entity.ProjectID, entity.ID)
	if err != nil {
		return nil, err
	}
	bySlug := indexByID(stored, func(row *domain.AppClientID) string { return row.Slug })
	rows := make([]*domain.AppClientID, len(doc.Clients))
	for i, client := range doc.Clients {
		if row, ok := bySlug[client.Slug]; ok {
			if client.ClientID != "" && client.ClientID != row.ClientID {
				return nil, domain.ErrAppFieldImmutable(map[string]string{"field": fmt.Sprintf("/clients/%d/client_id", i)})
			}
			rows[i] = row
			continue
		}
		if client.ClientID != "" {
			if _, err := stmts.GetAppClientIDByClientID(ctx, entity.ProjectID, client.ClientID); err == nil {
				return nil, domain.ErrAppClientIDTaken(map[string]string{"field": fmt.Sprintf("/clients/%d/client_id", i)})
			} else if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
				return nil, err
			}
		}
		row := &domain.AppClientID{ProjectID: entity.ProjectID, AppID: entity.ID, Slug: client.Slug, ClientID: client.ClientID}
		if err := stmts.CreateAppClientID(ctx, row); err != nil {
			if _, ok := errors.AsType[*database.UniqueError](err); ok {
				return nil, domain.ErrAppClientIDTaken(map[string]string{"field": fmt.Sprintf("/clients/%d/client_id", i)}).WithParent(err)
			}
			return nil, err
		}
		rows[i] = row
	}
	return rows, nil
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
	if _, ok := errors.AsType[*database.UniqueError](err); ok {
		// Two revisions of one app on the same instant have no newest.
		return domain.ErrAppRevisionConflict().WithParent(err)
	}
	if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		// project_id is the only foreign key on a new app, so the project was
		// deleted underneath the call.
		return domain.ErrAppNotFound().WithParent(err)
	}
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
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

func (s *appService) AddClientSecret(ctx context.Context, input AddAppClientSecretInput) (_ *AddAppClientSecretOutput, err error) {
	ctx, end := startSpan(ctx, "AppService.AddClientSecret")
	defer end(&err)

	if input.Secret != "" && input.Hash != "" {
		return nil, domain.ErrAppInvalid(nil).WithMessage("app: give a secret or a hash to import, not both")
	}
	encoded := ""
	switch {
	case input.Hash != "":
		if err := s.imported.ValidateHash(input.Hash); err != nil {
			return nil, domain.ErrAppInvalid(map[string]string{"field": "hash"}).WithParent(err).WithMessage("app: the hash is in no format the server reads")
		}
		encoded = input.Hash
	case input.Secret != "":
		encoded = sha256Encoded(input.Secret)
	}
	out := &AddAppClientSecretOutput{}
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		entity, err := stmts.GetApp(ctx, appBy(input.ProjectID, domain.AppFieldID, input.AppID))
		if err != nil {
			return mapAppReadError(err)
		}
		if entity.Source != domain.AppSourceRegistered {
			return domain.ErrAppDeclared().WithMessage("app: declared in the release, so its secrets are variables")
		}
		doc, err := domain.ParseAppDocument(entity.Document)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("stored app document does not parse")
		}
		client, ok := doc.Client(input.ClientSlug)
		if !ok {
			return domain.ErrAppClientNotFound()
		}
		if !client.EffectiveAuthMethod().UsesSecret() {
			return domain.ErrAppInvalid(nil).WithMessage("app: the client authenticates without a secret: it is public or uses private_key_jwt")
		}
		stored, err := stmts.ListAppClientIDs(ctx, input.ProjectID, entity.ID)
		if err != nil {
			return err
		}
		i := slices.IndexFunc(stored, func(row *domain.AppClientID) bool { return row.Slug == client.Slug })
		if i < 0 {
			return domain.ErrAppClientNotFound()
		}
		origin := "imported"
		if encoded == "" {
			origin = "generated"
			out.Secret, encoded, err = newClientSecret()
			if err != nil {
				return err
			}
		}
		secret := &domain.AppClientSecret{ProjectID: input.ProjectID, ClientRowID: stored[i].ID, EncodedHash: encoded}
		if err := stmts.CreateAppClientSecret(ctx, secret); err != nil {
			return err
		}
		out.SecretID, out.ClientID = secret.ID, stored[i].ClientID
		return emitAppClientSecretAdded(ctx, stmts, entity, stored[i], secret, origin)
	})
	if err != nil {
		return nil, mapAppWriteError(err)
	}
	return out, nil
}

// clientSecretPrefix marks a secret the server generated, so a scanner can
// find one that leaked and a log can tell it from a PAT. The exact string is
// open (apps-and-machine-identities note).
const clientSecretPrefix = "zcs_"

// sha256Scheme marks a stored hash the server wrote. A generated secret has
// 256 random bits, so a fast hash is enough, and a slow one would turn every
// bogus token request into CPU load.
const sha256Scheme = "sha256:"

func newClientSecret() (plain, encoded string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", domain.ErrInternal(err).WithMessage("failed to generate client secret")
	}
	plain = clientSecretPrefix + base64.RawURLEncoding.EncodeToString(b)
	return plain, sha256Encoded(plain), nil
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

func emitAppClientSecretAdded(ctx context.Context, stmts AllStatements, entity *domain.App, client *domain.AppClientID, secret *domain.AppClientSecret, origin string) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeAppClientSecretAdded,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "app",
		EntityID:   entity.ID,
		Payload: domain.AppClientSecretAddedPayload{
			Client:   client.Slug,
			ClientID: client.ClientID,
			SecretID: secret.ID,
			Origin:   origin,
		},
	})
}
