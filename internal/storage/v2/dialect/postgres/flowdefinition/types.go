package flowdefinition

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	googspanner "cloud.google.com/go/spanner"
	"github.com/jackc/pgx/v5/pgtype"
	storagedb "github.com/zitadel/nextgen/internal/storage/database"
)

// JSON wraps a JSON column value for scanning.
type JSON[T any] struct {
	Value T
}

var errScanSource = errors.New("unsupported scan source")

func (j *JSON[T]) Scan(src any) (err error) {
	var rawJSON []byte
	switch s := src.(type) {
	case string:
		rawJSON = []byte(s)
	case []byte:
		rawJSON = s
	case nil:
		return nil
	default:
		if m, ok := src.(json.Marshaler); ok {
			rawJSON, err = m.MarshalJSON()
			if err != nil {
				return storagedb.NewScanError(err)
			}
		} else {
			return errScanSource
		}
	}
	return json.Unmarshal(rawJSON, &j.Value)
}

// StringArray scans Postgres text[] purpose columns.
type StringArray []string

func (sa *StringArray) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*sa = nil
		return nil
	case []googspanner.NullString:
		out := make(StringArray, 0, len(v))
		for _, ns := range v {
			if ns.Valid {
				out = append(out, ns.StringVal)
			}
		}
		*sa = out
		return nil
	case []string:
		*sa = StringArray(v)
		return nil
	case pgtype.Array[string]:
		if !v.Valid {
			*sa = StringArray{}
			return nil
		}
		*sa = StringArray(v.Elements)
		return nil
	case pgtype.FlatArray[string]:
		*sa = StringArray(v)
		return nil
	case []byte:
		var elems []string
		if err := pgtype.NewMap().Scan(pgtype.TextArrayOID, pgtype.BinaryFormatCode, v, &elems); err != nil {
			return storagedb.NewScanError(err)
		}
		*sa = StringArray(elems)
		return nil
	case string:
		return sa.scanString(v)
	default:
		return fmt.Errorf("%w: %T", errScanSource, src)
	}
}

func (sa *StringArray) scanString(v string) error {
	if v == "" || v == "{}" {
		*sa = StringArray{}
		return nil
	}
	inner := strings.Trim(v, "{}")
	if inner == "" {
		*sa = StringArray{}
		return nil
	}
	*sa = StringArray(strings.Split(inner, ","))
	return nil
}

func (sa StringArray) String() string {
	if len(sa) == 0 {
		return "{}"
	}
	return fmt.Sprintf(`{%s}`, strings.Join(sa, ","))
}
