package domain

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/zitadel/nextgen/internal/maputil"
)

type AttributeKey string

func (k AttributeKey) Nodes() []string {
	return strings.Split(string(k), ".")
}

func (k AttributeKey) AppendNode(node string) AttributeKey {
	if len(k) == 0 {
		return AttributeKey(node)
	}
	return AttributeKey(string(k) + "." + node)
}

type Attribute struct {
	Key   AttributeKey `json:"key"`
	Value any          `json:"value"`
}

type AttributeUniqueness int

const (
	AttributeUniquenessUnspecified AttributeUniqueness = iota
	AttributeUniquenessTeam
	AttributeUniquenessProject
)

type Attributes []Attribute

func AttributesFromMap(m map[string]any) Attributes {
	attrs := make(Attributes, 0, len(m))
	attrs.fromMap(m, "")
	return attrs
}

// Get returns the value for the given key.
//
// TODO(go v27): make this method generic
func (attrs Attributes) Get(key AttributeKey) (value any, ok bool) {
	for _, attr := range attrs {
		if attr.Key == key {
			return attr.Value, true
		}
	}

	return nil, false
}

func (attrs *Attributes) fromMap(m map[string]any, keyPrefix AttributeKey) {
	for key, value := range m {
		fullKey := keyPrefix.AppendNode(key)

		switch tp := value.(type) {
		case map[string]any:
			attrs.fromMap(tp, fullKey)
		default:
			*attrs = append(*attrs, Attribute{Key: fullKey, Value: value})
		}
	}
}

func (attrs *Attributes) UnmarshalJSON(data []byte) error {
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return fmt.Errorf("attribute: %w", err)
	}

	*attrs = AttributesFromMap(m)
	return nil
}

func (attrs Attributes) ToMap() (map[string]any, error) {
	tree := make(map[string]any)
	for _, attr := range attrs {
		if err := maputil.SetNested(tree, string(attr.Key), attr.Value); err != nil {
			return nil, err
		}
	}
	return tree, nil
}

func (attrs Attributes) MarshalJSON() ([]byte, error) {
	m, err := attrs.ToMap()
	if err != nil {
		return nil, err
	}
	return json.Marshal(m)
}

type CreateAttribute struct {
	Key         AttributeKey        `json:"key"`
	Value       any                 `json:"value"`
	UniqueScope AttributeUniqueness `json:"unique_scope"`
	ValueHash   [sha256.Size]byte   `json:"value_hash"`
}

func NewCreateAttribute(key AttributeKey, value any, unique AttributeUniqueness) (*CreateAttribute, error) {
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

type CreateAttributes []CreateAttribute

func CreateAttributesFromMap(m map[string]any, schema map[string]any) (CreateAttributes, error) {
	attrs := make(CreateAttributes, 0, len(m))
	err := attrs.fromMap(m, schema, "")
	if err != nil {
		return nil, err
	}
	return attrs, nil
}

// Get returns the value for the given key.
//
// TODO(go v27): make this method generic
func (attrs CreateAttributes) Get(key AttributeKey) (value *CreateAttribute, ok bool) {
	for _, attr := range attrs {
		if attr.Key == key {
			return new(attr), true
		}
	}

	return nil, false
}

func (attrs *CreateAttributes) fromMap(m map[string]any, schema map[string]any, keyPrefix AttributeKey) error {
	for key, value := range m {
		fullKey := keyPrefix.AppendNode(key)

		switch tp := value.(type) {
		case map[string]any:
			props, _ := maputil.GetNested[map[string]any](schema, "properties."+key)
			err := attrs.fromMap(tp, props, fullKey)
			if err != nil {
				return err
			}
		default:
			var unique AttributeUniqueness
			strUnique, _ := maputil.GetNested[string](schema, "properties."+key+".x-unique")
			switch strUnique {
			case "project":
				unique = AttributeUniquenessProject
			case "team":
				unique = AttributeUniquenessTeam
			}
			attr, err := NewCreateAttribute(fullKey, value, unique)
			if err != nil {
				return err
			}
			*attrs = append(*attrs, *attr)
		}
	}
	return nil
}
