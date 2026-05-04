package domain

/*
// User represents the object defined [here](https://github.com/zitadel/nextgen/blob/main/docs/design/api/resource-map.md#users)
// The user might contain PII data and should be stored in a specific region.
type User struct {
	// ProjectID links to [Project].
	ProjectID string
	// TeamID links to [Team]. A user may belong to a team, but it's not required.
	// If TeamID is nil, the user belongs to the project but not to any team.
	TeamID *string
	// ID is the unique identifier for the user within the project and team.
	ID string
}
*/

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type User struct {
	SchemaURL      string
	ID             string
	OrganizationID string
	CreatedAt      time.Time
	UpdatedAt      time.Time

	// Following fields are only populated if relevant
	// [userJoins] are set in the query.
	Attributes    []Attribute
	Passkeys      []*UserPasskey
	PATs          []*UserPAT
	RecoveryCodes []*UserRecoveryCodes
	UserPassword
	UserTOTP
}

/*
func (u *User) MarshalJSON() ([]byte, error) {
	tree, err := buildAttributeTree(u.Attributes)
	if err != nil {
		return nil, err
	}
	tree["$schema"] = u.SchemaURL
	tree["$id"] = u.ID
	tree["organization_id"] = u.OrganizationID
	tree["created_at"] = u.CreatedAt
	tree["updated_at"] = u.UpdatedAt
	return json.Marshal(tree)
}
*/

type CreateUser struct {
	SchemaURL      string
	ID             string
	OrganizationID string
	Attributes     []CreateAttribute
}

type UserRepository interface {
	Repository

	userColumns
	userConditions
	userChanges
	userJoins

	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*User, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*User, error)
	Create(ctx context.Context, client database.QueryExecutor, user *CreateUser) error
	Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error
}

type userColumns interface {
	InstanceID() database.Column
	ID() database.Column
	OrganizationID() database.Column
	CreatedAt() database.Column
	UpdatedAt() database.Column
	Attributes() database.Column
}

type userConditions interface {
	InstanceIDCondition(instanceID string) database.Condition
	IDCondition(id string) database.Condition
	PrimaryKeyCondition(instanceID, id string) database.Condition
	OrganizationIDCondition(organizationID string) database.Condition
	AttributesCondition(attributes []Attribute) database.Condition
}

type userChanges interface {
	SetOrganization(orgID string) database.Change
	SetAttribute(a CreateAttribute) database.Change
	DeleteAttribute(key string) database.Condition
}

type userJoins interface {
	WithAttributes(filterKeys ...string) database.QueryOption
	WithPassword() database.QueryOption
	WithTOTP() database.QueryOption
	WithRecoveryCodes() database.QueryOption
	WithPATs() database.QueryOption
	WithPasskeys() database.QueryOption
}
