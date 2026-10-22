package idp

import (
	"encoding/json"
	"os"
	"regexp"
	"testing"

	"github.com/stretchr/testify/require"
)

func problemsOf(t *testing.T, document string) []string {
	t.Helper()
	var doc map[string]any
	require.NoError(t, json.Unmarshal([]byte(document), &doc))
	return MappingProblems(doc)
}

func TestMappingProblems(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		document string
		want     string
	}{
		"a verification for a property nothing maps": {
			`{"claim_mapping":{"email":"mail"},"verified_claims":{"phone":"phone_ok"}}`,
			`verified_claims has "phone" but claim_mapping does not map it`,
		},
		"a trust-all verification for a property nothing maps": {
			`{"verified_claims":{"email":true}}`,
			`verified_claims has "email"`,
		},
		"a claim name with a space at its end": {
			`{"claim_mapping":{"email":"mail "}}`,
			`"mail " has a space`,
		},
		"a verification source with a space at its start": {
			`{"claim_mapping":{"email":"mail"},"verified_claims":{"email":" ok"}}`,
			`" ok" has a space`,
		},
		"a subject claim with a space": {
			`{"subject_claim":"oid "}`,
			`"oid " has a space`,
		},
		"a subject that is a profile claim": {
			`{"subject_claim":"preferred_username"}`,
			`subject_claim is "preferred_username"`,
		},
		"a verification that reads a string claim": {
			`{"claim_mapping":{"email":"email"},"verified_claims":{"email":"email"}}`,
			`that is a string claim`,
		},
		"an email verified by the claim for another": {
			`{"claim_mapping":{"email":"mail"},"verified_claims":{"email":"email_verified"}}`,
			`only vouches for the claim "email"`,
		},
		"a phone verified by the claim for another": {
			`{"claim_mapping":{"phone":"mobile"},"verified_claims":{"phone":"phone_number_verified"}}`,
			`only vouches for the claim "phone_number"`,
		},
		"a login name as the subject": {
			`{"subject_claim":"login"}`,
			`subject_claim is "login"`,
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			require.Contains(t, joined(problemsOf(t, tc.document)), tc.want)
		})
	}
}

func TestMappingProblemsAcceptsWhatWorks(t *testing.T) {
	t.Parallel()
	for name, document := range map[string]string{
		"nothing mapped":                            `{}`,
		"the standard mapping":                      `{"claim_mapping":{"email":"email","givenName":"given_name"},"verified_claims":{"email":"email_verified"},"oidc":{"scopes":["openid","profile","email"]}}`,
		"a trust-all verification":                  `{"claim_mapping":{"email":"email"},"verified_claims":{"email":true}}`,
		"custom claims, any scopes":                 `{"claim_mapping":{"staffNumber":"employee_id"},"oidc":{"scopes":["openid"]}}`,
		"a provider-specific subject":               `{"subject_claim":"oid"}`,
		"the stable subject":                        `{"subject_claim":"sub"}`,
		"a custom scope that may bundle the claims": `{"claim_mapping":{"email":"email"},"oidc":{"scopes":["openid","directory"]}}`,
		"scopes absent from the document":           `{"claim_mapping":{"email":"email"}}`,
		"a verification of a custom claim":          `{"claim_mapping":{"email":"mail"},"verified_claims":{"email":"mail_confirmed"}}`,
		"a verification disabled":                   `{"claim_mapping":{"email":"mail"},"verified_claims":{"email":false}}`,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			require.Empty(t, problemsOf(t, document))
		})
	}
}

func TestMappingProblemsAreInAStableOrder(t *testing.T) {
	t.Parallel()
	document := `{"verified_claims":{"b":true,"a":true,"c":true}}`
	first := problemsOf(t, document)
	for range 20 {
		require.Equal(t, first, problemsOf(t, document))
	}
}

// The standard claims are copied from the TypeScript table the CLI judges the
// same mapping with, so an edit to one that misses the other fails here.
func TestStandardClaimsMatchTheCLITable(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile("../../packages/config/src/idp/standard-claims.ts")
	require.NoError(t, err)
	row := regexp.MustCompile(`(?m)^\s+(\w+): \{ scope: "(\w+)", type: "(\w+)" \},$`)
	found := map[string]standardClaim{}
	for _, match := range row.FindAllStringSubmatch(string(raw), -1) {
		found[match[1]] = standardClaim{scope: match[2], typ: match[3]}
	}
	require.NotEmpty(t, found)
	require.Equal(t, found, standardClaims)
}

func joined(problems []string) string {
	out := ""
	for _, problem := range problems {
		out += problem + "\n"
	}
	return out
}
