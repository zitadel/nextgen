package service

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestRollbackTargets(t *testing.T) {
	t.Parallel()

	const webOrigin = "https://app.acme.com"
	for _, tt := range []struct {
		name    string
		origins []string
		want    []string
	}{
		{"web origins fold into primary", []string{webOrigin, "https://www.acme.com"}, []string{domain.DeploymentTargetPrimary}},
		{"the default target alone", []string{domain.DeploymentTargetDefault}, []string{domain.DeploymentTargetDefault}},
		{"both", []string{domain.DeploymentTargetDefault, webOrigin}, []string{domain.DeploymentTargetPrimary, domain.DeploymentTargetDefault}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			previous := &domain.Deployment{}
			for _, origin := range tt.origins {
				previous.Targets = append(previous.Targets, domain.DeploymentTarget{Origin: origin})
			}
			assert.Equal(t, tt.want, rollbackTargets(previous))
		})
	}
}
