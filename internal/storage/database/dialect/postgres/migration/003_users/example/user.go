package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	//go:embed get.sql
	getUserStmt string
)

func GetUser(ctx context.Context, instanceID, id string) (*User, error) {
	rows, _ := conn.Query(ctx, getUserStmt, instanceID, id)
	user, err := pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByPos[User])
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	return user, nil

}

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
	tree["$schema"] = u.SchemaURL
	tree["$id"] = u.ID
	tree["organization_id"] = u.OrganizationID
	tree["created_at"] = u.CreatedAt
	tree["updated_at"] = u.UpdatedAt
	return json.Marshal(tree)

}

func buildAttributeTree(attributes []Attribute) (map[string]any, error) {
	tree := make(map[string]any)
	for i, a := range attributes {
		keyNodes := strings.Split(a.Key, ".")

		// empty keys are prevented in the DB schema,
		// this is just a safety check to prevent panics in case of invalid data
		if len(keyNodes) == 0 {
			return nil, fmt.Errorf("illigal empty key for attribute at index %d", i)
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
