package stage

import (
	"time"

	v4 "github.com/zitadel/nextgen/internal/migratev4/v4"
)

// Aggregate types the stage folds.
const (
	AggregateInstance  = "instance"
	AggregateOrg       = "org"
	AggregateUser      = "user"
	AggregateProject   = "project"
	AggregateUserGrant = "usergrant"
	AggregateAction    = "action"
	AggregateTarget    = "target"
	AggregateExecution = "execution"
	AggregateSchema    = "user_schema"
)

// User states, as v4's UserV2WriteModel derives them.
const (
	StateActive   = "active"
	StateInitial  = "initial"
	StateInactive = "inactive"
	StateLocked   = "locked"
	StateDeleted  = "deleted"
)

// Org states.
const (
	OrgActive   = "active"
	OrgInactive = "inactive"
	OrgRemoved  = "removed"
)

// IdP types, named after v4's event types.
const (
	IDPOIDC   = "oidc"
	IDPGoogle = "google"
	IDPJWT    = "jwt"
	IDPSAML   = "saml"
)

// Instance is the folded state of a v4 instance aggregate.
type Instance struct {
	Name         string `json:"name,omitempty"`
	Removed      bool   `json:"removed,omitempty"`
	DefaultOrgID string `json:"default_org_id,omitempty"`
	// IAMProjectID is the project setup creates for Zitadel itself (the
	// console's), which assess leaves out of its counts.
	IAMProjectID   string          `json:"iam_project_id,omitempty"`
	Domains        map[string]bool `json:"domains,omitempty"`
	PrimaryDomain  string          `json:"primary_domain,omitempty"`
	TrustedDomains map[string]bool `json:"trusted_domains,omitempty"`
	// UserLoginMustBeDomain is the instance's domain policy, the default for
	// every org without its own.
	UserLoginMustBeDomain bool        `json:"user_login_must_be_domain,omitempty"`
	LoginPolicy           LoginPolicy `json:"login_policy"`
	// LoginIDPs are the IdPs the instance login policy offers, in the order
	// they were added.
	LoginIDPs []string        `json:"login_idps,omitempty"`
	IDPs      map[string]*IDP `json:"idps,omitempty"`
}

// LoginPolicy holds the login-policy settings assess reports on.
type LoginPolicy struct {
	AllowUsernamePassword bool `json:"allow_username_password,omitempty"`
	AllowRegister         bool `json:"allow_register,omitempty"`
	AllowExternalIDP      bool `json:"allow_external_idp,omitempty"`
	ForceMFA              bool `json:"force_mfa,omitempty"`
	ForceMFALocalOnly     bool `json:"force_mfa_local_only,omitempty"`
	DisableLoginWithEmail bool `json:"disable_login_with_email,omitempty"`
	DisableLoginWithPhone bool `json:"disable_login_with_phone,omitempty"`
	PasswordlessType      int  `json:"passwordless_type,omitempty"`
}

// Org is the folded state of a v4 org aggregate.
type Org struct {
	Name          string `json:"name,omitempty"`
	State         string `json:"state,omitempty"`
	PrimaryDomain string `json:"primary_domain,omitempty"`
	// Domains maps each domain to whether it is verified.
	Domains map[string]bool `json:"domains,omitempty"`
	// UserLoginMustBeDomain is the org's own domain policy, nil when the org
	// uses the instance default.
	UserLoginMustBeDomain *bool           `json:"user_login_must_be_domain,omitempty"`
	HasLoginPolicy        bool            `json:"has_login_policy,omitempty"`
	LoginIDPs             []string        `json:"login_idps,omitempty"`
	IDPs                  map[string]*IDP `json:"idps,omitempty"`
	CreatedAt             time.Time       `json:"created_at"`
}

