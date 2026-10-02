package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/zitadel/nextgen/internal/audit"
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
	// A dead attempt can neither settle a parked identity nor hand off, so the
	// flow restarts instead of rendering a step whose submissions fail. It runs
	// before the replay shortcut below, which would hide it on every render.
	if attempt.IsExpired() || attempt.IsHandedOff() {
		return nil, domain.ErrFlowRestartRequired()
	}
	check, ok := attempt.SSOCallback()
	var attemptUserID string
	if user, bound := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser); bound {
		attemptUserID = user.UserID
	}
	if ok && check.Result != nil && check.Result.CollisionUserID != "" {
		// A collision bind replaced the result with the user it bound, in the
		// same transaction as the user factor. Report it whatever the cookie
		// recorded, so a flow whose cookie lost that bind can catch up. Only
		// the marker counts: a user factor alone can come from an unrelated
		// identifier submission. The marker holds nothing else to read.
		return &domain.FlowSSOParkedIdentity{CollisionUserID: check.Result.CollisionUserID, AttemptUserID: attemptUserID}, nil
	}
	if !ok || check.Result == nil {
		if bound := boundThroughSSO(attempt); bound != nil {
			bound.AttemptUserID = attemptUserID
			return bound, nil
		}
		return nil, nil
	}
	// An already resolved row (sso_user_not_found or creation disabled leaves
	// it parked) needs none of the reads below. It still wins over an earlier
	// bind, as an unresolved row does.
	if check.ID == in.ResolvedCheckID {
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
		AttemptUserID:    attemptUserID,
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

// boundThroughSSO reports the user an earlier BindLinked recorded, while the
// attempt still waits for its handoff. The sso factor this attempt wrote is the
// marker: only a bind writes it, together with the user factor. A factor
// copied in from a session carries the older attempt id and does not count.
func boundThroughSSO(attempt *domain.AuthAttempt) *domain.FlowSSOParkedIdentity {
	if sso, ok := domain.CheckAs[*domain.AuthFactorSSO](attempt, domain.AuthCheckTypeSSO); !ok || sso.AttemptID != attempt.ID {
		return nil
	}
	user, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	if !ok {
		return nil
	}
	return &domain.FlowSSOParkedIdentity{BoundUserID: user.UserID}
}

// BindCollision binds the user an SSO claim collided with, by id, so the
// lookup that found it is not repeated through an unscoped identifier.
func (r *FlowSSOIdentityResolver) BindCollision(ctx context.Context, in domain.FlowSSOBindInput) error {
	return r.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		return bindSSOIdentity(ctx, tx.Statements(), in)
	})
}

func (r *FlowSSOIdentityResolver) BindLinked(ctx context.Context, in domain.FlowSSOBindInput) error {
	return r.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		return bindSSOIdentity(ctx, tx.Statements(), in)
	})
}

// bindSSOIdentity records the user factor, plus the sso factor when a link is
// given, on the attempt. A link settles the parked row, so it is deleted; a
// collision replaces it by a marker of the bound user (no provider data), so a
// retry after a lost cookie raises the outcome again. It runs inside the
// caller's transaction and returns ErrSSOStateInvalid unwrapped when the row
// was settled or replaced.
func bindSSOIdentity(ctx context.Context, stmts AllStatements, in domain.FlowSSOBindInput) error {
	// The exact parked row goes first: a settled or replaced one aborts before any write.
	var err error
	if in.LinkID == "" {
		err = stmts.MarkSSOCallbackCollision(ctx, in.ProjectID, in.AttemptID, in.CheckID, in.UserID)
	} else {
		err = stmts.DeleteSSOCallback(ctx, in.ProjectID, in.AttemptID, in.CheckID)
	}
	if err != nil {
		return err
	}
	attempt, err := stmts.GetAuthAttemptByID(ctx, in.ProjectID, in.AttemptID)
	if err != nil {
		return fmt.Errorf("bind sso identity: read attempt: %w", err)
	}
	// Creation without a project-unique claim reaches here with no earlier
	// attempt check, so a dead attempt is refused here and every write before
	// it rolls back.
	if attempt.IsExpired() || attempt.IsHandedOff() {
		return domain.ErrFlowRestartRequired()
	}
	bound, alreadyBound := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	if alreadyBound && bound.UserID != in.UserID {
		return domain.ErrFlowRestartRequired()
	}
	// The same user is bound already (a retry after a lost cookie): nothing to
	// add. Skipping the add matters on Spanner, where a refused add poisons
	// the transaction and no read after it can run.
	if !alreadyBound {
		// The check above is a plain read: a concurrent identifier submission
		// can still bind a user after it. The add refuses to overwrite one, and
		// a refusal means exactly that race, so the flow restarts. No read
		// follows the refusal: on Spanner it poisons the transaction.
		userFactor := &domain.AuthFactorUser{UserID: in.UserID}
		checkID, err := stmts.AddAuthAttemptFactor(ctx, in.ProjectID, in.AttemptID, userFactor)
		if _, taken := errors.AsType[*database.UniqueError](err); taken {
			return domain.ErrFlowRestartRequired()
		} else if err != nil {
			return fmt.Errorf("bind sso identity: %w", err)
		} else if err := emitDirectAuthFactor(ctx, stmts, attempt, userFactor, checkID); err != nil {
			return fmt.Errorf("bind sso identity: %w", err)
		}
	}
	// A collision has no link: like a typed identifier it proves nothing about
	// the account, so it records the user factor alone.
	if in.LinkID == "" {
		return nil
	}
	ssoFactor := &domain.AuthFactorSSO{ConnectionID: in.ConnectionID, LinkID: in.LinkID, AttemptID: in.AttemptID}
	if _, err := recordDirectAuthFactor(ctx, stmts, attempt, ssoFactor); err != nil {
		return fmt.Errorf("bind sso identity: %w", err)
	}
	return nil
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
			CheckID:      in.CheckID,
			UserID:       userID,
			ConnectionID: in.ConnectionID,
		},
	}
	if err := r.users.ApplyActions(ctx, createUser, linkAndBind); err != nil {
		// Audited like a create through the user API.
		emitUserCreateFailedBestEffort(ctx, r.db, createUser, err)
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
	if err := audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeIDPIdentityLinkCreated,
		Category:   domain.EventCategoryEntity,
		ProjectID:  link.ProjectID,
		EntityType: "idp_identity_link",
		EntityID:   link.ID,
		Payload:    domain.IDPIdentityLinkCreatedPayload{ConnectionID: link.ConnectionID, UserID: link.UserID},
	}); err != nil {
		return fmt.Errorf("create sso user: emit identity link created: %w", err)
	}
	bind := a.bind
	bind.LinkID = link.ID
	return bindSSOIdentity(ctx, stmts, bind)
}

var _ UserAction = (*ssoLinkAction)(nil)

// FindUniqueOwner looks the value up in the project-scoped rows of the
// unique-attributes registry, without recording anything on the attempt. A
// team-scoped row for the same value would not collide with the new user, so
// it does not count.
func (r *FlowSSOIdentityResolver) FindUniqueOwner(ctx context.Context, projectID, attribute, value string) (string, error) {
	user, err := r.db.Statements().GetUser(ctx,
		database.Equal(database.Col(domain.UserFieldProjectID), projectID),
		UserQueryOptions{
			Attributes:           []domain.Attribute{{Key: domain.AttributeKey(attribute), Value: value}},
			UniqueAttributesOnly: true,
			UniqueTeamID:         new(""),
		},
	)
	if _, missing := errors.AsType[*database.NoRowFoundError](err); missing {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("find unique owner: %w", err)
	}
	return user.ID, nil
}
