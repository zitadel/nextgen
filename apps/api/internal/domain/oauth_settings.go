package domain

// PrefixOAuthSettings is the ID namespace of an OAuth settings revision
// (oauthset_<opaque>), the resource a release pins under `kind: oauth`. Its
// permission scopes are oauth_settings.read and oauth_settings.write.
const PrefixOAuthSettings ResourcePrefix = "oauthset"

// ReleaseOAuthHandle is the handle every OAuth settings pointer carries. Like
// branding, a project has exactly one, so the handle is a constant and
// revision_id is what varies between releases.
const ReleaseOAuthHandle = "default"

// ErrOAuthSettingsNotFound reports that no OAuth settings revision has the
// given ID.
func ErrOAuthSettingsNotFound() Error {
	return newError(PrefixOAuthSettings.ErrorCodePrefix("not_found"), "oauth settings: not found", nil, nil)
}
