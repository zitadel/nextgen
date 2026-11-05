package migratev4

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// The binding names the source and the options, not the migrator's version,
// and still recognizes the forms earlier builds wrote.
func TestBindings(t *testing.T) {
	opts := Options{Identifier: IdentifierEmail, DefaultOrgUsers: DefaultOrgUsersTeam}
	binding, earlier := bindings("identity", opts, "https://base")
	again, _ := bindings("identity", opts, "https://base")
	assert.Equal(t, binding, again)
	assert.Equal(t, []string{
		fingerprint([]any{2, 2, "identity", "", IdentifierEmail, DefaultOrgUsersTeam, "https://base"}),
		fingerprint([]any{3, 3, "identity", "", IdentifierEmail, DefaultOrgUsersTeam, "https://base"}),
	}, earlier)
	assert.NotContains(t, earlier, binding)

	other, _ := bindings("identity", Options{Identifier: IdentifierLoginName, DefaultOrgUsers: DefaultOrgUsersTeam}, "https://base")
	assert.NotEqual(t, binding, other, "another identifier is another binding")
}
