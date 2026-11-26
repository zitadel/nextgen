// Package login renders and drives the Zitadel login flow server-side, so a
// Go web app can mount a working login at a route.
package login

import (
	"embed"
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"slices"
	"strings"
	"sync"
	"unicode"

	"go.zitadel.com/zitadel/v5/api"
)

// locales/*.json is generated from the components package's TS catalogs by
// scripts/generate-go-login-assets.ts; the TS stays the one home for copy.
//
//go:embed locales/*.json
var localeFS embed.FS

// catalogs is every built-in locale by language tag, parsed on first use.
var catalogs = sync.OnceValue(func() map[string]map[string]string {
	entries, err := localeFS.ReadDir("locales")
	if err != nil {
		panic(err)
	}
	out := make(map[string]map[string]string, len(entries))
	for _, entry := range entries {
		data, err := localeFS.ReadFile(path.Join("locales", entry.Name()))
		if err != nil {
			panic(err)
		}
		var texts map[string]string
		if err := json.Unmarshal(data, &texts); err != nil {
			panic(fmt.Errorf("login: locale %s: %w", entry.Name(), err))
		}
		// The generator's DO-NOT-EDIT marker is not copy.
		delete(texts, "$comment")
		out[strings.TrimSuffix(entry.Name(), ".json")] = texts
	}
	return out
})

// Texts resolves the text keys the API sends to one locale's copy.
type Texts struct {
	// Locale is a built-in language tag (en, de, it); anything else reads as en.
	Locale string
}

// lookup is key's copy in the locale, else in English. ok tells a key the
// catalogs lack from one whose copy is deliberately empty.
// catalog is the catalog the locale renders from: its own when it is built
// in, else English. A variant key is offered only when this one has it, so a
// localised plain sentence always beats an English variant.
func (t Texts) catalog() map[string]string {
	all := catalogs()
	if c, ok := all[t.Locale]; ok {
		return c
	}
	return all["en"]
}

func (t Texts) lookup(key string) (string, bool) {
	all := catalogs()
	if v, ok := all[t.Locale][key]; ok {
		return v, true
	}
	v, ok := all["en"][key]
	return v, ok
}

// Text is key's copy, with the fallbacks of the browser widget's `t` filter
// (packages/components/src/orchestrator/liquid.ts) for the keys the server
// derives from tenant-chosen step and field names, which no catalog can
// list: `<step>.description.sso` reads as `<step>.description`,
// `<step>.action.back` as `action.back`, and `<step>.field.<prop>` as the
// property name in words. Any other unknown key is returned itself: the API
// never sends rendered strings, so a miss stays visible rather than blank.
func (t Texts) Text(key string) string {
	if v, ok := t.lookup(key); ok {
		return v
	}
	if step, ok := strings.CutSuffix(key, ".description.sso"); ok {
		if v, ok := t.lookup(step + ".description"); ok {
			return v
		}
	}
	if strings.HasSuffix(key, ".action.back") {
		if v, ok := t.lookup("action.back"); ok {
			return v
		}
	}
	// The last marker: a step name may itself contain ".field.".
	if i := strings.LastIndex(key, ".field."); i >= 0 {
		if field := key[i+len(".field."):]; field != "" && !strings.Contains(field, ".") {
			return capitalise(humanise(field))
		}
	}
	return key
}

// collectsCustomIdentifier reports whether the step collects the user's
// identifier and it is not an email address. The server marks the identifier
// field autocomplete="username" whatever its type, so that token finds it.
func collectsCustomIdentifier(fields []api.Field) bool {
	i := slices.IndexFunc(fields, func(f api.Field) bool {
		return slices.Contains(strings.Fields(strings.ToLower(f.Autocomplete.Or(""))), "username")
	})
	return i >= 0 && fields[i].Type != api.FieldTypeEmail
}

// DescriptionKey is the key a step's description renders with. A step that
// collects an identifier other than an email describes itself with the
// `.custom_identifier` variant where the catalog has one, since the plain
// sentence may name the email above a differently labelled field ("Enter your
// email to continue" over an "Employee number"). The variant replaces the
// `.sso` one too: a provider sentence may name the email as well, and leaving
// the providers out of the subtitle is the smaller loss, since they show on
// the step anyway. Mirrors stepTexts in the widget's liquid.ts.
func (t Texts) DescriptionKey(key string, fields []api.Field) string {
	if key == "" || !collectsCustomIdentifier(fields) {
		return key
	}
	plain := strings.TrimSuffix(key, ".sso")
	if !strings.HasSuffix(plain, ".description") {
		return key
	}
	if variant := plain + ".custom_identifier"; t.catalog()[variant] != "" {
		return variant
	}
	return key
}

