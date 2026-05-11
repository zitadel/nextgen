// Package flow defines the consumer-side interfaces for the flow engine
// runtime: selector, state machine, cookie codec, field resolver,
// auth-attempt adapter, gate registry, and policy seam.
//
// Interfaces are declared here; concrete implementations live under the
// service layer. The handler owns cookie I/O and translates between these
// domain types and the generated OpenAPI wire types.
package flow
