package main

import (
	"context"
	"crypto/md5"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	//go:embed get_by_id.sql
	getUserByIdStmt string
	//go:embed create.sql
	insertUserStmt string
	//go:embed put.sql
	putUserStmt string
	//go:embed patch.sql
	patchUserStmt string
)

type Attribute struct {
	Key   string
	Value any
}

type User struct {
	SchemaURL      string
	ID             string
	OrganizationID string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	Attributes     []Attribute
}

func (u *User) MarshalJSON() ([]byte, error) {
	tree, err := buildAttributeTree(u.Attributes)
	if err != nil {
		return nil, err
	}
	tree["metaSchema"] = u.SchemaURL
	tree["$id"] = u.ID
	tree["organization_id"] = u.OrganizationID
	tree["created_at"] = u.CreatedAt
	tree["updated_at"] = u.UpdatedAt
	return json.Marshal(tree)

}

type UpdateUserResult struct {
	User
	DeletedAttributes  int64
	UpsertedAttributes int64
}

func (u *UpdateUserResult) MarshalJSON() ([]byte, error) {
	userJSON, err := u.User.MarshalJSON()
	if err != nil {
		return nil, err
	}
	output := map[string]any{
		"user":                json.RawMessage(userJSON),
		"deleted_attributes":  u.DeletedAttributes,
		"upserted_attributes": u.UpsertedAttributes,
	}
	return json.Marshal(output)
}

func GetUserByID(ctx context.Context, instanceID, id string) (*User, error) {
	rows, _ := conn.Query(ctx, getUserByIdStmt, instanceID, id)
	user, err := pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByPos[User])
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	return user, nil

}

//go:generate go tool enumer -type=UserUniqueness -trimprefix=UserUniqueness -transform=lower -sql
type UserUniqueness int

const (
	UserUniquenessUnspecified UserUniqueness = iota
	UserUniquenessOrganization
	UserUniquenessGlobal
)

type IncomingUserAttribute interface {
	isAttribute()
}

type incomingUserAttribute struct {
	Key         string         `json:"key"`
	Value       any            `json:"value"`
	ValueHash   []byte         `json:"value_hash"`
	UniqueScope UserUniqueness `json:"unique_scope"`
}

func (*incomingUserAttribute) isAttribute() {}

func NewIncomingUserAttribute(key string, value any, unique UserUniqueness) (IncomingUserAttribute, error) {
	// Marshal the 'any' value into a JSON byte slice immediately
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal attribute value: %w", err)
	}

	// TODO(muhlemmer): use SHA-256 in prod code.
	md5Hash := md5.Sum(raw)

	return &incomingUserAttribute{
		Key:         key,
		Value:       raw,
		ValueHash:   md5Hash[:],
		UniqueScope: unique,
	}, nil
}

type IncomingUser struct {
	SchemaURL      string
	ID             string
	OrganizationID string
	Attributes     []IncomingUserAttribute
}

func (u *IncomingUser) insertArgs(instanceID string) []any {
	return []any{
		instanceID,
		u.SchemaURL,
		u.ID,
		u.OrganizationID,
		u.Attributes,
	}
}

func CreateUser(ctx context.Context, instanceID string, u *IncomingUser) (*User, error) {
	rows, _ := conn.Query(ctx, insertUserStmt, u.insertArgs(instanceID)...)
	user, err := pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByPos[User])
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}
	return user, nil
}

func PutUser(ctx context.Context, instanceID, userID string, attributes []IncomingUserAttribute) (*UpdateUserResult, error) {
	rows, _ := conn.Query(ctx, putUserStmt, instanceID, userID, attributes)
	user, err := pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByPos[UpdateUserResult])
	if err != nil {
		return nil, fmt.Errorf("failed to put user: %w", err)
	}
	return user, nil
}

func PatchUser(ctx context.Context, instanceID, userID string, attributes []IncomingUserAttribute, deleteKeys []string) (*UpdateUserResult, error) {
	rows, _ := conn.Query(ctx, patchUserStmt, instanceID, userID, attributes, deleteKeys)
	user, err := pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByPos[UpdateUserResult])
	if err != nil {
		return nil, fmt.Errorf("failed to patch user: %w", err)
	}
	return user, nil
}

func buildAttributeTree(attributes []Attribute) (map[string]any, error) {
	tree := make(map[string]any)
	for i, a := range attributes {
		keyNodes := strings.Split(a.Key, ".")

		// empty keys are prevented in the DB schema,
		// this is just a safety check to prevent panics in case of invalid data
		if keyNodes[0] == "" {
			return nil, fmt.Errorf("illegal empty key for attribute at index %d", i)
		}

		setAttribute(keyNodes, a.Value, tree)
	}
	return tree, nil
}

func setAttribute(keyNodes []string, value any, tree map[string]any) {
	// leaf node, set the value
	if len(keyNodes) == 1 {
		tree[keyNodes[0]] = value
		return
	}

	// not a leaf node, traverse down the tree
	subTree, ok := tree[keyNodes[0]].(map[string]any)
	if !ok {
		subTree = make(map[string]any)
		tree[keyNodes[0]] = subTree
	}
	setAttribute(keyNodes[1:], value, subTree)
}
