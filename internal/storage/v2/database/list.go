package database

type ListOptions[F ~uint8] struct {
	Filter     Filter[F]
	Pagination Page[F]
}

type ListResult[T any] struct {
	Items      []T
	NextCursor []byte
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
