package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

const (
	pgUserAgentsTable     = "zitadel_nextgen.user_agents"
	spannerUserAgentsTable = "user_agents"
)

type UserAgentRepository struct {
	table string
}

func NewUserAgentRepository(pool database.QueryExecutor) *UserAgentRepository {
	switch pool.(type) {
	case spanner.SpannerPooler:
		return &UserAgentRepository{table: spannerUserAgentsTable}
	case postgres.PostgresPooler:
		return &UserAgentRepository{table: pgUserAgentsTable}
	}
	panic("NewUserAgentRepository: unsupported pool type")
}

func (r *UserAgentRepository) Create(ctx context.Context, client database.QueryExecutor, agent *domain.UserAgent, projectID string) error {
	if agent == nil || agent.ID == "" {
		return fmt.Errorf("failed to create user agent: id is required")
	}
	info, err := json.Marshal(agent.Info)
	if err != nil {
		return fmt.Errorf("failed to create user agent: %w", err)
	}
	_, err = client.Exec(ctx,
		`INSERT INTO `+r.table+` (project_id, id, info) VALUES ($1, $2, $3)`,
		projectID, agent.ID, info)
	if err != nil {
		return fmt.Errorf("failed to create user agent: %w", err)
	}
	return nil
}

func (r *UserAgentRepository) GetByID(ctx context.Context, client database.QueryExecutor, projectID, id string) (*domain.UserAgent, error) {
	rows, err := client.Query(ctx,
		`SELECT id, info FROM `+r.table+` WHERE project_id = $1 AND id = $2`,
		projectID, id)
	if err != nil {
		return nil, fmt.Errorf("failed to get user agent: %w", err)
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, nil
	}
	var (
		agentID string
		infoRaw []byte
	)
	if err := rows.Scan(&agentID, &infoRaw); err != nil {
		return nil, fmt.Errorf("failed to scan user agent: %w", err)
	}
	agent := &domain.UserAgent{ID: agentID, Info: map[string]any{}}
	if len(infoRaw) > 0 && string(infoRaw) != "null" {
		if err := json.Unmarshal(infoRaw, &agent.Info); err != nil {
			return nil, fmt.Errorf("failed to decode user agent info: %w", err)
		}
	}
	return agent, rows.Err()
}
