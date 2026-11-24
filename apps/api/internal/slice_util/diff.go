package slice_util

import (
	"slices"

	"github.com/ahmetb/go-linq/v5"
)

func DiffFunc[E any](from []E, to []E, equal func(f E, t E) bool) (added []E, removed []E) {
	kept := make([]E, 0, len(to))

	for _, t := range to {
		isAdded := !slices.ContainsFunc(from, func(f E) bool {
			return equal(f, t)
		})
		if isAdded {
			added = append(added, t)
		} else {
			kept = append(kept, t)
		}
	}

	removed = linq.FromSlice(from).
		Where(func(f E) bool {
			return !slices.ContainsFunc(kept, func(t E) bool { return equal(f, t) })
		}).
		ToSlice()

	return added, removed
}
