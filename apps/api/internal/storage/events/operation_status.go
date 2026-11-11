package events

import (
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
)

// OperationStatus is the key a request event is indexed under for a read by
// operation: its operation and its status class as one value,
// "createUser 4xx". With the two in columns of their own, a read by both
// would name the status class column too, and the status class's index would
// serve it as well, matching the operation row by row over every request of
// that class: Postgres takes that smaller index whenever it expects at most a
// row from either. One column leaves the read one index to range over.
func OperationStatus(operationID string, class domain.HTTPStatusClass) string {
	return operationID + " " + string(class)
}

// OperationStatusOf is e's operation_status column: its key, or nil for an
// event without an operation or a status class.
func OperationStatusOf(e *domain.Event) *string {
	if e.OperationID == nil || e.StatusClass == nil {
		return nil
	}
	key := OperationStatus(*e.OperationID, *e.StatusClass)
	return &key
}

// OperationOf is the operation an operation_status key names: what precedes
// its status class.
func OperationOf(key string) string {
	if i := strings.LastIndexByte(key, ' '); i >= 0 {
		return key[:i]
	}
	return key
}
