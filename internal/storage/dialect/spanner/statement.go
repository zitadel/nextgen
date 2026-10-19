package spanner

import (
	"github.com/zitadel/nextgen/internal/service"
)

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

func newStatements(db queryExecutor) statements {
	return statements{
		projectStatements:             newProjectStatements(db),
		originStatements:              newOriginStatements(db),
		flowDefinitionStatements:      newFlowDefinitionStatements(db),
		cryptoKeyStatements:           newCryptoKeyStatements(db),
		jsonSchemaStatements:          newJSONSchemaStatements(db),
		releaseStatements:             newReleaseStatements(db),
		idpConnectionStatements:       newIDPConnectionStatements(db),
		idpIdentityLinkStatements:     newIDPIdentityLinkStatements(db),
		deploymentStatements:          newDeploymentStatements(db),
		previewStatements:             newPreviewStatements(db),
		teamStatements:                newTeamStatements(db),
		teamMembershipStatements:      newTeamMembershipStatements(db),
		tokenStatements:               newTokenStatements(db),
		sessionStatements:             newSessionStatements(db),
		authAttemptStatements:         newAuthAttemptStatements(db),
		userStatements:                newUserStatements(db),
		userPasswordStatements:        newUserPasswordStatements(db),
		userTOTPStatements:            newUserTOTPStatements(db),
		userPasskeyStatements:         newUserPasskeyStatements(db),
		userRecoveryCodesStatements:   newUserRecoveryCodesStatements(db),
		brandingStatements:            newBrandingStatements(db),
		variableStatements:            newVariableStatements(db),
		variableSetStatements:         newVariableSetStatements(db),
		claimStatements:               newClaimStatements(db),
		resourceScopeStatements:       newResourceScopeStatements(db),
		authzAssignmentStatements:     newAuthzAssignmentStatements(db),
		authzMembershipEdgeStatements: newAuthzMembershipEdgeStatements(db),
		authzCatalogStatements:        newAuthzCatalogStatements(db),
		authzResolverStatements:       newAuthzResolverStatements(db),
		eventStatements:               newEventStatements(db),
	}
}

var _ service.AllStatements = (*statements)(nil)

type statement struct {
	db queryExecutor
}

// IsStatements implements [service.Statements].
func (s *statement) IsStatements() {}

var _ service.Statements = (*statement)(nil)
