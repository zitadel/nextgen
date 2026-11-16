package resolver

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ProjectAdminCheck is the invitation service's inviter check: whether a user
// still holds admin on the project, as creating the invitation required.
func ProjectAdminCheck(platformProjectID string) service.InviterCheck {
	return func(ctx context.Context, stmts service.AllStatements, projectID, userID string) (bool, error) {
		home, err := stmts.GetResourceScope(ctx, userID)
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return false, nil
			}
			return false, err
		}
		if home.ResourceKind != domain.ResourceKindUser {
			return false, nil
		}
		req := Request{
			PrincipalType: domain.AuthzPrincipalTypeUser,
			PrincipalID:   userID,
			ProjectID:     projectID,
			HomeProjectID: home.ProjectID,
			ObjectType:    "project",
			Relation:      "admin",
		}
		if platformProjectID != "" && home.ProjectID == platformProjectID {
			req.PlatformProjectID = platformProjectID
		}
		dec, err := New().Check(ctx, stmts, req)
		if err != nil {
			return false, domain.ErrInternal(err).WithMessage("authz permission check failed")
		}
		return dec == DecisionAllow, nil
	}
}
