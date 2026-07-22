package flowdefinition

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestExtractPurposeContains(t *testing.T) {
	t.Parallel()

	purpose, remaining := ExtractPurposeContains(database.And(
		database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), "proj"),
		database.Equal(database.Col(domain.FlowDefinitionFieldPurposes), domain.FlowDefinitionPurposeLogin.String()),
		database.Equal(database.Col(domain.FlowDefinitionFieldName), "login"),
	))
	assert.Equal(t, domain.FlowDefinitionPurposeLogin.String(), purpose)
	require.NotNil(t, remaining)
	assert.True(t, remaining.Restricts(database.Col(domain.FlowDefinitionFieldProjectID)))
	assert.True(t, remaining.Restricts(database.Col(domain.FlowDefinitionFieldName)))
	assert.False(t, remaining.Restricts(database.Col(domain.FlowDefinitionFieldPurposes)))
}

func TestExtractStatusEqual(t *testing.T) {
	t.Parallel()

	status, remaining := ExtractStatusEqual(database.And(
		database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), "proj"),
		database.Equal(database.Col(domain.FlowDefinitionFieldStatus), domain.FlowDefinitionStatusActive.String()),
	))
	assert.Equal(t, domain.FlowDefinitionStatusActive.String(), status)
	require.NotNil(t, remaining)
	assert.True(t, remaining.Restricts(database.Col(domain.FlowDefinitionFieldProjectID)))
	assert.False(t, remaining.Restricts(database.Col(domain.FlowDefinitionFieldStatus)))
}
