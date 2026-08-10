package database

import "iter"

type ListOptions[F ~uint8] struct {
	Filter     Filter[F]
	Pagination Page[F]
}

type ListResult[T any] struct {
	Items      []T
	NextCursor []byte
}

// Iterate returns a sequence over all items across every page. It starts with
// the items already held by l and calls fetchNext with the previous page's
// NextCursor to load subsequent pages, stopping once a page reports an empty
// NextCursor.
//
// If fetchNext returns an error, the sequence yields the zero value together
// with that error once and then stops. Callers should therefore check the error
// on each iteration:
//
//	for key, err := range result.Iterate(fetchNext) {
//		if err != nil {
//			// handle and break
//		}
//		// use key
//	}
func (l *ListResult[T]) Iterate(fetchNext func(cursor []byte) (*ListResult[T], error)) iter.Seq2[T, error] {
	return func(yield func(T, error) bool) {
		page := l
		for {
			for _, item := range page.Items {
				if !yield(item, nil) {
					return
				}
			}
			if len(page.NextCursor) == 0 {
				return
			}
			next, err := fetchNext(page.NextCursor)
			if err != nil {
				var zero T
				yield(zero, err)
				return
			}
			if next == nil {
				return
			}
			page = next
		}
	}
}

type OrderDirection uint8

const (
	OrderAsc OrderDirection = iota
	OrderDesc
)

type OrderBy[F ~uint8] struct {
	Columns   []Column[F]
	Direction OrderDirection
}

type Page[F ~uint8] struct {
	// Limit is the maximum number of items to return. If Limit is 0, no limit is applied.
	Limit uint32
	// OrderBy is the order in which to return the items.
	OrderBy OrderBy[F]
	// Cursor is the cursor to start the page from. If Cursor is nil, the page starts from the beginning.
	Cursor []byte
}
