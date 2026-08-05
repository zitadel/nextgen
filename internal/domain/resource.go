package domain

import "strings"

// ResourcePrefix is the ID namespace for each domain resource ("user_xxxx").
// Error codes often reuse that token for the resource's public API
// ("user.not_found") but may use a parent or surface prefix instead.
// Permission scopes follow the catalog name, not necessarily the ID abbrev.
type ResourcePrefix string

func (p ResourcePrefix) IDPrefix(id string) string {
	return string(p) + "_" + id
}

// Matches reports whether id is well-formed under this prefix: the registered
// prefix, then "_", then a non-empty body (e.g. "proj_01H..." / "proj_platform").
func (p ResourcePrefix) Matches(id string) bool {
	return len(id) > len(p)+1 && strings.HasPrefix(id, string(p)+"_")
}

func (p ResourcePrefix) ErrorCodePrefix(code string) string {
	return string(p) + "." + code
}
