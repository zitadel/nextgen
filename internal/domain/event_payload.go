package domain

// Typed event payloads (deny-by-default allowlists). Keep in sync with
// docs/design/api/events-catalog.md and OpenAPI Event discriminator schemas.

type RequestAPIPayload struct {
	OperationID   string `json:"operation_id"`
	Method        string `json:"method"`
	RouteTemplate string `json:"route_template"`
	Status        int    `json:"status"`
	DurationMs    int64  `json:"duration_ms"`
}

// ProjectPayload is shared by project.created (full snapshot) and
// project.updated (delta: only changed fields set).
type ProjectPayload struct {
	Name           string   `json:"name,omitempty"`
	PreviewOrigins []string `json:"preview_origins,omitempty"`
}

// ProjectCreatedPayload is an alias kept for call-site clarity.
type ProjectCreatedPayload = ProjectPayload

// ProjectUpdatedPayload is an alias kept for call-site clarity.
type ProjectUpdatedPayload = ProjectPayload

type ProjectDeletedPayload struct{}

// UserCreatedPayload omits user_id (envelope entity_id). Attribute values
// appear only for schema fields marked x-audit.
type UserCreatedPayload struct {
	SchemaID      string         `json:"schema_id,omitempty"`
	AttributeKeys []string       `json:"attribute_keys,omitempty"`
	Attributes    map[string]any `json:"attributes,omitempty"`
}

// UserUpdatedPayload lists keys touched; values only for x-audit fields.
type UserUpdatedPayload struct {
	AttributeKeys []string       `json:"attribute_keys,omitempty"`
	Attributes    map[string]any `json:"attributes,omitempty"`
}

type UserCreateFailedPayload struct {
	KeyName string `json:"key_name,omitempty"`
}

type UserDeactivatedPayload struct {
	Reason string `json:"reason,omitempty"`
}

type UserDeletedPayload struct{}

// TeamPayload is shared by team.created and team.updated (delta on update).
type TeamPayload struct {
	Name string `json:"name,omitempty"`
}

type TeamCreatedPayload = TeamPayload
type TeamUpdatedPayload = TeamPayload

type TeamDeactivatedPayload struct{}

type TeamMembershipUpdatedPayload struct {
	UserID string `json:"user_id"`
	TeamID string `json:"team_id"`
	Status string `json:"status"`
}

type AuthTokenIssuedPayload struct {
	Scopes []string `json:"scopes,omitempty"`
}

type AuthTokenRevokedPayload struct{}

type SessionEstablishedPayload struct {
	UserID string `json:"user_id,omitempty"`
}

type SessionDeletedPayload struct {
	Reason string `json:"reason,omitempty"`
}

type SessionExpiredPayload struct{}

// AuthAttemptCreatedPayload is empty; flow_id/session_id live on event columns.
type AuthAttemptCreatedPayload struct{}

// AuthAttemptHandedOffPayload is empty; session_id lives on the event column.
type AuthAttemptHandedOffPayload struct{}

type AuthCheckPayload struct {
	CheckID       string `json:"check_id"`
	CheckType     string `json:"check_type,omitempty"`
	AuthAttemptID string `json:"auth_attempt_id,omitempty"`
}

type ClaimChallengeCreatedPayload struct{}

type ClaimCompletedPayload struct {
	TeamID string `json:"team_id,omitempty"`
}

// FlowdefPayload is shared by flowdef.created (snapshot) and flowdef.updated (delta).
// Steps are intentionally omitted (large graph).
type FlowdefPayload struct {
	Name       string                 `json:"name,omitempty"`
	Status     string                 `json:"status,omitempty"`
	UserSchema string                 `json:"user_schema,omitempty"`
	Purposes   map[string]string      `json:"purposes,omitempty"`
	Audience   *FlowdefAudiencePayload `json:"audience,omitempty"`
}

// FlowdefAudiencePayload is the allowlisted audience snapshot for flowdef events.
type FlowdefAudiencePayload struct {
	AppIDs  []string `json:"app_ids,omitempty"`
	TeamIDs []string `json:"team_ids,omitempty"`
}

type BrandingPayload struct {
	Layout  string `json:"layout,omitempty"`
	LogoURL string `json:"logo_url,omitempty"`
	FontURL string `json:"font_url,omitempty"`
	HeroURL string `json:"hero_url,omitempty"`
}

// BrandingCreatedPayload is an alias for branding.created.
type BrandingCreatedPayload = BrandingPayload

type AuthzGrantedPayload struct {
	PrincipalType string `json:"principal_type,omitempty"`
	PrincipalID   string `json:"principal_id,omitempty"`
	Relation      string `json:"relation,omitempty"`
}

type AuthzRevokedPayload struct {
	PrincipalType string `json:"principal_type,omitempty"`
	PrincipalID   string `json:"principal_id,omitempty"`
	Relation      string `json:"relation,omitempty"`
}

type AuthFactorPayload struct {
	UserID   string `json:"user_id"`
	FactorID string `json:"factor_id,omitempty"`
}
