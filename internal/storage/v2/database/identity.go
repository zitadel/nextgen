package database

import (
	"database/sql/driver"
	"fmt"
	"strconv"
)

// Identity is the canonical string form of a resource identifier in Go.
// All resource primary keys are dialect-minted prefixed opaque strings (ADR 047)
// persisted as TEXT / STRING(MAX).
type Identity string

// String implements fmt.Stringer.
func (id Identity) String() string {
	return string(id)
}

// IsNumeric reports whether id is a non-empty signed integer decimal.
// Retained for tests and legacy fixtures; resource PKs are no longer numeric.
func (id Identity) IsNumeric() bool {
	if id == "" {
		return false
	}
	_, err := strconv.ParseInt(string(id), 10, 64)
	return err == nil
}

// Scan implements sql.Scanner.
func (id *Identity) Scan(src any) error {
	if src == nil {
		*id = ""
		return nil
	}
	switch v := src.(type) {
	case int64:
		*id = Identity(strconv.FormatInt(v, 10))
	case int32:
		*id = Identity(strconv.FormatInt(int64(v), 10))
	case int:
		*id = Identity(strconv.FormatInt(int64(v), 10))
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
// interface (structurally, without importing the spanner package). The client
// delivers STRING and INT64 column values as decimal strings and NULL as a
// typed nil *string.
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

// Value implements driver.Valuer. Always binds as a string (TEXT / STRING).
func (id Identity) Value() (driver.Value, error) {
	if id == "" {
		return nil, nil
	}
	return string(id), nil
}
