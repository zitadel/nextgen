package service

import (
	"context"
	"strings"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// AddOrigin validates and stores one origin pattern on the project.
// Adding the same {pattern, kind} again is idempotent. The same pattern with a
// different kind is rejected with origin.kind_conflict.
func (s *projectService) AddOrigin(ctx context.Context, projectID string, origin domain.Origin) (*domain.Origin, error) {
	if projectID == "" {
		return nil, domain.ErrProjectMissingID()
	}
	origin.Pattern = strings.TrimSpace(origin.Pattern)
	if err := s.originValidator.Validate(origin); err != nil {
		return nil, err
	}

	var stored domain.Origin
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := requireProject(ctx, tx, projectID); err != nil {
			return err
		}

		inserted, err := tx.Statements().InsertOrigin(ctx, projectID, origin)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to insert origin")
		}
		if inserted {
			stored = origin
			return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
				Type:       domain.EventTypeOriginAdded,
				Category:   domain.EventCategoryEntity,
				ProjectID:  projectID,
				EntityType: "origin",
				EntityID:   origin.Pattern,
				Payload: domain.OriginPayload{
					Pattern: origin.Pattern,
					Kind:    origin.Kind,
				},
			})
		}

		existing, err := tx.Statements().GetOrigin(ctx, database.And(
			database.Equal(database.Col(domain.OriginFieldProjectID), projectID),
			database.Equal(database.Col(domain.OriginFieldPattern), origin.Pattern),
		))
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to look up origin after conflict")
		}
		if existing.Kind != origin.Kind {
			return domain.ErrOriginKindConflict()
		}
		stored = domain.Origin{Pattern: existing.Pattern, Kind: existing.Kind}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &stored, nil
}

// RemoveOrigin deletes one origin pattern. Removing a missing pattern is
// idempotent (no error).
func (s *projectService) RemoveOrigin(ctx context.Context, projectID, pattern string) error {
	if projectID == "" {
		return domain.ErrProjectMissingID()
	}
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return domain.ErrOriginInvalid()
	}

	return s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if err := requireProject(ctx, tx, projectID); err != nil {
			return err
		}

		deleted, removed, err := tx.Statements().DeleteOriginByPattern(ctx, projectID, pattern)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to delete origin")
		}
		if !deleted {
			return nil
		}
		return audit.Emit(ctx, tx.Statements(), audit.EmitSpec{
			Type:       domain.EventTypeOriginRemoved,
			Category:   domain.EventCategoryEntity,
			ProjectID:  projectID,
			EntityType: "origin",
			EntityID:   pattern,
			Payload: domain.OriginPayload{
				Pattern: removed.Pattern,
				Kind:    removed.Kind,
			},
		})
	})
}

func requireProject(ctx context.Context, tx Statementer[AllStatements], projectID string) error {
	exists, err := tx.Statements().ProjectExists(ctx, projectID)
	if err != nil {
		if mapped := mapStorageError(err); mapped != err {
			return mapped
		}
		return domain.ErrInternal(err).WithMessage("failed to load project")
	}
	if !exists {
		return domain.ErrProjectNotFound()
	}
	return nil
}
