package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/zitadel/nextgen/internal/service"
)

type queryExecutor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type statements struct {
	projectStatements
	originStatements
	flowDefinitionStatements
	cryptoKeyStatements
	jsonSchemaStatements
	releaseStatements
	idpConnectionStatements
	idpIdentityLinkStatements
	deploymentStatements
	previewStatements
	teamStatements
	teamMembershipStatements
	tokenStatements
	sessionStatements
	authAttemptStatements
	userStatements
	userPasswordStatements
	userTOTPStatements
	userPasskeyStatements
	userRecoveryCodesStatements
	brandingStatements
	variableStatements
	variableSetStatements
	claimStatements
	resourceScopeStatements
	authzAssignmentStatements
	authzMembershipEdgeStatements
	authzCatalogStatements
	authzResolverStatements
	eventStatements
}

func (s statements) Statements() service.AllStatements {
	return s
}

// IsStatements implements [service.Statements].
func (s statements) IsStatements() {}

func newStatements(client queryExecutor) statements {
	client = traced(client)
	return statements{
		projectStatements:             newProjectStatements(client),
		originStatements:              newOriginStatements(client),
		flowDefinitionStatements:      newFlowDefinitionStatements(client),
		cryptoKeyStatements:           newCryptoKeyStatements(client),
		jsonSchemaStatements:          newJSONSchemaStatements(client),
		releaseStatements:             newReleaseStatements(client),
		idpConnectionStatements:       newIDPConnectionStatements(client),
		idpIdentityLinkStatements:     newIDPIdentityLinkStatements(client),
		deploymentStatements:          newDeploymentStatements(client),
		previewStatements:             newPreviewStatements(client),
		teamStatements:                newTeamStatements(client),
		teamMembershipStatements:      newTeamMembershipStatements(client),
		tokenStatements:               newTokenStatements(client),
		sessionStatements:             newSessionStatements(client),
		authAttemptStatements:         newAuthAttemptStatements(client),
		userStatements:                newUserStatements(client),
		userPasswordStatements:        newUserPasswordStatements(client),
		userTOTPStatements:            newUserTOTPStatements(client),
		userPasskeyStatements:         newUserPasskeyStatements(client),
		userRecoveryCodesStatements:   newUserRecoveryCodesStatements(client),
		brandingStatements:            newBrandingStatements(client),
		variableStatements:            newVariableStatements(client),
		variableSetStatements:         newVariableSetStatements(client),
		claimStatements:               newClaimStatements(client),
		resourceScopeStatements:       newResourceScopeStatements(client),
		authzAssignmentStatements:     newAuthzAssignmentStatements(client),
		authzMembershipEdgeStatements: newAuthzMembershipEdgeStatements(client),
		authzCatalogStatements:        newAuthzCatalogStatements(client),
		authzResolverStatements:       newAuthzResolverStatements(client),
		eventStatements:               newEventStatements(client),
	}
}

var _ service.Statements = (*statements)(nil)
var _ service.AllStatements = (*statements)(nil)

type statement struct {
	client queryExecutor
}

// IsStatements implements [service.Statements].
func (s *statement) IsStatements() {}

var _ service.Statements = (*statement)(nil)
