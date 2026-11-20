package view_test

import (
	"strings"
	"testing"

	"github.com/go-faster/jx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"go.zitadel.com/zitadel/v5/api"
	"go.zitadel.com/zitadel/v5/login/view"
)

// upper stands in for a locale: every key renders upper-cased, so a test can
// tell a resolved key from a literal; an error payload is one key per "; ".
type upper struct{}

func (upper) Text(key string) string { return strings.ToUpper(key) }

func (u upper) Errors(raw string) []string {
	var out []string
	for key := range strings.SplitSeq(raw, "; ") {
		out = append(out, u.Text(key))
	}
	return out
}

func render(t *testing.T, step api.FlowStep) string {
	t.Helper()
	var out strings.Builder
	require.NoError(t, view.Step(step, upper{}, "?flow=flow_1").Render(t.Context(), &out))
	return out.String()
}

func TestField(t *testing.T) {
	for _, tc := range []struct {
		typ   api.FieldType
		value string
		want  string
	}{
		{api.FieldTypeText, `"Ada"`, `<input type="text" value="Ada" autocomplete="name" data-testid="zitadel-input-f" name="f" required>`},
		{api.FieldTypeEmail, ``, `<input type="email" value="" autocomplete="name" data-testid="zitadel-input-f" name="f" required>`},
		{api.FieldTypePassword, ``, `<input type="password" value=""`},
		{api.FieldTypeTel, ``, `<input type="tel"`},
		{api.FieldTypeNumber, `42.50`, `<input type="number" value="42.50"`},
		{api.FieldTypeURL, ``, `<input type="url"`},
		{api.FieldTypeDate, ``, `<input type="date"`},
		{api.FieldTypeDateTime, ``, `<input type="datetime-local"`},
		{api.FieldTypeHidden, `"x"`, `<input type="hidden" name="f" value="x">`},
		{api.FieldTypeCheckbox, `true`, `<input type="checkbox" value="true" checked autocomplete="name" data-testid="zitadel-checkbox-f" name="f" required>`},
		{api.FieldTypeSelect, `"b"`, `<select autocomplete="name" data-testid="zitadel-select-f" name="f" required><option value=""></option> <option value="a">a</option><option value="b" selected>b</option></select>`},
	} {
		t.Run(string(tc.typ), func(t *testing.T) {
			field := api.Field{
				Name:         "f",
				Type:         tc.typ,
				TextKey:      "f.label",
				Autocomplete: api.NewOptString("name"),
				Required:     api.NewOptBool(true),
				Value:        jx.Raw(tc.value),
				Validation:   api.NewOptFieldValidation(api.FieldValidation{Enum: []string{"a", "b"}}),
			}
			html := render(t, api.FlowStep{Fields: []api.Field{field}})
			assert.Contains(t, html, tc.want)
			if tc.typ != api.FieldTypeHidden {
				assert.Contains(t, html, "F.LABEL", "the label is resolved")
			}
		})
	}

	html := render(t, api.FlowStep{Fields: []api.Field{{Name: "f", Type: api.FieldTypeText, ReadOnly: api.NewOptBool(true)}}})
	assert.Contains(t, html, `<input type="text" value="" data-testid="zitadel-input-f" name="f" readonly>`, "no autocomplete attribute when the API sends none")
	html = render(t, api.FlowStep{Fields: []api.Field{{Name: "f", Type: api.FieldTypeText, Value: jx.Raw(`null`)}}})
	assert.Contains(t, html, `value=""`, "a null value is no value")
}

func TestStep(t *testing.T) {
	html := render(t, api.FlowStep{
		Name: "password",
		Texts: api.NewOptStepTexts(api.StepTexts{
			TitleKey:       api.NewOptString("password.title"),
			DescriptionKey: api.NewOptNilString("password.description"),
		}),
		Error:      api.NewOptNilString("error.email_required; error.password_required"),
		Notice:     api.NewOptNilString("notice.user_already_exists"),
		Identifier: api.NewOptFlowStepIdentifier(api.FlowStepIdentifier{Value: "a@example.com", Autocomplete: "username"}),
		Actions: []api.FlowStepAction{
			{Name: "submit", Kind: api.FlowStepActionKindSubmit, Primary: api.NewOptBool(true), TextKey: api.NewOptString("password.action.signin")},
			{Name: "back", Kind: api.FlowStepActionKindBack},
			{Name: "passkey", Kind: api.FlowStepActionKindPasskey},
		},
		SSOProviders: []api.SSOProvider{{ID: "idp_1", Name: "Example"}},
	})

	// novalidate: without it the browser refuses the passkey button's
	// requestSubmit() while a required field is empty, and drops the proof.
	assert.Contains(t, html, `<form method="post" action="?flow=flow_1" class="step" data-step="password" novalidate>`)
	assert.Contains(t, html, "<h1>PASSWORD.TITLE</h1>")
	assert.Contains(t, html, `<p class="description">PASSWORD.DESCRIPTION</p>`)
	assert.Contains(t, html, `<p class="notice" role="status">NOTICE.USER_ALREADY_EXISTS</p>`)
	assert.Contains(t, html, `<p class="error" role="alert">ERROR.EMAIL_REQUIRED</p><p class="error" role="alert">ERROR.PASSWORD_REQUIRED</p>`, "one alert per key")
	assert.Contains(t, html, `<input class="identifier" type="text" value="a@example.com" autocomplete="username" readonly`)
	assert.Contains(t, html, `<button type="submit" name="action" value="submit" class="action primary" data-testid="zitadel-button-submit">PASSWORD.ACTION.SIGNIN</button>`)
	assert.Contains(t, html, `<button type="submit" name="action" value="back" class="action back" data-testid="zitadel-button-back">BACK</button>`)
	assert.Contains(t, html, `<button type="submit" name="action" value="passkey" class="action" data-testid="zitadel-button-passkey">PASSKEY</button>`, "a passkey action posts like any other")
	assert.Contains(t, html, `<p class="divider">SSO.DIVIDER</p>`)
	assert.Contains(t, html, `<form method="post" action="?flow=flow_1" class="sso"><input type="hidden" name="action" value="sso">`)
	assert.Contains(t, html, `<button type="submit" name="sso_provider_id" value="idp_1" class="action" data-testid="zitadel-sso-idp_1">SSO.CONTINUE_WITH</button></form>`)
}
