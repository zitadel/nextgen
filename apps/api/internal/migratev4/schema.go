package migratev4

import (
	"encoding/json"
	"strings"

	"github.com/zitadel/nextgen/internal/migratev4/stage"
)

// objectTypeHuman is the default schema's objectType. The v4 schema is a new
// revision of it, so the default login flow finds migrated users: sign-in
// looks a user up across every revision of the flow's objectType (ADR 058 §5).
const objectTypeHuman = "human-user"

// userSchema returns the v4-shaped revision of the human-user schema. Only the
// identifier is required: v4 leaves everything else optional.
func userSchema(builtinPublicBase, identifier string, ssoSlugs []string) ([]byte, error) {
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	unique := func(property map[string]any) map[string]any {
		property["x-unique"] = "project"
		return property
	}
	properties := map[string]any{
		"email":              map[string]any{"type": "string", "format": "email", "description": "The user's email address."},
		"login_name":         unique(str("The preferred login name the user had in Zitadel v4.")),
		"username":           str("The username the user had in Zitadel v4."),
		"given_name":         str("Given name."),
		"family_name":        str("Family name."),
		"nickname":           str("Nickname."),
		"display_name":       str("Display name."),
		"preferred_language": str("Preferred language, a BCP 47 tag."),
		"gender":             map[string]any{"type": "string", "enum": []string{"female", "male", "diverse"}},
		"phone":              str("Phone number in E.164."),
		"email_verified":     map[string]any{"type": "boolean", "description": "Whether Zitadel v4 had verified the email. Informational."},
		"phone_verified":     map[string]any{"type": "boolean", "description": "Whether Zitadel v4 had verified the phone. Informational."},
		"zitadel_v4_id":      unique(str("The user's id in Zitadel v4.")),
	}
	if identifier == IdentifierEmail {
		unique(properties["email"].(map[string]any))
	}
	methods := map[string]any{
		"password": map[string]any{"enabled": true},
		"passkey":  map[string]any{"enabled": true},
	}
	if len(ssoSlugs) > 0 {
		methods["sso"] = map[string]any{"enabled": true, "providers": ssoSlugs}
	}
	return json.Marshal(map[string]any{
		"title":          "Zitadel v4 human user",
		"$schema":        "https://json-schema.org/draft/2020-12/schema",
		"metaSchema":     strings.TrimSuffix(builtinPublicBase, "/") + "/user-schema.json",
		"objectType":     objectTypeHuman,
		"kind":           "user-schema",
		"type":           "object",
		"description":    "Human users migrated from Zitadel v4 by `nextgen migrate-v4`.",
		"x-identifier":   identifier,
		"x-display":      []string{"display_name"},
		"x-auth-methods": methods,
		"required":       []string{identifier},
		"properties":     properties,
	})
}

// userAttributes maps a staged v4 user onto the schema's properties, leaving
// out what v4 left empty.
func userAttributes(userID string, u *stage.User, loginName string) map[string]any {
	attributes := map[string]any{
		"zitadel_v4_id": userID,
		"username":      u.Username,
		"login_name":    loginName,
	}
	set := func(key, value string) {
		if value != "" {
			attributes[key] = value
		}
	}
	set("email", u.Email)
	set("given_name", u.FirstName)
	set("family_name", u.LastName)
	set("nickname", u.NickName)
	set("display_name", u.DisplayName)
	set("phone", u.Phone)
	if u.PreferredLanguage != "und" {
		set("preferred_language", u.PreferredLanguage)
	}
	switch u.Gender {
	case 1:
		attributes["gender"] = "female"
	case 2:
		attributes["gender"] = "male"
	case 3:
		attributes["gender"] = "diverse"
	}
	if u.Email != "" {
		attributes["email_verified"] = u.EmailVerified
	}
	if u.Phone != "" {
		attributes["phone_verified"] = u.PhoneVerified
	}
	return attributes
}
