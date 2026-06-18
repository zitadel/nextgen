package database

type ListOptions struct {
	Filter     Filter
	Pagination Page
}

type ListResult[T any] struct {
	Items      []T
	NextCursor *CursorToken
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
	After *CursorToken
	Limit uint32
	OrderBy
}

// CursorToken holds keyset pagination values matching the list ORDER BY columns.
type CursorToken struct {
	Limit   uint32
	OrderBy OrderBy
	Values  []any
}
