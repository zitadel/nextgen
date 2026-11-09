package domain

import "time"

// PrefixOAuthSettings is the ID namespace of an OAuth settings revision
// (oauthset_<opaque>), the resource a release pins under `kind: oauth`. Its
// permission scopes are oauth_settings.read and oauth_settings.write.
const PrefixOAuthSettings ResourcePrefix = "oauthset"

// ReleaseOAuthHandle is the handle every OAuth settings pointer carries. Like
// branding, a project has exactly one, so the handle is a constant and
// revision_id is what varies between releases.
const ReleaseOAuthHandle = "default"

func ErrOAuthSettingsNotFound() Error {
	return newError(PrefixOAuthSettings.ErrorCodePrefix("not_found"), "oauth settings: not found", nil, nil)
}

func ErrOAuthSettingsInvalid(details any, parent error) Error {
	return newError(PrefixOAuthSettings.ErrorCodePrefix("invalid"), "oauth settings: invalid", details, parent)
}

func ErrOAuthSettingsMissingProjectID() Error {
	return newError(PrefixOAuthSettings.ErrorCodePrefix("missing_project_id"), "oauth settings: missing project id", nil, nil)
}

func ErrOAuthSettingsPermissionDenied() Error {
	return newError(PrefixOAuthSettings.ErrorCodePrefix("permission_denied"), "oauth settings: requires an operator-grade token bound to the project (project.write or an oauth_settings.* scope)", nil, nil)
}

// OAuthSettings is one immutable revision of a project's OAuth settings:
// whether the project's authorization server answers. A release is the only
// writer; revisions are never updated or deleted, and the deployed release's
// pin decides which one applies to an origin.
type OAuthSettings struct {
	ProjectID string
	ID        string
	Enabled   bool
	CreatedAt time.Time
}

// Equal reports whether s and other carry the same author-facing content.
// Identity fields (project, revision id, timestamps) are ignored.
func (s *OAuthSettings) Equal(other *OAuthSettings) bool {
	if s == nil || other == nil {
		return s == other
	}
	return s.Enabled == other.Enabled
}

// OAuthSettingsField enumerates the fields of OAuthSettings which can be
// used for filtering and ordering in list operations.
type OAuthSettingsField uint8

const (
	OAuthSettingsFieldUnspecified OAuthSettingsField = iota
	OAuthSettingsFieldProjectID
	OAuthSettingsFieldID
	OAuthSettingsFieldCreatedAt
)

// NewOAuthSettings builds a new revision and validates it with
// [ValidateOAuthSettings].
func NewOAuthSettings(projectID string, enabled bool) (*OAuthSettings, error) {
	s := &OAuthSettings{
		ProjectID: projectID,
		Enabled:   enabled,
		CreatedAt: time.Now().UTC(),
	}
	if err := ValidateOAuthSettings(s); err != nil {
		return nil, err
	}
	return s, nil
}

// ValidateOAuthSettings is the save gate for OAuth settings revisions. The
// one field is a boolean, so only the project binding can be wrong today;
// every later field joins this check.
func ValidateOAuthSettings(s *OAuthSettings) error {
	if s == nil {
		return ErrOAuthSettingsInvalid("oauth settings are required", nil)
	}
	if s.ProjectID == "" {
		return ErrOAuthSettingsMissingProjectID()
	}
	return nil
}
