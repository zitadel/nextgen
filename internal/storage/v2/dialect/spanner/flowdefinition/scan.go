package flowdefinition

import (
	"github.com/zitadel/nextgen/internal/domain"
	pgflow "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres/flowdefinition"
)

type (
	Row     = pgflow.Row
	Content = pgflow.Content
	JSON[T any] = pgflow.JSON[T]
)

var (
	MarshalContent = pgflow.MarshalContent
	RowToDomain    = pgflow.RowToDomain
	NextCursor     = pgflow.NextCursor
)

func purposeStrings(def *domain.FlowDefinition) []string {
	purposeStrs := make([]string, 0, len(def.Purposes))
	for p := range def.Purposes {
		purposeStrs = append(purposeStrs, p.String())
	}
	return purposeStrs
}

func scanSQLRow(scanner interface{ Scan(dest ...any) error }) (Row, error) {
	var r Row
	err := scanner.Scan(
		&r.ProjectID,
		&r.ID,
		&r.Name,
		&r.SchemaVersion,
		&r.Status,
		&r.Definition,
		&r.CreatedAt,
		&r.UpdatedAt,
	)
	return r, err
}

func scanSQLRows(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}) ([]*domain.FlowDefinition, error) {
	var items []*domain.FlowDefinition
	for rows.Next() {
		r, err := scanSQLRow(rows)
		if err != nil {
			return nil, err
		}
		def, err := RowToDomain(r)
		if err != nil {
			return nil, err
		}
		items = append(items, def)
	}
	return items, rows.Err()
}
