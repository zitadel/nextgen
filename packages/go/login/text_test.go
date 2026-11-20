package login

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTexts(t *testing.T) {
	// en is the fallback, so a key only another locale knows would never be
	// reached through it in English.
	en := catalogs()["en"]
	for _, locale := range []string{"de", "it"} {
		for key := range catalogs()[locale] {
			assert.Contains(t, en, key, "%s has a key en lacks", locale)
		}
	}

	assert.Equal(t, "Sign in", Texts{}.Text("identifier.title"))
	assert.Equal(t, "Anmelden", Texts{Locale: "de"}.Text("identifier.title"))
	assert.Equal(t, "Accedi", Texts{Locale: "it"}.Text("identifier.title"))
	assert.Equal(t, "Sign in", Texts{Locale: "fr"}.Text("identifier.title"), "unknown locale falls back to en")
	assert.Equal(t, "no.such.key", Texts{Locale: "de"}.Text("no.such.key"))

	// The widget's fallbacks for keys derived from step and field names.
	assert.Equal(t, "", Texts{}.Text("done.description"), "deliberately empty copy is not a miss")
	assert.Equal(t, "Enter your email to continue", Texts{}.Text("identifier.description.sso"), "a step with providers reads the plain description")
	assert.Equal(t, "Enter your password or continue with your sign-in provider", Texts{}.Text("password.description.sso"), "unless it has its own")
	assert.Equal(t, "Back", Texts{}.Text("custom-step.action.back"))
	assert.Equal(t, "Zurück", Texts{Locale: "de"}.Text("custom-step.action.back"))
	assert.Equal(t, "Date of birth", Texts{}.Text("register.field.dateOfBirth"))
	assert.Equal(t, "Password", Texts{}.Text("custom.field.x-auth-methods#password"))
	assert.Equal(t, "Given name", Texts{}.Text("a.field.b.field.given_name"), "the last marker")
	assert.Equal(t, "custom.field.phone.help", Texts{}.Text("custom.field.phone.help"), "sub-keys stay raw")
}

func TestTextsErrors(t *testing.T) {
	en := Texts{}
	assert.Equal(t, []string{"Wrong email or password."}, en.Errors("error.invalid_credentials"))
	assert.Equal(t, []string{"Please enter an email address", "Please enter a password"},
		en.Errors("error.email_required; error.password_required"), "one sentence per key")
	assert.Equal(t, []string{"We couldn't complete your sign in. Please try again in a few minutes"},
		en.Errors("error.sign_in_server"), "a key with only .title and .body")
	assert.Equal(t, []string{"Date of birth is required."}, en.Errors("error.dateOfBirth_required"), "a rule on a field no catalog lists")
	assert.Equal(t, []string{"Please enter a valid phone number."}, en.Errors("error.phone_number_invalid"))
	assert.Equal(t, []string{"Please check nickname."}, en.Errors("error.nickname_unknown_field"))
	assert.Equal(t, []string{"Geburtsdatum ist erforderlich."}, Texts{Locale: "de"}.Errors("error.geburtsdatum_required"))
	assert.Equal(t, []string{"error.something_else"}, en.Errors("error.something_else"), "unknown without a rule stays raw")
	assert.Equal(t, []string{"not a key"}, en.Errors("not a key"), "a payload that is not error keys is shown as it came")

	fields := []string{"email", "password"}
	assert.True(t, en.knownErrors("error.invalid_credentials", nil))
	assert.True(t, en.knownErrors("error.sign_in_server", nil))
	assert.True(t, en.knownErrors("error.email_required; error.password_min_length", fields))
	assert.False(t, en.knownErrors("error.phone_required", fields), "a rule on a field the step lacks")
	assert.False(t, en.knownErrors("error.email_required; Call 555", fields))
	assert.False(t, en.knownErrors("identifier.title", nil), "a known key that is not an error")
}
