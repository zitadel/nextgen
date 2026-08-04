package spanner

import (
	"github.com/zitadel/nextgen/internal/service"
)

type statements struct {
	projectStatements
	flowDefinitionStatements
	cryptoKeyStatements
	jsonSchemaStatements
	teamStatements
	teamMembershipStatements
	tokenStatements
	passkeyRegistrationStatements
	sessionStatements
	authAttemptStatements
	userStatements
	userPasswordStatements
	userTOTPStatements
	userPasskeyStatements
	userRecoveryCodesStatements
	brandingStatements
	claimStatements
}

func (s statements) Statements() service.AllStatements {
	return s
}

// IsStatements implements [service.Statements].
func (s statements) IsStatements() {}

func newStatements(db queryExecutor) statements {
	return statements{
		projectStatements:             newProjectStatements(db),
		flowDefinitionStatements:      newFlowDefinitionStatements(db),
		cryptoKeyStatements:           newCryptoKeyStatements(db),
		jsonSchemaStatements:          newJSONSchemaStatements(db),
		teamStatements:                newTeamStatements(db),
		teamMembershipStatements:      newTeamMembershipStatements(db),
		tokenStatements:               newTokenStatements(db),
		passkeyRegistrationStatements: newPasskeyRegistrationStatements(db),
		sessionStatements:             newSessionStatements(db),
		authAttemptStatements:         newAuthAttemptStatements(db),
		userStatements:                newUserStatements(db),
		userPasswordStatements:        newUserPasswordStatements(db),
		userTOTPStatements:            newUserTOTPStatements(db),
		userPasskeyStatements:         newUserPasskeyStatements(db),
		userRecoveryCodesStatements:   newUserRecoveryCodesStatements(db),
		brandingStatements:            newBrandingStatements(db),
		claimStatements:               newClaimStatements(db),
	}
}

var _ service.AllStatements = (*statements)(nil)

type statement struct {
	db queryExecutor
}

// IsStatements implements [service.Statements].
func (s *statement) IsStatements() {}

var _ service.Statements = (*statement)(nil)
