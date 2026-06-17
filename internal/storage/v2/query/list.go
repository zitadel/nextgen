package query

import "time"

type OrderDirection uint8

const (
	OrderAsc OrderDirection = iota
	OrderDesc
)

type OrderBy[C Column] struct {
	Column    C
	Direction OrderDirection
}

type Page interface {
	isPage()
}

type PageLimit struct {
	Limit  uint32
	Offset uint32
}

func (PageLimit) isPage() {}

type PageCursor[C Column] struct {
	After      *CursorToken
	Limit      uint32
	KeyColumns []OrderBy[C]
}

func (PageCursor[C]) isPage() {}

// CursorToken holds keyset pagination values matching the list ORDER BY columns.
type CursorToken struct {
	Values []any
}

// FlowDefinitionCursor is a typed cursor for flow definition lists (created_at, id).
type FlowDefinitionCursor struct {
	CreatedAt time.Time
	ID        string
}

func NewFlowDefinitionCursor(createdAt time.Time, id string) *CursorToken {
	return &CursorToken{Values: []any{createdAt, id}}
}

func ParseFlowDefinitionCursor(token *CursorToken) (FlowDefinitionCursor, error) {
	if token == nil || len(token.Values) != 2 {
		return FlowDefinitionCursor{}, ErrInvalidCursor
	}
	createdAt, ok := token.Values[0].(time.Time)
	if !ok {
		return FlowDefinitionCursor{}, ErrInvalidCursor
	}
	id, ok := token.Values[1].(string)
	if !ok {
		return FlowDefinitionCursor{}, ErrInvalidCursor
	}
	return FlowDefinitionCursor{CreatedAt: createdAt, ID: id}, nil
}

var ErrInvalidCursor = fmtError("invalid cursor token")

type fmtError string

func (e fmtError) Error() string { return string(e) }

type ListOptions[C Column] struct {
	Filter  Filter
	OrderBy []OrderBy[C]
	Page    Page
}

type ListResult[T any] struct {
	Items      []T
	NextCursor *CursorToken
}
