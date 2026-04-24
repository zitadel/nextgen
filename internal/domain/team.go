package domain

// Team represents a the object defined [here](https://github.com/zitadel/nextgen/blob/15bd7f438d709fcd5205a163e24374f6f667b68f/docs/design/api/resource-map.md#teams)
type Team struct {
	// ProjectID links to [Project]
	ProjectID string
	// ID is the unique identifier for the team within the project.
	ID string
}
