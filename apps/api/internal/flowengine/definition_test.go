package flowengine_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/flowengine"
)

// definitionsByID serves definitions by id and records the ids asked for.
type definitionsByID struct {
	defs  map[string]*domain.FlowDefinition
	asked []string
}

func (d *definitionsByID) Definition(_ context.Context, id string) (*domain.FlowDefinition, error) {
	d.asked = append(d.asked, id)
	def, ok := d.defs[id]
	if !ok {
		return nil, domain.ErrFlowDefinitionNotFound()
	}
	return def, nil
}

// Routing and rendering act on the definition the state names, whichever
// others the request's definitions hold: step2's go completes the flow in
// one, and moves on to step3 in the other.
func TestActiveDefinition_RoutingAndRenderingFollowTheState(t *testing.T) {
	t.Parallel()
	active, other := navigateOnlyDefinition(), navigateThreeStepDefinition()
	onStep2 := func(definitionID string) *flowengine.State {
		return &flowengine.State{
			ID:            "flow-1",
			ProjectID:     testProjectID,
			UserSchemaURL: defaultSchemaURL,
			Progress: flowengine.Progress{
				DefinitionID:   definitionID,
				Purpose:        domain.FlowDefinitionPurposeLogin,
				CurrentPurpose: domain.FlowDefinitionPurposeLogin,
				CurrentStep:    "step2",
				History:        []string{"step1"},
				BackStack:      []flowengine.BackEntry{{StepName: "step1", Purpose: domain.FlowDefinitionPurposeLogin}},
			},
			AuthAttemptID: "att-1",
		}
	}

	t.Run("process", func(t *testing.T) {
		t.Parallel()
		w := newFlowTestWorld(t)
		w.authAttemptService.EXPECT().Handoff(gomock.Any(), gomock.Any()).Times(0)
		defs := &definitionsByID{defs: map[string]*domain.FlowDefinition{active.ID: active, other.ID: other}}

		completed, err := w.sm.Process(t.Context(), defs, onStep2(active.ID), flowengine.SubmitInput{Action: "go"})
		require.NoError(t, err)
		assert.Equal(t, "done", completed.Step.Name)
		assert.NotNil(t, completed.Step.Complete)

		moved, err := w.sm.Process(t.Context(), defs, onStep2(other.ID), flowengine.SubmitInput{Action: "go"})
		require.NoError(t, err)
		assert.Equal(t, "step3", moved.Step.Name)
		assert.Equal(t, []string{active.ID, other.ID}, defs.asked)
	})

	t.Run("render", func(t *testing.T) {
		t.Parallel()
		w := newFlowTestWorld(t)
		w.ssoIdentities.EXPECT().LoadParked(gomock.Any(), gomock.Any()).Return(nil, nil)
		defs := &definitionsByID{defs: map[string]*domain.FlowDefinition{active.ID: active, other.ID: other}}

		state := onStep2(other.ID)
		state.CurrentStep = "step3"
		rendered, err := w.sm.Render(t.Context(), defs, state)
		require.NoError(t, err)
		assert.Equal(t, "step3", rendered.Step.Name)

		state = onStep2(active.ID)
		state.CurrentStep = "step3"
		_, err = w.sm.Render(t.Context(), defs, state)
		require.ErrorIs(t, err, domain.ErrFlowIntegrity(), "the active definition has no step3")
	})
}
