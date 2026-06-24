package database

type ListOptions struct {
	Filter     Filter
	Pagination Page
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

type OrderBy struct {
	Columns   []Column
	Direction OrderDirection
}

type Page struct {
	// Limit is the maximum number of items to return. If Limit is 0, no limit is applied.
	Limit uint32
	//OrderBy is the order in which to return the items.
	OrderBy
	// Cursor is the cursor to start the page from. If Cursor is nil, the page starts from the beginning.
	Cursor []byte
}
