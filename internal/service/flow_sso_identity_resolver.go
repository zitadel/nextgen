package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/idp"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// FlowSSOIdentityResolver implements [domain.FlowSSOIdentityService]: it reads
// the result an SSO callback parked on the attempt, resolves it against the
// pinned connection revision and the identity links, and settles it.
type FlowSSOIdentityResolver struct {
	db          StatementPool
	connections IDPConnectionService
	users       UserService
	schemaStore domain.JSONSchemaStore
}

func NewFlowSSOIdentityResolver(db StatementPool, connections IDPConnectionService, users UserService, schemaStore domain.JSONSchemaStore) *FlowSSOIdentityResolver {
	return &FlowSSOIdentityResolver{db: db, connections: connections, users: users, schemaStore: schemaStore}
}

var _ domain.FlowSSOIdentityService = (*FlowSSOIdentityResolver)(nil)

func (r *FlowSSOIdentityResolver) LoadParked(ctx context.Context, in domain.FlowSSOLoadInput) (*domain.FlowSSOParkedIdentity, error) {
	stmts := r.db.Statements()
	attempt, err := stmts.GetAuthAttemptByID(ctx, in.ProjectID, in.AttemptID)
	if err != nil {
		return nil, fmt.Errorf("load parked sso identity: read attempt: %w", err)
	}
	check, ok := attempt.SSOCallback()
	// An already resolved row (sso_user_not_found leaves it parked) needs
	// none of the reads below.
	if !ok || check.Result == nil || check.ID == in.ResolvedCheckID {
		return nil, nil
	}
	result := check.Result

	// The pinned revision, not the newest: the result was produced under it.
	connection, err := r.connections.GetRevision(ctx, in.ProjectID, result.ConnectionRevisionID)
	if errors.Is(err, domain.ErrIDPConnectionNotFound()) {
		// Deleted while the user was at the provider: nothing can resolve the
		// identity any more, so the flow starts over.
		getLoggingContext(ctx, "flow").Warn("sso identity parked on a connection revision that no longer exists",
			slog.String("project_id", in.ProjectID),
			slog.String("connection_revision_id", result.ConnectionRevisionID),
		)
		return nil, domain.ErrFlowRestartRequired()
	}
	if err != nil {
		return nil, fmt.Errorf("load parked sso identity: read connection revision: %w", err)
	}
	parsed, err := idp.ParseConnection(connection.RevisionID, connection.Document)
	if err != nil {
		return nil, fmt.Errorf("load parked sso identity: parse connection revision: %w", err)
	}
	parked := &domain.FlowSSOParkedIdentity{
		CheckID:          check.ID,
		ConnectionID:     connection.ID,
		Subject:          result.Subject,
		Claims:           result.Claims,
		Verified:         result.Verified,
		CreationDisabled: parsed.CreationDisabled,
	}

	link, err := stmts.GetIDPIdentityLink(ctx, database.And(
		database.Equal(database.Col(domain.IDPIdentityLinkFieldProjectID), in.ProjectID),
		database.Equal(database.Col(domain.IDPIdentityLinkFieldConnectionID), connection.ID),
		database.Equal(database.Col(domain.IDPIdentityLinkFieldSubject), result.Subject),
	))
	if _, missing := errors.AsType[*database.NoRowFoundError](err); missing {
		return parked, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load parked sso identity: read identity link: %w", err)
	}

	user, err := stmts.GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), in.ProjectID),
		database.Equal(database.Col(domain.UserFieldID), link.UserID),
	), UserQueryOptions{})
	if err != nil {
		return nil, fmt.Errorf("load parked sso identity: read linked user: %w", err)
	}
	if user.SchemaURL != in.UserSchemaURL {
		// The flow validates against one schema and cannot continue with a
		// user of another. The response stays generic; the log says why.
		getLoggingContext(ctx, "flow").Warn("sso identity is linked to a user of another schema",
			slog.String("project_id", in.ProjectID),
			slog.String("flow_schema_url", in.UserSchemaURL),
			slog.String("user_schema_url", user.SchemaURL),
		)
		return nil, domain.ErrFlowRestartRequired()
	}
	parked.Link = &domain.FlowSSOLinkedUser{LinkID: link.ID, UserID: link.UserID}
	return parked, nil
}

