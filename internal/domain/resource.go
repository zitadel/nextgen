package domain

import "github.com/zitadel/nextgen/internal/domain/idgen"

// ResourcePrefix is the shared namespace for each domain resource.
// Used as both the ID prefix ("att_xxxx") and error code prefix ("att.not_found").
type ResourcePrefix string

func (p ResourcePrefix) IDPrefix(id string) string {
	return string(p) + "_" + id
}

func (p ResourcePrefix) ErrorCodePrefix(code string) string {
	return string(p) + "." + code
}

var defaultGenerator idgen.Generator = idgen.NewULID()

// newID generates a new domain ID with the given prefix.
func newID(prefix ResourcePrefix) (string, error) {
	id, err := defaultGenerator.New(string(prefix))
	if err != nil {
		return "", ErrInternal(err).WithMessage("failed to generate ID")
	}
	return id, nil
}
