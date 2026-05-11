// Package flow holds the use-case interfaces and orchestration contracts
// for the flow engine. Per ADR 010, the service layer owns workflows and
// transaction boundaries; the api layer consumes these interfaces, the
// domain layer defines the entities and errors they exchange.
package flow
