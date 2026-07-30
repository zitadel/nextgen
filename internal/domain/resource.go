package domain

// ResourcePrefix is the shared namespace for each domain resource.
// Used as both the ID prefix ("user_xxxx") and error code prefix ("user.not_found").
type ResourcePrefix string

func (p ResourcePrefix) IDPrefix(id string) string {
	return string(p) + "_" + id
}

func (p ResourcePrefix) ErrorCodePrefix(code string) string {
	return string(p) + "." + code
}