// IDP is an identity provider configured on an instance or org, from either
// the template events or the legacy idp config events.
type IDP struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
	// Type is the provider type of the template events (oidc, google, azure,
	// github, ...); legacy configs are oidc, jwt or saml.
	Type string `json:"type"`
	// Legacy is true for an IdP configured through the idp config events.
	Legacy         bool            `json:"legacy,omitempty"`
	Issuer         string          `json:"issuer,omitempty"`
	ClientID       string          `json:"client_id,omitempty"`
	ClientSecret   *v4.CryptoValue `json:"client_secret,omitempty"`
	Scopes         []string        `json:"scopes,omitempty"`
	IDTokenMapping bool            `json:"id_token_mapping,omitempty"`
	UsePKCE        bool            `json:"use_pkce,omitempty"`
	Options        IDPOptions      `json:"options"`
	Removed        bool            `json:"removed,omitempty"`
}

// IDPOptions are v4's provider options.
type IDPOptions struct {
	IsCreationAllowed bool `json:"isCreationAllowed,omitempty"`
	IsLinkingAllowed  bool `json:"isLinkingAllowed,omitempty"`
	IsAutoCreation    bool `json:"isAutoCreation,omitempty"`
	IsAutoUpdate      bool `json:"isAutoUpdate,omitempty"`
	AutoLinkingOption int  `json:"autoLinkingOption,omitempty"`
}

// User is the folded state of a v4 user aggregate, human or machine.
type User struct {
	// OrgID is the owner of the newest create event: a removed user's id can
	// return under another org.
	OrgID     string    `json:"org_id"`
	Machine   bool      `json:"machine,omitempty"`
	State     string    `json:"state"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"created_at"`

	FirstName         string `json:"first_name,omitempty"`
	LastName          string `json:"last_name,omitempty"`
	NickName          string `json:"nick_name,omitempty"`
	DisplayName       string `json:"display_name,omitempty"`
	PreferredLanguage string `json:"preferred_language,omitempty"`
	Gender            int    `json:"gender,omitempty"`

	Email         string `json:"email,omitempty"`
	EmailVerified bool   `json:"email_verified,omitempty"`
	Phone         string `json:"phone,omitempty"`
	PhoneVerified bool   `json:"phone_verified,omitempty"`

	// PasswordHash is the passwap encoding v4 verifies the password with.
	PasswordHash           string `json:"password_hash,omitempty"`
	PasswordChangeRequired bool   `json:"password_change_required,omitempty"`

	TOTP          bool            `json:"totp,omitempty"`
	OTPSMS        bool            `json:"otp_sms,omitempty"`
	OTPEmail      bool            `json:"otp_email,omitempty"`
	U2F           map[string]bool `json:"u2f,omitempty"`
	Passkeys      map[string]bool `json:"passkeys,omitempty"`
	RecoveryCodes bool            `json:"recovery_codes,omitempty"`
	MetadataKeys  map[string]bool `json:"metadata_keys,omitempty"`
	Avatar        bool            `json:"avatar,omitempty"`
	Address       bool            `json:"address,omitempty"`

	// Links are the user's IdP links, keyed by LinkKey.
	Links map[string]Link `json:"links,omitempty"`

	MachineKeys   map[string]bool `json:"machine_keys,omitempty"`
	PATs          map[string]bool `json:"pats,omitempty"`
	MachineSecret bool            `json:"machine_secret,omitempty"`
}

// Link is a user's link to an account at an IdP.
type Link struct {
	IDPID          string `json:"idp_id"`
	ExternalUserID string `json:"external_user_id"`
	DisplayName    string `json:"display_name,omitempty"`
}

// LinkKey keys a link in User.Links. v4 IdP ids are numeric, so the first
// "|" separates the two; a NUL would be shorter but JSONB refuses \u0000.
func LinkKey(idpID, externalUserID string) string {
	return idpID + "|" + externalUserID
}

// Object is the folded state of an aggregate the migrator only counts.
type Object struct {
	Live   bool            `json:"live,omitempty"`
	Apps   map[string]bool `json:"apps,omitempty"`
	Roles  map[string]bool `json:"roles,omitempty"`
	Grants map[string]bool `json:"grants,omitempty"`
}
