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

type ProjectCreatedPayload struct {
	Name string `json:"name,omitempty"`
}

type ProjectUpdatedPayload struct {
	ChangedKeys []string `json:"changed_keys,omitempty"`
}

type ProjectDeletedPayload struct{}

type UserCreatedPayload struct {
	UserID   string `json:"user_id"`
	SchemaID string `json:"schema_id,omitempty"`
}

type UserUpdatedPayload struct {
	ChangedKeys []string `json:"changed_keys"`
}

type UserCreateFailedPayload struct {
	KeyName string `json:"key_name,omitempty"`
}

type UserDeactivatedPayload struct {
	Reason string `json:"reason,omitempty"`
}

type UserDeletedPayload struct{}

type TeamCreatedPayload struct {
	Name string `json:"name,omitempty"`
}

type TeamUpdatedPayload struct {
	ChangedKeys []string `json:"changed_keys,omitempty"`
}

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

type AuthAttemptCreatedPayload struct {
	FlowID string `json:"flow_id,omitempty"`
}

type AuthAttemptHandedOffPayload struct {
	SessionID string `json:"session_id,omitempty"`
}

type AuthCheckPayload struct {
	CheckID   string `json:"check_id"`
	CheckType string `json:"check_type,omitempty"`
}

type ClaimChallengeCreatedPayload struct{}

type ClaimCompletedPayload struct {
	TeamID string `json:"team_id,omitempty"`
}

type FlowdefPayload struct {
	Name string `json:"name,omitempty"`
}

type SchemaPayload struct {
	SchemaID string `json:"schema_id,omitempty"`
}

type BrandingCreatedPayload struct {
	Layout string `json:"layout,omitempty"`
}

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
