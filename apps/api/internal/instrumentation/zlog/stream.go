package zlog

type Stream int

//go:generate go tool enumer -type=Stream -trimprefix=Stream -transform=snake -text
const (
	StreamUnspecified Stream = iota
	// StreamRuntime is for top-level commands, such as starting the application or running migrations.
	StreamRuntime
	// StreamReady is for readiness and liveness checks.
	StreamReady
	// StreamRequest is for API request handling.
	StreamRequest
	// StreamService is for internal services.
	StreamService
	// StreamStorage is for storage
	StreamStorage
)