// NoticeKey is the key a step's notice renders with, by DescriptionKey's
// rule: the register step a sign-in moved to sign-up says the email had no
// account, and points at an email field it does not show. A step that does
// not collect the identifier cannot tell, and its notices are worded for any
// identifier instead. Mirrors stepNotice in the widget's liquid.ts.
func (t Texts) NoticeKey(notice string, fields []api.Field) string {
	if !collectsCustomIdentifier(fields) {
		return notice
	}
	if variant := notice + ".custom_identifier"; t.catalog()[variant] != "" {
		return variant
	}
	return notice
}

// errorRules are the validation-rule suffixes of a `error.<field>_<rule>`
// key, each with the generic entry that names the field, as the widget's
// localiseFlowErrorKeys has them.
var errorRules = []struct{ suffix, generic string }{
	{"_required", "error.field_required"},
	{"_min_length", "error.field_min_length"},
	{"_max_length", "error.field_max_length"},
	{"_format", "error.field_format"},
	{"_invalid", "error.field_format"},
	{"_unknown_field", "error.field_invalid"},
}

// Errors is a step's error as sentences: one per `"; "`-joined `error.*`
// key. A key the catalogs know is its copy, or its `.title` and `.body`
// when it has only those; a `error.<field>_<rule>` key of a field no
// catalog lists reads from the rule's generic entry with the field in
// words. Anything else, or a payload that is not all `error.*` keys, is
// shown as it came.
//
// shortcut: a length rule says "too short", not the field's bound; pass the
// step's validations through when a schema sets one.
func (t Texts) Errors(raw string) []string {
	keys := strings.Split(raw, "; ")
	if slices.ContainsFunc(keys, func(k string) bool { return !strings.HasPrefix(k, "error.") }) {
		return []string{t.Text(raw)}
	}
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		out = append(out, t.errorText(key))
	}
	return out
}

func (t Texts) errorText(key string) string {
	if v, ok := t.lookup(key); ok {
		return v
	}
	title, hasTitle := t.lookup(key + ".title")
	body, hasBody := t.lookup(key + ".body")
	if hasTitle || hasBody {
		return strings.TrimSpace(title + " " + body)
	}
	if field, rule, ok := ruleField(key); ok {
		generic, found := t.lookup(rule)
		if !found {
			generic, _ = t.lookup("error.field_invalid")
		}
		return capitalise(strings.ReplaceAll(generic, "{0}", humanise(field)))
	}
	return key
}

// ruleField splits a validation-rule error key, error.<field>_<rule>, into
// the field it names and the catalog key of its rule's generic copy.
func ruleField(key string) (field, rule string, ok bool) {
	if !strings.HasPrefix(key, "error.") {
		return "", "", false
	}
	for _, r := range errorRules {
		if f, cut := strings.CutSuffix(strings.TrimPrefix(key, "error."), r.suffix); cut && f != "" {
			return f, r.generic, true
		}
	}
	return "", "", false
}

// knownErrors reports whether every key of raw is one the server could
// have sent for a step with fields: a catalog key, or a validation rule on
// one of those fields. It keeps a URL-borne error from carrying free text.
func (t Texts) knownErrors(raw string, fields []string) bool {
	for _, key := range strings.Split(raw, "; ") {
		if !strings.HasPrefix(key, "error.") {
			return false
		}
		if _, ok := t.lookup(key); ok {
			continue
		}
		if _, ok := t.lookup(key + ".title"); ok {
			continue
		}
		if field, _, ok := ruleField(key); ok && slices.Contains(fields, field) {
			continue
		}
		return false
	}
	return true
}

var camelBoundary = regexp.MustCompile(`([a-z0-9])([A-Z])`)

// humanise is a schema property name in words: the part after a credential
// prefix's `#`, camel case split, separators as spaces, lower case.
func humanise(field string) string {
	field = field[strings.LastIndex(field, "#")+1:]
	field = camelBoundary.ReplaceAllString(field, "$1 $2")
	field = strings.Join(strings.FieldsFunc(field, func(r rune) bool { return strings.ContainsRune("_.-", r) }), " ")
	return strings.ToLower(strings.TrimSpace(field))
}

func capitalise(s string) string {
	for i, r := range s {
		return string(unicode.ToUpper(r)) + s[i+len(string(r)):]
	}
	return s
}
