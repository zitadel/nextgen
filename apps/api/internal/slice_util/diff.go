package slice_util

import (
	"slices"

	"github.com/ahmetb/go-linq/v5"
)

func DiffFunc[E any](a []E, b []E, equalsFunc func(a E, b E) bool) (addedInA []E, removedFromA []E) {
	notAdded := make([]E, 0, len(b))

	for _, eb := range b {
		isAdded := !slices.ContainsFunc(a, func(ea E) bool {
			return equalsFunc(eb, ea)
		})
		if isAdded {
			addedInA = append(addedInA, eb)
		} else {
			notAdded = append(notAdded, eb)
		}
	}

	removedFromA = linq.FromSlice(a).
		Where(func(ea E) bool {
			return !slices.ContainsFunc(notAdded, func(e E) bool { return equalsFunc(ea, e) })
		}).
		ToSlice()

	return addedInA, removedFromA
}
