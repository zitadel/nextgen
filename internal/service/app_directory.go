package service

import (
	"context"
	"crypto/subtle"
	"errors"
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// AppLookup says which apps serve a request: the issuer's project, and the
// deployment the request resolved (ADR 081 §10). Declared apps are read at
// the revision that deployment's release pins; without a deployment, at their
// newest revision, as for every kind a request resolves no release for.
type AppLookup struct {
	ProjectID    string
	DeploymentID string
}

// AppDirectory is how the authorization server finds the clients and APIs a
// request names, whoever wrote the app: the server's own built-in apps, apps
// declared in the release, and apps registered through the API. Clients that
// register themselves (client ID metadata documents, dynamic registration)
// are not in it: the authorization server serves them on its own and finds
// their app through the API they ask for.
type AppDirectory interface {
	// Client finds the client a client_id names, with its app at the
	// revision that serves the request. domain.ErrAppClientNotFound when no
	// app client holds the id, or its app does not serve the request.
	Client(ctx context.Context, at AppLookup, clientID string) (*domain.ResolvedApp, domain.AppClient, error)
	// API finds the API whose identifier is resource, exactly, by the same
	// rules. domain.ErrAppAPINotFound when none.
	API(ctx context.Context, at AppLookup, resource string) (*domain.ResolvedApp, domain.AppAPI, error)
	// VerifyClientSecret checks a confidential client's secret: a registered
	// app's stored hashes, or a declared app's ${{ NAME }} variable as the
	// deployment froze it. domain.ErrAppClientSecretInvalid when it matches
	// none.
	VerifyClientSecret(ctx context.Context, at AppLookup, app *domain.ResolvedApp, client domain.AppClient, secret string) error
}

type appDirectory struct {
	pool      *DB
	variables VariableService
	keys      KeyService
	imported  ImportedHashVerifier
	// builtin are the apps the server declares, by project: versioned with
	// the binary, read-only, never stored.
	builtin map[string][]*domain.ResolvedApp
}

// NewAppDirectory serves the stored apps of every project plus builtin, the
// apps the server itself declares. A built-in app's Source must be
// domain.AppSourceBuiltin and its ProjectID set.
func NewAppDirectory(pool *DB, variables VariableService, keys KeyService, imported ImportedHashVerifier, builtin ...*domain.ResolvedApp) AppDirectory {
	byProject := map[string][]*domain.ResolvedApp{}
	for _, app := range builtin {
		byProject[app.ProjectID] = append(byProject[app.ProjectID], app)
	}
	return &appDirectory{pool: pool, variables: variables, keys: keys, imported: imported, builtin: byProject}
}

func (d *appDirectory) Client(ctx context.Context, at AppLookup, clientID string) (_ *domain.ResolvedApp, _ domain.AppClient, err error) {
	ctx, end := startSpan(ctx, "AppDirectory.Client")
	defer end(&err)

	for _, app := range d.builtin[at.ProjectID] {
		for _, client := range app.Document.Clients {
			if client.ClientID == clientID {
				return app, client, nil
			}
		}
	}
	stmts := d.pool.Statements()
	row, err := stmts.GetAppClientIDByClientID(ctx, at.ProjectID, clientID)
	if err != nil {
		return nil, domain.AppClient{}, notFoundAs(err, domain.ErrAppClientNotFound())
	}
	app, err := d.resolve(ctx, stmts, at, row.AppID)
	if err != nil {
		return nil, domain.AppClient{}, notFoundAs(err, domain.ErrAppClientNotFound())
	}
	client, ok := app.Document.Client(row.Slug)
	if !ok {
		// The revision serving the request does not list the client: it was
		// added later, or removed.
		return nil, domain.AppClient{}, domain.ErrAppClientNotFound()
	}
	return app, client, nil
}

func (d *appDirectory) API(ctx context.Context, at AppLookup, resource string) (_ *domain.ResolvedApp, _ domain.AppAPI, err error) {
	ctx, end := startSpan(ctx, "AppDirectory.API")
	defer end(&err)

	for _, app := range d.builtin[at.ProjectID] {
		if api, ok := app.Document.APIByIdentifier(resource); ok {
			return app, api, nil
		}
	}
	stmts := d.pool.Statements()
	row, err := stmts.GetAppAPIIdentifier(ctx, at.ProjectID, resource)
	if err != nil {
		return nil, domain.AppAPI{}, notFoundAs(err, domain.ErrAppAPINotFound())
	}
	app, err := d.resolve(ctx, stmts, at, row.AppID)
	if err != nil {
		return nil, domain.AppAPI{}, notFoundAs(err, domain.ErrAppAPINotFound())
	}
	api, ok := app.Document.APIByIdentifier(resource)
	if !ok {
		return nil, domain.AppAPI{}, domain.ErrAppAPINotFound()
	}
	return app, api, nil
}

func (d *appDirectory) VerifyClientSecret(ctx context.Context, at AppLookup, app *domain.ResolvedApp, client domain.AppClient, secret string) (err error) {
	ctx, end := startSpan(ctx, "AppDirectory.VerifyClientSecret")
	defer end(&err)

	if client.Type != domain.ClientTypeConfidential || secret == "" {
		return domain.ErrAppClientSecretInvalid()
	}
	switch app.Source {
	case domain.AppSourceDeclared:
		name, ok := domain.VariableReferenceName(client.Secret)
		if !ok {
			return domain.ErrAppClientSecretInvalid()
		}
		want, err := secretVariable(ctx, d.variables, decrypterOfWritingKey(ctx, d.keys), at.ProjectID, at.DeploymentID, name)
		if err != nil {
			return err
		}
		if want == "" || subtle.ConstantTimeCompare([]byte(want), []byte(secret)) != 1 {
			return domain.ErrAppClientSecretInvalid()
		}
		return nil
	case domain.AppSourceRegistered:
		return d.verifyStoredSecret(ctx, at.ProjectID, client.ClientID, secret)
	default:
		return domain.ErrAppClientSecretInvalid()
	}
}

// verifyStoredSecret checks secret against the client's stored hashes. A hash
// another system wrote that matches is replaced by the server's own, so the
// slow hash runs once.
func (d *appDirectory) verifyStoredSecret(ctx context.Context, projectID, clientID, secret string) error {
	stmts := d.pool.Statements()
	row, err := stmts.GetAppClientIDByClientID(ctx, projectID, clientID)
	if err != nil {
		return notFoundAs(err, domain.ErrAppClientSecretInvalid())
	}
	stored, err := stmts.ListAppClientSecrets(ctx, projectID, row.ID)
	if err != nil {
		return err
	}
	for _, s := range stored {
		if strings.HasPrefix(s.EncodedHash, sha256Scheme) {
			if matchSHA256(s.EncodedHash, secret) {
				return nil
			}
			continue
		}
		if d.imported == nil || d.imported.VerifyHash(s.EncodedHash, secret) != nil {
			continue
		}
		if err := stmts.UpdateAppClientSecretHash(ctx, projectID, s.ID, sha256Encoded(secret)); err != nil {
			getLoggingContext(ctx, "app").Warn("imported client secret matched but could not be rehashed", "secret_id", s.ID, "error", err)
		}
		return nil
	}
	return domain.ErrAppClientSecretInvalid()
}

// resolve reads app id at the revision that serves at, with each client's
// client_id filled in.
func (d *appDirectory) resolve(ctx context.Context, stmts AllStatements, at AppLookup, appID string) (*domain.ResolvedApp, error) {
	entity, err := stmts.GetApp(ctx, appBy(at.ProjectID, domain.AppFieldID, appID))
	if err != nil {
		return nil, err
	}
	if entity.Source == domain.AppSourceDeclared && at.DeploymentID != "" {
		revisionID, err := pinnedAppRevision(ctx, stmts, at, entity.Slug)
		if err != nil {
			return nil, err
		}
		if entity, err = stmts.GetAppRevision(ctx, at.ProjectID, revisionID); err != nil {
			return nil, err
		}
	}
	return resolvedApp(ctx, stmts, entity)
}

// pinnedAppRevision is the revision of the app slug names that the
// deployment's release pins. A release that does not pin the app means the
// deployment does not serve it.
func pinnedAppRevision(ctx context.Context, stmts AllStatements, at AppLookup, slug string) (string, error) {
	deployment, err := stmts.GetDeploymentByID(ctx, at.ProjectID, at.DeploymentID)
	if err != nil {
		return "", err
	}
	release, err := stmts.GetReleaseByID(ctx, at.ProjectID, deployment.ReleaseID)
	if err != nil {
		return "", err
	}
	revisionID, ok := PinsFor(release, domain.ReleasePointerKindApp)[slug]
	if !ok {
		return "", database.NewNoRowFoundError(nil)
	}
	return revisionID, nil
}

func resolvedApp(ctx context.Context, stmts AllStatements, entity *domain.App) (*domain.ResolvedApp, error) {
	doc, err := domain.ParseAppDocument(entity.Document)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("stored app document does not parse")
	}
	stored, err := stmts.ListAppClientIDs(ctx, entity.ProjectID, entity.ID)
	if err != nil {
		return nil, err
	}
	for i, client := range doc.Clients {
		j := slices.IndexFunc(stored, func(row *domain.AppClientID) bool { return row.Slug == client.Slug })
		if j >= 0 {
			doc.Clients[i].ClientID = stored[j].ClientID
		}
	}
	return &domain.ResolvedApp{
		ProjectID:  entity.ProjectID,
		ID:         entity.ID,
		Slug:       entity.Slug,
		Source:     entity.Source,
		RevisionID: entity.RevisionID,
		Document:   doc,
	}, nil
}

// notFoundAs answers a missing row as notFound and passes every other error
// through, so an outage is never told apart as "no such client".
func notFoundAs(err error, notFound domain.Error) error {
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return notFound
	}
	return err
}
