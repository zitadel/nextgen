package flowengine

import (
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
)

// EntryCriteria is what the definition a new flow starts on must serve.
type EntryCriteria struct {
	Purpose domain.FlowDefinitionPurpose
	// SchemaVersion admits only definitions of that version; nil admits any.
	SchemaVersion *string
	// Hint ranks definitions by audience; [EntryByName] ignores it.
	Hint EntryHint
}

// EntryHint names the audience a flow starts for. Each field is optional.
type EntryHint struct {
	AppID        *string
	TeamID       *string
	UserSchemaID *string
}

// EntryByName returns def, the revision pinned under the name a flow was asked
// for, when it can start a flow for criteria.
func EntryByName(def *domain.FlowDefinition, criteria EntryCriteria) (*domain.FlowDefinition, error) {
	if criteria.SchemaVersion != nil && def.SchemaVersion != *criteria.SchemaVersion {
		return nil, domain.ErrFlowDefinitionNotFound()
	}
	if _, ok := def.InitialStepFor(criteria.Purpose); !ok {
		return nil, domain.ErrFlowDefinitionPurposeMismatch()
	}
	return def, nil
}

// EntryByAudience picks the candidate a flow starts on when none was named:
// among those serving the purpose, version and user schema asked for, the best
// audience match (see [audienceScore]), then the newest.
func EntryByAudience(candidates []*domain.FlowDefinition, criteria EntryCriteria) (*domain.FlowDefinition, error) {
	var best *domain.FlowDefinition
	bestScore := -1
	for _, def := range candidates {
		if criteria.SchemaVersion != nil && def.SchemaVersion != *criteria.SchemaVersion {
			continue
		}
		if _, ok := def.InitialStepFor(criteria.Purpose); !ok {
			continue
		}
		if criteria.Hint.UserSchemaID != nil && def.UserSchema != *criteria.Hint.UserSchemaID {
			continue
		}
		score := audienceScore(def, criteria.Hint)
		if score > bestScore || (score == bestScore && createdAfter(def, best)) {
			best, bestScore = def, score
		}
	}
	if best == nil {
		return nil, domain.ErrFlowDefinitionNotFound()
	}
	return best, nil
}

// audienceScore ranks def for the hint: 3 for a hinted-app match, 2 for a
// hinted-team match, 1 for an unscoped (project-wide) definition, 0 for a
// definition scoped to apps/teams the hint does not identify.
func audienceScore(def *domain.FlowDefinition, hint EntryHint) int {
	switch {
	case hint.AppID != nil && slices.Contains(def.Audience.AppIDs, *hint.AppID):
		return 3
	case hint.TeamID != nil && slices.Contains(def.Audience.TeamIDs, *hint.TeamID):
		return 2
	case len(def.Audience.AppIDs) == 0 && len(def.Audience.TeamIDs) == 0:
		return 1
	default:
		return 0
	}
}

// createdAfter reports whether candidate was created after current, with the
// id as the tie-break.
func createdAfter(candidate, current *domain.FlowDefinition) bool {
	if !candidate.CreatedAt.Equal(current.CreatedAt) {
		return candidate.CreatedAt.After(current.CreatedAt)
	}
	return candidate.ID > current.ID
}
