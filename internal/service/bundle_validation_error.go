package service

import (
	"errors"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
)

// BundleResourceFailure is one bundle entry that failed its kind's create checks.
type BundleResourceFailure struct {
	Kind   domain.ReleasePointerKind
	Index  int
	Handle string
	Err    domain.Error
}

// BundleValidationError collects every resource that failed validation so the
// handler can answer once with details.resources. Code is always rel.invalid.
type BundleValidationError struct {
	Resources []BundleResourceFailure
}

func (e *BundleValidationError) Error() string {
	if e == nil || len(e.Resources) == 0 {
		return "release: invalid"
	}
	parts := make([]string, 0, len(e.Resources))
	for _, r := range e.Resources {
		parts = append(parts, fmt.Sprintf("%s[%d]: %s", r.Kind, r.Index, r.Err.Error()))
	}
	return "release: invalid: " + strings.Join(parts, "; ")
}

func (e *BundleValidationError) add(kind domain.ReleasePointerKind, index int, handle string, err error) {
	var de domain.Error
	if !errors.As(err, &de) {
		de = domain.ErrReleaseInvalid(err.Error(), err)
	}
	e.Resources = append(e.Resources, BundleResourceFailure{
		Kind:   kind,
		Index:  index,
		Handle: handle,
		Err:    de,
	})
}
