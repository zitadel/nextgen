package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/service"
)

// queryExecutor abstracts *sql.DB and *sql.Tx so entity statements work
// against either connection type.
type queryExecutor interface {
	Exec(ctx context.Context, query string, args ...any) (sql.Result, error)
	Query(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRow(ctx context.Context, query string, args ...any) *sql.Row
}

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
	resourceScopeStatements
	authzAssignmentStatements
	authzMembershipEdgeStatements
	authzCatalogStatements
}

func (s statements) Statements() service.AllStatements {
	return s
}

// IsStatements implements [service.Statements].
func (s statements) IsStatements() {}

func newStatements(client queryExecutor) statements {
	return statements{
		projectStatements:             newProjectStatements(client),
		flowDefinitionStatements:      newFlowDefinitionStatements(client),
		cryptoKeyStatements:           newCryptoKeyStatements(client),
		jsonSchemaStatements:          newJSONSchemaStatements(client),
		teamStatements:                newTeamStatements(client),
		teamMembershipStatements:      newTeamMembershipStatements(client),
		tokenStatements:               newTokenStatements(client),
		passkeyRegistrationStatements: newPasskeyRegistrationStatements(client),
		sessionStatements:             newSessionStatements(client),
		authAttemptStatements:         newAuthAttemptStatements(client),
		userStatements:                newUserStatements(client),
		userPasswordStatements:        newUserPasswordStatements(client),
		userTOTPStatements:            newUserTOTPStatements(client),
		userPasskeyStatements:         newUserPasskeyStatements(client),
		userRecoveryCodesStatements:   newUserRecoveryCodesStatements(client),
		brandingStatements:            newBrandingStatements(client),
		claimStatements:               newClaimStatements(client),
		resourceScopeStatements:       newResourceScopeStatements(client),
		authzAssignmentStatements:     newAuthzAssignmentStatements(client),
		authzMembershipEdgeStatements: newAuthzMembershipEdgeStatements(client),
		authzCatalogStatements:        newAuthzCatalogStatements(client),
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
