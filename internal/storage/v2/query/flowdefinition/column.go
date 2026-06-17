package flowdefinition

// Column identifies a flow_definitions table column for filters and ordering.
type Column uint8

const (
	ColProjectID Column = iota
	ColID
	ColName
	ColSchemaVersion
	ColStatus
	ColPurposes
	ColDefinition
	ColCreatedAt
	ColUpdatedAt
)
