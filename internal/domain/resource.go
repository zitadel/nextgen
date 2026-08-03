package domain

// ResourcePrefix is the ID namespace for each domain resource ("user_xxxx").
// Error codes often reuse that token for the resource's public API
// ("user.not_found") but may use a parent or surface prefix instead.
// Permission scopes follow the catalog name, not necessarily the ID abbrev.
type ResourcePrefix string

func (p ResourcePrefix) IDPrefix(id string) string {
	return string(p) + "_" + id
}

func (p ResourcePrefix) ErrorCodePrefix(code string) string {
	return string(p) + "." + code
}
