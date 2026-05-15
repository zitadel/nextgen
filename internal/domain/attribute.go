package domain

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
)

type Attribute struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}

type Attributes []Attribute

type AttributeUniqueness int

const (
	AttributeUniquenessUnspecified AttributeUniqueness = iota
	AttributeUniquenessTeam
	AttributeUniquenessGlobal
)

type CreateAttribute struct {
	Key         string              `json:"key"`
	Value       any                 `json:"value"`
	UniqueScope AttributeUniqueness `json:"unique_scope"`
	ValueHash   [sha256.Size]byte   `json:"value_hash"`
}

func NewCreateAttribute(key string, value any, unique AttributeUniqueness) (*CreateAttribute, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal attribute value: %w", err)
	}
	attr := &CreateAttribute{
		Key:         key,
		Value:       value,
		UniqueScope: unique,
	}
	if unique != AttributeUniquenessUnspecified {
		attr.ValueHash = sha256.Sum256(raw)
	}
	return attr, nil
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
