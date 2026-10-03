package harness

import (
	"errors"
	"fmt"
	"strconv"
	"time"

	api "github.com/zitadel/nextgen/api/generated"
)

// RequestTimeout bounds every request the module performs. It is explicit
// here and recorded in the sweep metadata because a timeout that only lives
// in code is one a reader of the numbers cannot see.
const RequestTimeout = 60 * time.Second

// OpError is a failed operation, classified: the operation id, the HTTP
// status it answered with (0 when no response arrived) and a bounded error
// code — the `code` of an error-details body, a fixed code for the shapes
// that carry none. The module counts these on nextgen_errors, so a failing
// operation shows up in the summary as a classified error rather than as a
// missing sample or a log line.
type OpError struct {
	Op     string
	Status int
	Code   string
	Err    error
}

// Error codes for failures that carry no error-details body.
const (
	// CodeStepError is a flow step answered 200 with an error key: the
	// server rejected the input and re-served the step.
	CodeStepError = "flow.step_error"
	// CodeUnexpectedResponse is a typed response the journey does not
	// handle, such as a 2xx of an unexpected shape.
	CodeUnexpectedResponse = "unexpected_response"
	// CodeTransport is a request that produced no response: dial, timeout,
	// decode.
	CodeTransport = "transport"
)

func (e *OpError) Error() string {
	if e.Status == 0 {
		return fmt.Sprintf("%s: %s: %v", e.Op, e.Code, e.Err)
	}
	return fmt.Sprintf("%s: %d %s: %v", e.Op, e.Status, e.Code, e.Err)
}

func (e *OpError) Unwrap() error { return e.Err }

// StatusClass is the status tag value: "2xx", "4xx", "5xx", or "0" when no
// response arrived. Bounded by construction, unlike the exact status.
func (e *OpError) StatusClass() string {
	if e.Status == 0 {
		return "0"
	}
	return strconv.Itoa(e.Status/100) + "xx"
}

// Classify wraps err as an OpError for op unless it already is one.
func Classify(op string, err error) *OpError {
	if oe, ok := errors.AsType[*OpError](err); ok {
		return oe
	}
	return &OpError{Op: op, Status: 0, Code: CodeTransport, Err: err}
}

// errorDetails is what every generated error-details alias looks like.
type errorDetails interface {
	GetCode() api.ErrorCode
	GetMessage() string
}

// statusCoded is the generated wrapper for a documented non-2xx status.
type statusCoded interface {
	GetStatusCode() int
}

// classifyResponse turns a typed response that is not the success shape into
// an OpError. status is the status the generated union implies for res when
// res itself does not carry one.
func classifyResponse(op string, status int, res any) *OpError {
	switch r := res.(type) {
	case errorDetails:
		return &OpError{Op: op, Status: status, Code: string(r.GetCode()), Err: errors.New(r.GetMessage())}
	case statusCoded:
		return &OpError{Op: op, Status: r.GetStatusCode(), Code: CodeUnexpectedResponse, Err: fmt.Errorf("%T", res)}
	default:
		return &OpError{Op: op, Status: status, Code: CodeUnexpectedResponse, Err: fmt.Errorf("%T", res)}
	}
}
