package domain

import (
	"math/rand/v2"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSettingOwner_Level(t *testing.T) {
	t.Parallel()

	t.Run("resolvment works", func(t *testing.T) {
		t.Parallel()

		type testCase struct {
			name     string
			owner    SettingOwner
			expected SettingOwnerLevel
		}

		testCases := []testCase{
			{
				name:     "no ids - root level",
				owner:    SettingOwner{},
				expected: SettingOwnerLevelRoot,
			},
			{
				name:     "project id - project level",
				owner:    SettingOwner{ProjectID: "project-1"},
				expected: SettingOwnerLevelProject,
			},
			{
				name:     "project and team id - team level",
				owner:    SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
				expected: SettingOwnerLevelTeam,
			},
			{
				name:     "project, team and user id - user level",
				owner:    SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
				expected: SettingOwnerLevelUser,
			},
			{
				name:     "team id without project - team level",
				owner:    SettingOwner{TeamID: "team-1"},
				expected: SettingOwnerLevelTeam,
			},
			{
				name:     "user id without parents - user level",
				owner:    SettingOwner{UserID: "user-1"},
				expected: SettingOwnerLevelUser,
			},
		}

		for _, testCase := range testCases {
			t.Run(testCase.name, func(t *testing.T) {
				t.Parallel()

				assert.Equal(t, testCase.expected, testCase.owner.Level())
			})
		}
	})

	t.Run("level is memoized after the first call", func(t *testing.T) {
		t.Parallel()

		owner := SettingOwner{ProjectID: "project-1"}
		require.Equal(t, SettingOwnerLevelProject, owner.Level())

		owner.UserID = "user-1"
		assert.Equal(t, SettingOwnerLevelProject, owner.Level())
	})
}

func TestSettingOwner_HasAccessTo(t *testing.T) {
	t.Parallel()

	t.Run("inherits every level above its own", func(t *testing.T) {
		t.Parallel()

		// Ordered from the widest to the narrowest scope. An owner has access to
		// a leaf owned at its own level or at any level above it, and never to a
		// leaf owned further down the hierarchy.
		levels := []struct {
			name  string
			owner SettingOwner
		}{
			{name: "root", owner: SettingOwner{}},
			{name: "project", owner: SettingOwner{ProjectID: "project-1"}},
			{name: "team", owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1"}},
			{name: "user", owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"}},
		}

		for ownerIdx, ownerCase := range levels {
			for leafIdx, leafCase := range levels {
				expected := leafIdx <= ownerIdx

				t.Run(ownerCase.name+" owner - "+leafCase.name+" leaf", func(t *testing.T) {
					t.Parallel()

					leaf := &SettingLeaf{Owner: leafCase.owner, Value: leafCase.name + "-level-setting"}

					assert.Equal(t, expected, ownerCase.owner.HasAccessTo(leaf))
				})
			}
		}
	})

	t.Run("only within its own branch", func(t *testing.T) {
		t.Parallel()

		type testCase struct {
			name      string
			owner     SettingOwner
			leafOwner SettingOwner
			expected  bool
		}

		testCases := []testCase{
			{
				name:      "leaf owned by a sibling project",
				owner:     SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
				leafOwner: SettingOwner{ProjectID: "project-2"},
				expected:  false,
			},
			{
				name:      "leaf owned by a sibling team in the same project",
				owner:     SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
				leafOwner: SettingOwner{ProjectID: "project-1", TeamID: "team-2"},
				expected:  false,
			},
			{
				name:      "leaf owned by a sibling user in the same team",
				owner:     SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
				leafOwner: SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-2"},
				expected:  false,
			},
			{
				name:      "team owner and a leaf owned by a sibling team",
				owner:     SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
				leafOwner: SettingOwner{ProjectID: "project-1", TeamID: "team-2"},
				expected:  false,
			},
			{
				name:      "team owner and a leaf owned by a sibling project",
				owner:     SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
				leafOwner: SettingOwner{ProjectID: "project-2", TeamID: "team-1"},
				expected:  false,
			},
			{
				name:      "leaf owned by the exact same owner",
				owner:     SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
				leafOwner: SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
				expected:  true,
			},
			// An unset id on the leaf matches any value, so a sparsely owned leaf
			// reaches every branch that agrees on the ids it does set.
			{
				name:      "leaf scoped to the user id alone",
				owner:     SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
				leafOwner: SettingOwner{UserID: "user-1"},
				expected:  true,
			},
			{
				name:      "leaf scoped to the team id alone",
				owner:     SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
				leafOwner: SettingOwner{TeamID: "team-1"},
				expected:  true,
			},
			{
				name:      "leaf scoped to a foreign user id alone",
				owner:     SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
				leafOwner: SettingOwner{UserID: "user-2"},
				expected:  false,
			},
			{
				name:      "leaf with a matching project but a foreign user",
				owner:     SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
				leafOwner: SettingOwner{ProjectID: "project-1", UserID: "user-2"},
				expected:  false,
			},
		}

		for _, testCase := range testCases {
			t.Run(testCase.name, func(t *testing.T) {
				t.Parallel()

				leaf := &SettingLeaf{Owner: testCase.leafOwner, Value: "some-setting"}

				assert.Equal(t, testCase.expected, testCase.owner.HasAccessTo(leaf))
			})
		}
	})
}

func TestSetting_Resolve(t *testing.T) {
	t.Parallel()

	type testCase struct {
		name          string
		setting       Setting
		targetOwner   SettingOwner
		expectedValue any
	}

	testCases := []testCase{
		{
			name: "all level configured - project level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1"},
						Value: "project-level-setting",
					},
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
						Value: "team-level-setting",
					},
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
						Value: "user-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1"},
			expectedValue: "project-level-setting",
		},
		{
			name: "all level configured - team level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1"},
						Value: "project-level-setting",
					},
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
						Value: "team-level-setting",
					},
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
						Value: "user-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
			expectedValue: "team-level-setting",
		},
		{
			name: "all level configured - user level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1"},
						Value: "project-level-setting",
					},
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
						Value: "team-level-setting",
					},
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
						Value: "user-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
			expectedValue: "user-level-setting",
		},
		{
			name: "only project level - project level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1"},
						Value: "project-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1"},
			expectedValue: "project-level-setting",
		},
		{
			name: "only project level - team level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1"},
						Value: "project-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
			expectedValue: "project-level-setting",
		},
		{
			name: "only project level - user level get",
			setting: Setting{
				Leafs: []*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1"},
						Value: "project-level-setting",
					},
				},
			},
			targetOwner:   SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
			expectedValue: "project-level-setting",
		},
		{
			name: "only team level configured - project level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
						Value: "team-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1"},
			expectedValue: nil,
		},
		{
			name: "only team level configured - team level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
						Value: "team-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
			expectedValue: "team-level-setting",
		},
		{
			name: "only team level configured - user level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
						Value: "team-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
			expectedValue: "team-level-setting",
		},
		{
			name: "only user level configured - project level get",
			setting: Setting{
				Leafs: []*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
						Value: "user-level-setting",
					},
				},
			},
			targetOwner:   SettingOwner{ProjectID: "project-1"},
			expectedValue: nil,
		},
		{
			name: "only user level configured - team level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
						Value: "user-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
			expectedValue: nil,
		},
		{
			name: "only user level configured - user level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
						Value: "user-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
			expectedValue: "user-level-setting",
		},
		{
			name: "all level configured - project level final - project level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner:   SettingOwner{ProjectID: "project-1"},
						Value:   "project-level-setting",
						IsFinal: true,
					},
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
						Value: "team-level-setting",
					},
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
						Value: "user-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1"},
			expectedValue: "project-level-setting",
		},
		{
			name: "all level configured - project level final- team level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner:   SettingOwner{ProjectID: "project-1"},
						Value:   "project-level-setting",
						IsFinal: true,
					},
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
						Value: "team-level-setting",
					},
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
						Value: "user-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
			expectedValue: "project-level-setting",
		},
		{
			name: "all level configured - team level final - team level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1"},
						Value: "project-level-setting",
					},
					{
						Owner:   SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
						Value:   "team-level-setting",
						IsFinal: true,
					},
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
						Value: "user-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
			expectedValue: "team-level-setting",
		},
		{
			name: "all level configured - team level final - user level get",
			setting: Setting{
				Leafs: shuffle([]*SettingLeaf{
					{
						Owner: SettingOwner{ProjectID: "project-1"},
						Value: "project-level-setting",
					},
					{
						Owner:   SettingOwner{ProjectID: "project-1", TeamID: "team-1"},
						Value:   "team-level-setting",
						IsFinal: true,
					},
					{
						Owner: SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
						Value: "user-level-setting",
					},
				}),
			},
			targetOwner:   SettingOwner{ProjectID: "project-1", TeamID: "team-1", UserID: "user-1"},
			expectedValue: "team-level-setting",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			got := testCase.setting.Resolve(testCase.targetOwner)
			if testCase.expectedValue == nil {
				assert.Nil(t, got)
			} else {
				require.NotNil(t, got)
				assert.Equal(t, testCase.expectedValue, got.Value)
			}
		})
	}
}

func shuffle[T any](src []T) []T {
	dest := make([]T, len(src))
	perm := rand.Perm(len(src))
	for i, v := range perm {
		dest[v] = src[i]
	}
	return dest
}
