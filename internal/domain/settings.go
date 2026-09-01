package domain

import (
	"cmp"
	"slices"
)

type SettingOwnerLevel int

const (
	SettingOwnerLevelRoot SettingOwnerLevel = iota
	SettingOwnerLevelProject
	SettingOwnerLevelTeam
	SettingOwnerLevelApplication
	SettingOwnerLevelUser
)

type SettingOwner struct {
	ProjectID     string
	TeamID        string
	ApplicationID string
	UserID        string
	level         *SettingOwnerLevel
}

func (owner *SettingOwner) Level() SettingOwnerLevel {
	if owner.level != nil {
		return *owner.level
	}

	if owner.UserID != "" {
		owner.level = new(SettingOwnerLevelUser)
	} else if owner.ApplicationID != "" {
		owner.level = new(SettingOwnerLevelApplication)
	} else if owner.TeamID != "" {
		owner.level = new(SettingOwnerLevelTeam)
	} else if owner.ProjectID != "" {
		owner.level = new(SettingOwnerLevelProject)
	} else {
		owner.level = new(SettingOwnerLevelRoot)
	}

	return *owner.level
}

func (owner *SettingOwner) HasAccessTo(leaf *SettingLeaf) bool {
	return (leaf.Owner.ProjectID == "" || leaf.Owner.ProjectID == owner.ProjectID) &&
		(leaf.Owner.TeamID == "" || leaf.Owner.TeamID == owner.TeamID) &&
		(leaf.Owner.ApplicationID == "" || leaf.Owner.ApplicationID == owner.ApplicationID) &&
		(leaf.Owner.UserID == "" || leaf.Owner.UserID == owner.UserID)
}

type SettingLeaf struct {
	Owner   SettingOwner
	Value   any
	IsFinal bool
}

type Setting struct {
	ID    string
	Leafs []*SettingLeaf
}

func (s *Setting) Resolve(targetOwner SettingOwner) *SettingLeaf {
	leafs := filter(s.Leafs, targetOwner.HasAccessTo)

	if len(leafs) == 0 {
		return nil
	}

	slices.SortFunc(leafs, func(a, b *SettingLeaf) int {
		return cmp.Compare(a.Owner.Level(), b.Owner.Level())
	})

	var leaf *SettingLeaf
	for _, v := range leafs {
		if v.Owner.Level() > targetOwner.Level() {
			return leaf
		}

		leaf = v
		if v.IsFinal {
			return v
		}
	}

	return leaf
}

func filter[T any](s []T, predicate func(T) bool) []T {
	var ret []T
	for _, item := range s {
		if predicate(item) {
			ret = append(ret, item)
		}
	}
	return ret
}
