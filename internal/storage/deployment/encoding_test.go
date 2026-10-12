package deployment

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestNextSeqs(t *testing.T) {
	read := []domain.TargetDeployment{{Origin: "https://app.acme.com", Seq: 7}}
	assert.Equal(t, []int64{8, 1}, NextSeqs([]string{"https://app.acme.com", "https://www.acme.com"}, read))
}
