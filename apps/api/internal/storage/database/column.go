package database

import "encoding/json"

// Column identifies an entity field in portable filter, order-by, and cursor
// operations. F is the domain field enum for a single entity type.
type Column[F ~uint8] struct {
	field F
}

// Col wraps a domain field enum as a typed column reference.
func Col[F ~uint8](f F) Column[F] {
	return Column[F]{field: f}
}

// Field returns the underlying domain field enum value.
func (c Column[F]) Field() F {
	return c.field
}

// MarshalJSON encodes the column as its underlying uint8 field value.
func (c Column[F]) MarshalJSON() ([]byte, error) {
	return json.Marshal(uint8(c.field))
}

// UnmarshalJSON decodes a uint8 field value into the typed column.
func (c *Column[F]) UnmarshalJSON(data []byte) error {
	var v uint8
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	c.field = F(v)
	return nil
}
