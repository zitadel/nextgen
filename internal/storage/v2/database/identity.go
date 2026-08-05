package database

import (
	"database/sql/driver"
	"fmt"
)

// Identity is a string resource identifier for SQL bind/scan helpers.
// Resource primary keys are dialect-minted prefixed opaque strings (ADR 047)
// stored as TEXT / STRING(MAX).
type Identity string

// String implements fmt.Stringer.
func (id Identity) String() string {
	return string(id)
}

// Scan implements sql.Scanner.
func (id *Identity) Scan(src any) error {
	if src == nil {
		*id = ""
		return nil
	}
	switch v := src.(type) {
	case string:
		*id = Identity(v)
	case []byte:
		*id = Identity(string(v))
	default:
		return fmt.Errorf("database.Identity: unsupported Scan type %T", src)
	}
	return nil
}

// DecodeSpanner implements the Cloud Spanner client's spanner.Decoder
// interface (structurally, without importing the spanner package).
func (id *Identity) DecodeSpanner(input any) error {
	switch v := input.(type) {
	case nil:
		*id = ""
	case string:
		*id = Identity(v)
	case *string:
		if v == nil {
			*id = ""
		} else {
			*id = Identity(*v)
		}
	default:
		return fmt.Errorf("database.Identity: unsupported DecodeSpanner type %T", input)
	}
	return nil
}

// Value implements driver.Valuer.
func (id Identity) Value() (driver.Value, error) {
	if id == "" {
		return nil, nil
	}
	return string(id), nil
}
