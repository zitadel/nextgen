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
}

func NewFlowSSOIdentityResolver(db StatementPool, connections IDPConnectionService) *FlowSSOIdentityResolver {
	return &FlowSSOIdentityResolver{db: db, connections: connections}
}

var _ domain.FlowSSOIdentityService = (*FlowSSOIdentityResolver)(nil)

func (r *FlowSSOIdentityResolver) LoadParked(ctx context.Context, in domain.FlowSSOLoadInput) (*domain.FlowSSOParkedIdentity, error) {
	stmts := r.db.Statements()
	attempt, err := stmts.GetAuthAttemptByID(ctx, in.ProjectID, in.AttemptID)
	if err != nil {
		return nil, fmt.Errorf("load parked sso identity: read attempt: %w", err)
	}
	check, ok := attempt.SSOCallback()
	if !ok || check.Result == nil {
		return boundThroughSSO(attempt), nil
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

// boundThroughSSO reports the user an earlier BindLinked recorded, while the
// attempt still waits for its handoff. The sso factor this attempt wrote is the
// marker: only a bind writes it, together with the user factor. A factor
// copied in from a session carries the older attempt id and does not count.
func boundThroughSSO(attempt *domain.AuthAttempt) *domain.FlowSSOParkedIdentity {
	if attempt.HandedOffAt != nil {
		return nil
	}
	if sso, ok := domain.CheckAs[*domain.AuthFactorSSO](attempt, domain.AuthCheckTypeSSO); !ok || sso.AttemptID != attempt.ID {
		return nil
	}
	user, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	if !ok {
		return nil
	}
	return &domain.FlowSSOParkedIdentity{BoundUserID: user.UserID}
}

func (r *FlowSSOIdentityResolver) BindLinked(ctx context.Context, in domain.FlowSSOBindInput) error {
	return r.db.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		// The exact parked row goes first: a settled or replaced one aborts before any write.
		if err := stmts.DeleteSSOCallback(ctx, in.ProjectID, in.AttemptID, in.CheckID); err != nil {
			return err
		}
		attempt, err := stmts.GetAuthAttemptByID(ctx, in.ProjectID, in.AttemptID)
		if err != nil {
			return fmt.Errorf("bind sso identity: read attempt: %w", err)
		}
		bound, alreadyBound := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
		if alreadyBound && bound.UserID != in.UserID {
			return domain.ErrFlowRestartRequired()
		}
		if !alreadyBound {
			// The check above is a plain read: a concurrent identifier
			// submission can still bind a user after it, and the add refuses to
			// overwrite one. The flow restarts without re-reading: on Spanner the
			// refused insert has already ended the transaction.
			userFactor := &domain.AuthFactorUser{UserID: in.UserID}
			checkID, err := stmts.AddAuthAttemptFactor(ctx, in.ProjectID, in.AttemptID, userFactor)
			if _, taken := errors.AsType[*database.UniqueError](err); taken {
				return domain.ErrFlowRestartRequired()
			}
			if err != nil {
				return fmt.Errorf("bind sso identity: %w", err)
			}
			if err := emitDirectAuthFactor(ctx, stmts, attempt, userFactor, checkID); err != nil {
				return fmt.Errorf("bind sso identity: %w", err)
			}
		}
		ssoFactor := &domain.AuthFactorSSO{ConnectionID: in.ConnectionID, LinkID: in.LinkID, AttemptID: in.AttemptID}
		if _, err := recordDirectAuthFactor(ctx, stmts, attempt, ssoFactor); err != nil {
			return fmt.Errorf("bind sso identity: %w", err)
		}
		return nil
	})
}

func (r *FlowSSOIdentityResolver) CreateLinked(context.Context, domain.FlowSSOCreateInput) (string, error) {
	return "", fmt.Errorf("%w: sso auto creation", domain.ErrFlowUnsupported())
}
