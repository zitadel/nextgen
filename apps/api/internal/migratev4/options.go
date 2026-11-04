// Package migratev4 migrates a Zitadel v4 instance into a nextgen project:
// organizations become teams, human users become users with their password
// hashes, generic OIDC and Google IdPs become IdP connections, and IdP links
// become identity links.
//
// It reads v4 through package v4, folds what it reads into package stage, and
// converges nextgen to that state through nextgen's services and statements.
// The design is docs/design/migrate-v4/README.md.
package migratev4

import (
	"fmt"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/idp"
	"github.com/zitadel/nextgen/internal/service"
)

// Identifier choices: the user property people sign in with (plan, D4).
const (
	IdentifierEmail     = "email"
	IdentifierLoginName = "login_name"
)

// Default-org choices: who owns the default org's users (plan, D5).
const (
	DefaultOrgUsersSelf = "self"
	DefaultOrgUsersTeam = "team"
)

// Options are the operator's choices for one instance.
type Options struct {
	// InstanceID is the v4 instance to migrate.
	InstanceID string
	// ProjectID is reserved for existing-project imports, currently blocked.
	// Empty creates one and subsequent runs reuse its ledger mapping.
	ProjectID string
	// Identifier is IdentifierEmail or IdentifierLoginName.
	Identifier string
	// DefaultOrgUsers must be DefaultOrgUsersTeam in the guarded offline POC.
	DefaultOrgUsers string
	// MasterKey is required when the source has supported IdP client secrets.
	MasterKey []byte
	// SourceStopped confirms v4 and its other writers are stopped. Every
	// apply and verification requires this in the offline POC.
	SourceStopped bool
	// TargetStopped confirms serving processes and other target writers are stopped.
	// This POC does not yet fence concurrent target writes.
	TargetStopped bool
	// V4Callback, when set, is the v4 callback URL every migrated connection
	// keeps as `oidc.redirect_uri`, so the providers need no new
	// registration (plan, Keeping v4 callback URLs).
	V4Callback string
	// V4CallbackFor overrides V4Callback for single connections, by v4 IdP id.
	V4CallbackFor map[string]string
	// IncludePII lets issues name the users and values they are about.
	IncludePII bool
	// BatchSize is the number of v4 events per ingest batch.
	BatchSize int
}

// callbackFor is the v4 callback URL the connection for v4 IdP id keeps, or
// "" for nextgen's own callback route.
func (o *Options) callbackFor(id string) string {
	if uri, ok := o.V4CallbackFor[id]; ok {
		return uri
	}
	return o.V4Callback
}

func (o *Options) validateCallbacks() error {
	if o.V4Callback != "" && !idp.ValidLegacyRedirectURI(o.V4Callback) {
		return fmt.Errorf("v4 callback %q is not a v4 callback URL: want https://HOST%s or https://HOST%s", o.V4Callback, idp.LegacyCallbackPaths[0], idp.LegacyCallbackPaths[1])
	}
	for id, uri := range o.V4CallbackFor {
		if !idp.ValidLegacyRedirectURI(uri) {
			return fmt.Errorf("v4 callback for IdP %s %q is not a v4 callback URL: want https://HOST%s or https://HOST%s", id, uri, idp.LegacyCallbackPaths[0], idp.LegacyCallbackPaths[1])
		}
	}
	return nil
}

func (o *Options) defaults() {
	if o.Identifier == "" {
		o.Identifier = IdentifierEmail
	}
	if o.DefaultOrgUsers == "" {
		o.DefaultOrgUsers = DefaultOrgUsersTeam
	}
}

// Deps are the nextgen services and statements the migrator writes through.
type Deps struct {
	Pool        service.StatementPool
	Projects    service.ProjectService
	Schemas     *service.SchemaService
	Flows       service.FlowDefinitionService
	Users       service.UserService
	Variables   service.VariableService
	IDPs        service.IDPConnectionService
	SchemaStore domain.JSONSchemaStore
	// Hasher validates an imported hash against the deployment's verifiers
	// and limits, as the bootstrap user import does.
	Hasher *crypto.PasswapHasher
	// BuiltinPublicBase is schema.builtin_public_base: the namespace of the
	// built-in schemas and of the default login flow.
	BuiltinPublicBase string
}
