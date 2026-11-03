package platform

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ReconcileOperators makes the deployment's platform operators match its
// configuration (ADR 075 §4). It grants platform.operator to every listed user
// that exists in the platform project and warns about listed ids that do not.
// It revokes the operator assignments configuration granted earlier to users
// no longer listed, and leaves assignments granted any other way alone. Each
// change writes its authz.granted or authz.revoked event in the same
// transaction.
//
// It runs at every start, possibly on several replicas at once: a grant
// another replica already wrote, or a revocation it already made, counts as
// done.
//
// An empty platformProjectID is a deployment without a platform project, which
// configuration validation only allows with no operators listed.
func ReconcileOperators(ctx context.Context, pool service.StatementPool, platformProjectID string, userIDs []string) error {
	if platformProjectID == "" {
		return nil
	}
	listed := make(map[string]bool, len(userIDs))
	for _, id := range userIDs {
		listed[id] = true
	}

	current, err := pool.Statements().ListActiveAuthzAssignmentsByRelation(ctx, platformProjectID, domain.AuthzObjectTypePlatform, domain.AuthzRelationOperator)
	if err != nil {
		return fmt.Errorf("list platform operators: %w", err)
	}
	held := make(map[string]bool, len(current))
	for _, a := range current {
		held[a.PrincipalID] = true
		if listed[a.PrincipalID] || !grantedByConfig(a) {
			continue
		}
		if err := revokeOperator(ctx, pool, a); err != nil {
			return fmt.Errorf("revoke platform operator %q: %w", a.PrincipalID, err)
		}
		slog.Info("platform operators: revoked, no longer configured", slog.String("user_id", a.PrincipalID))
	}

	for _, id := range userIDs {
		if held[id] {
			continue
		}
		held[id] = true
		exists, err := userExists(ctx, pool.Statements(), platformProjectID, id)
		if err != nil {
			return fmt.Errorf("look up platform operator %q: %w", id, err)
		}
		if !exists {
			slog.Warn("platform operators: no such user in the platform project, not granted",
				slog.String("user_id", id), slog.String("project_id", platformProjectID))
			continue
		}
		if err := grantOperator(ctx, pool, platformProjectID, id); err != nil {
			return fmt.Errorf("grant platform operator %q: %w", id, err)
		}
		slog.Info("platform operators: granted", slog.String("user_id", id))
	}
	return nil
}

// grantedByConfig reports whether configuration wrote the assignment, and so
// owns revoking it.
func grantedByConfig(a *domain.AuthzAssignment) bool {
	return a.GrantorType != nil && *a.GrantorType == domain.AuthzGrantorTypeConfig
}

func userExists(ctx context.Context, stmts service.AllStatements, projectID, userID string) (bool, error) {
	_, err := stmts.GetUser(ctx, database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserFieldID), userID),
	), service.UserQueryOptions{})
	if errors.Is(err, new(database.NoRowFoundError)) {
		return false, nil
	}
	return err == nil, err
}

func grantOperator(ctx context.Context, pool service.StatementPool, platformProjectID, userID string) error {
	err := pool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		a := domain.NewPlatformOperatorAssignment(platformProjectID, userID)
		if err := tx.Statements().CreateAuthzAssignment(ctx, a); err != nil {
			return err
		}
		return emitOperatorEvent(ctx, tx.Statements(), domain.EventTypeAuthzGranted, a, domain.AuthzGrantedPayload{
			PrincipalType: a.PrincipalType.String(),
			PrincipalID:   a.PrincipalID,
			Relation:      a.Relation,
		})
	})
	if _, ok := errors.AsType[*database.UniqueError](err); ok {
		return nil
	}
	return err
}

func revokeOperator(ctx context.Context, pool service.StatementPool, a *domain.AuthzAssignment) error {
	return pool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		err := tx.Statements().RevokeAuthzAssignment(ctx, a.ProjectID, a.ID)
		if errors.Is(err, new(database.NoRowFoundError)) {
			return nil
		}
		if err != nil {
			return err
		}
		return emitOperatorEvent(ctx, tx.Statements(), domain.EventTypeAuthzRevoked, a, domain.AuthzRevokedPayload{
			PrincipalType: a.PrincipalType.String(),
			PrincipalID:   a.PrincipalID,
			Relation:      a.Relation,
		})
	})
}

// emitOperatorEvent writes the grant's event in the platform project, with the
// system as its actor: configuration, not a request, made the change.
func emitOperatorEvent(ctx context.Context, stmts service.AllStatements, typ domain.EventType, a *domain.AuthzAssignment, payload any) error {
	system := domain.EventActorTypeSystem
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       typ,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  a.ProjectID,
		EntityType: "authz_assignment",
		EntityID:   a.ID,
		Payload:    payload,
		ActorType:  &system,
	})
}
