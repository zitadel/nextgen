package idp

import (
	"fmt"
	"slices"
	"strings"
)

// standardClaim is a claim OpenID Connect Core 5.4 defines: the scope that
// makes a provider return it, and the JSON type of its value.
type standardClaim struct {
	scope string
	typ   string
}

// standardClaims mirrors STANDARD_CLAIMS in packages/config/src/idp/standard-claims.ts,
// which the CLI uses to judge the same mapping before it is sent. A test reads
// that file and fails if the two drift.
var standardClaims = map[string]standardClaim{
	"name":                  {"profile", "string"},
	"family_name":           {"profile", "string"},
	"given_name":            {"profile", "string"},
	"middle_name":           {"profile", "string"},
	"nickname":              {"profile", "string"},
	"preferred_username":    {"profile", "string"},
	"profile":               {"profile", "string"},
	"picture":               {"profile", "string"},
	"website":               {"profile", "string"},
	"gender":                {"profile", "string"},
	"birthdate":             {"profile", "string"},
	"zoneinfo":              {"profile", "string"},
	"locale":                {"profile", "string"},
	"updated_at":            {"profile", "number"},
	"email":                 {"email", "string"},
	"email_verified":        {"email", "boolean"},
	"address":               {"address", "object"},
	"phone_number":          {"phone", "string"},
	"phone_number_verified": {"phone", "boolean"},
}

// mutableSubjects are account names that are not standard claims but that a
// user can change just the same.
var mutableSubjects = map[string]bool{"login": true, "username": true}

// vouchesFor names the claim each standard verification claim speaks for.
var vouchesFor = map[string]string{
	"email_verified":        "email",
	"phone_number_verified": "phone_number",
}

// MappingProblems reports what is wrong with a connection document's claim
// mapping that the document alone shows: it needs no user schema, so it can
// be checked where the document is stored. Each problem names the field and
// what to change. The CLI makes the same checks, plus the ones that need the
// user schemas, before a document is sent.
func MappingProblems(doc map[string]any) []string {
	mapping := stringMap(doc["claim_mapping"])
	verified, _ := doc["verified_claims"].(map[string]any)
	var problems []string

	for _, property := range sortedKeys(verified) {
		if _, ok := mapping[property]; !ok {
			problems = append(problems, fmt.Sprintf(
				"verified_claims has %q but claim_mapping does not map it, so it can never verify. Map it, or remove it from verified_claims",
				property))
		}
	}

	subject, _ := doc["subject_claim"].(string)
	for _, name := range append(append(valuesOf(mapping), sourcesOf(verified)...), subject) {
		if name != strings.TrimSpace(name) {
			problems = append(problems, fmt.Sprintf(
				"%q has a space at its start or end, so no provider sends a claim by that name. Remove the space", name))
		}
	}
	if _, standard := standardClaims[subject]; standard || mutableSubjects[subject] {
		problems = append(problems, fmt.Sprintf(
			"subject_claim is %q, a profile claim the user can change, and identity keys on the subject. Use a claim that never changes: \"sub\", or a provider-specific one such as \"oid\"",
			subject))
	}

	for _, property := range sortedKeys(verified) {
		source, ok := verified[property].(string)
		if !ok {
			continue
		}
		if claim, standard := standardClaims[source]; standard && claim.typ != "boolean" {
			problems = append(problems, fmt.Sprintf(
				"verified_claims reads %q to verify %q, but that is a %s claim and only a boolean true counts as verified. Read the boolean claim the provider sends for this value (such as \"email_verified\"). Only use true to trust the provider outright, which is safe only if it never returns an unverified value",
				source, property, claim.typ))
		}
		if speaksFor, ok := vouchesFor[source]; ok {
			if read, mapped := mapping[property]; mapped && read != speaksFor {
				problems = append(problems, fmt.Sprintf(
					"verified_claims reads %q for %q, but it only vouches for the claim %q and %q is filled from %q. Fill %q from %q, or read a claim that vouches for %q",
					source, property, speaksFor, property, read, property, speaksFor, read))
			}
		}
	}

	return problems
}

func stringMap(value any) map[string]string {
	raw, _ := value.(map[string]any)
	out := make(map[string]string, len(raw))
	for key, item := range raw {
		if text, ok := item.(string); ok {
			out[key] = text
		}
	}
	return out
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}

func valuesOf(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for _, key := range sortedKeys(m) {
		out = append(out, m[key])
	}
	return out
}

func sourcesOf(verified map[string]any) []string {
	var out []string
	for _, key := range sortedKeys(verified) {
		if source, ok := verified[key].(string); ok {
			out = append(out, source)
		}
	}
	return out
}
