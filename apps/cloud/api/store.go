package main

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// placement records where a project lives: its region, who created it and
// the team the claim handed it to in that region.
type placement struct {
	ProjectID string
	RegionID  string
	UserID    string
	TeamID    string
	Name      string
	CreatedAt time.Time
}

type store interface {
	insert(ctx context.Context, p placement) error
	listByUser(ctx context.Context, userID string) ([]placement, error)
	ping(ctx context.Context) error
}

// openPool connects to the home's database. The server's `schema` parameter
// is dropped: this service qualifies every table with its own schema.
func openPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	delete(cfg.ConnConfig.RuntimeParams, "schema")
	cfg.MaxConns = 4
	return pgxpool.NewWithConfig(ctx, cfg)
}

type pgStore struct {
	pool *pgxpool.Pool
}

func (s *pgStore) insert(ctx context.Context, p placement) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO cloud.placements (project_id, region_id, user_id, team_id, name, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		p.ProjectID, p.RegionID, p.UserID, p.TeamID, p.Name, p.CreatedAt)
	return err
}

func (s *pgStore) listByUser(ctx context.Context, userID string) ([]placement, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT project_id, region_id, user_id, team_id, name, created_at FROM cloud.placements WHERE user_id = $1 ORDER BY created_at DESC, project_id`,
		userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var placements []placement
	for rows.Next() {
		var p placement
		if err := rows.Scan(&p.ProjectID, &p.RegionID, &p.UserID, &p.TeamID, &p.Name, &p.CreatedAt); err != nil {
			return nil, err
		}
		placements = append(placements, p)
	}
	return placements, rows.Err()
}

func (s *pgStore) ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}