func (r *FlowSSOIdentityResolver) BindLinked(ctx context.Context, in domain.FlowSSOBindInput) error {
	return r.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		return bindSSOIdentity(ctx, tx.Statements(), in)
	})
}

// bindSSOIdentity records the user and sso factors on the attempt and deletes
// the parked row. It runs inside the caller's transaction.
func bindSSOIdentity(ctx context.Context, stmts AllStatements, in domain.FlowSSOBindInput) error {
	attempt, err := stmts.GetAuthAttemptByID(ctx, in.ProjectID, in.AttemptID)
	if err != nil {
		return fmt.Errorf("bind sso identity: read attempt: %w", err)
	}
	// SetAuthAttemptFactor overwrites, so a bound attempt is checked here.
	if bound, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser); ok && bound.UserID != in.UserID {
		return domain.ErrFlowRestartRequired()
	}
	factors := []domain.AuthFactor{
		&domain.AuthFactorUser{UserID: in.UserID},
		&domain.AuthFactorSSO{ConnectionID: in.ConnectionID, LinkID: in.LinkID},
	}
	for _, factor := range factors {
		if _, err := recordDirectAuthFactor(ctx, stmts, attempt, factor); err != nil {
			return fmt.Errorf("bind sso identity: %w", err)
		}
	}
	return stmts.DeleteSSOCallback(ctx, in.ProjectID, in.AttemptID)
}

func (r *FlowSSOIdentityResolver) DeleteParked(ctx context.Context, projectID, attemptID string) error {
	return r.db.Statements().DeleteSSOCallback(ctx, projectID, attemptID)
}

// CreateLinked creates the user, links the subject to it and binds the
// attempt, all in one transaction. A unique attribute or the subject already
// taken returns ErrUserAlreadyExists.
func (r *FlowSSOIdentityResolver) CreateLinked(ctx context.Context, in domain.FlowSSOCreateInput) (string, error) {
	userID, err := r.db.Statements().NewManagedID(string(domain.PrefixUser))
	if err != nil {
		return "", fmt.Errorf("create sso user: mint user id: %w", err)
	}
	createUser := NewCreateUserAction(CreateUserInput{
		ProjectID:  in.ProjectID,
		SchemaURL:  in.UserSchemaURL,
		Attributes: in.Attributes,
		ID:         userID,
	}, r.schemaStore)
	linkAndBind := &ssoLinkAction{
		subject: in.Subject,
		bind: domain.FlowSSOBindInput{
			ProjectID:    in.ProjectID,
			AttemptID:    in.AttemptID,
			UserID:       userID,
			ConnectionID: in.ConnectionID,
		},
	}
	if err := r.users.ApplyActions(ctx, createUser, linkAndBind); err != nil {
		return "", err
	}
	return userID, nil
}

// ssoLinkAction links the subject to the user created in the same
// transaction, then binds the attempt with the link id the insert minted.
type ssoLinkAction struct {
	subject string
	bind    domain.FlowSSOBindInput
}

func (a *ssoLinkAction) Prepare(context.Context) error { return nil }

func (a *ssoLinkAction) Apply(ctx context.Context, stmts AllStatements) error {
	link := &domain.IDPIdentityLink{
		ProjectID:    a.bind.ProjectID,
		ConnectionID: a.bind.ConnectionID,
		Subject:      a.subject,
		UserID:       a.bind.UserID,
	}
	if err := stmts.CreateIDPIdentityLink(ctx, link); err != nil {
		if _, ok := errors.AsType[*database.UniqueError](err); ok {
			// Another sign-in linked the subject first.
			return domain.ErrUserAlreadyExists().WithParent(err)
		}
		return fmt.Errorf("create sso user: link identity: %w", err)
	}
	bind := a.bind
	bind.LinkID = link.ID
	return bindSSOIdentity(ctx, stmts, bind)
}

var _ UserAction = (*ssoLinkAction)(nil)
