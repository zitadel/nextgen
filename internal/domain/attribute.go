package domain

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"

	"golang.org/x/text/cases"

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
		if err := maputil.SetNested(tree, attr.Key.Nodes(), attr.Value); err != nil {
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
	attr := &CreateAttribute{
		Key:         key,
		Value:       value,
		UniqueScope: unique,
	}
	if unique != AttributeUniquenessUnspecified {
		hash, err := UniqueValueHash(value)
		if err != nil {
			return nil, err
		}
		attr.ValueHash = hash
	} else if _, err := json.Marshal(value); err != nil {
		// UniqueValueHash marshals on the unique path; keep the same
		// marshalability guarantee for non-unique values.
		return nil, fmt.Errorf("failed to marshal attribute value: %w", err)
	}
	return attr, nil
}

// UniqueValueHash is the one comparison function behind attribute uniqueness:
// the unique-attributes registry stores it and identifier resolution looks it
// up, so both always agree on what counts as the same value (ADR 058 §4a).
// String values are Unicode case-folded before hashing — Alice@Example.com
// and alice@example.com are one unique value — while the attribute itself
// keeps its original casing. Non-string values hash as encoded.
func UniqueValueHash(value any) ([sha256.Size]byte, error) {
	if s, ok := value.(string); ok {
		value = cases.Fold().String(s)
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return [sha256.Size]byte{}, fmt.Errorf("failed to marshal attribute value: %w", err)
	}
	return sha256.Sum256(raw), nil
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
			props, _ := maputil.GetNested[map[string]any](schema, []string{"properties", key})
			err := attrs.fromMap(tp, props, fullKey)
			if err != nil {
				return err
			}
		default:
			var unique AttributeUniqueness
			strUnique, _ := maputil.GetNested[string](schema, []string{"properties", key, "x-unique"})
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
