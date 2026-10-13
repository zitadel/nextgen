package service

import (
	"context"
	"errors"
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
	origin = domain.NormalizeOrigins([]domain.Origin{origin})[0]
	if err := s.originValidator.Validate(origin); err != nil {
		return nil, err
	}

	var stored domain.Origin
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		if _, err := tx.Statements().GetProjectByID(ctx, projectID); err != nil {
			if mapped := mapStorageError(err); mapped != err {
				return mapped
			}
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrProjectNotFound()
			}
			return domain.ErrInternal(err).WithMessage("failed to load project")
		}

		existing, err := tx.Statements().GetOrigin(ctx, database.And(
			database.Equal(database.Col(domain.OriginFieldProjectID), projectID),
			database.Equal(database.Col(domain.OriginFieldPattern), origin.Pattern),
		))
		if err == nil {
			if existing.Kind != origin.Kind {
				return domain.ErrOriginKindConflict()
			}
			stored = domain.Origin{Pattern: existing.Pattern, Kind: existing.Kind}
			return nil
		}
		if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
			return domain.ErrInternal(err).WithMessage("failed to look up origin")
		}

		inserted, err := tx.Statements().InsertOrigin(ctx, projectID, origin)
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to insert origin")
		}
		if !inserted {
			// Lost a race with another insert of the same pattern.
			again, getErr := tx.Statements().GetOrigin(ctx, database.And(
				database.Equal(database.Col(domain.OriginFieldProjectID), projectID),
				database.Equal(database.Col(domain.OriginFieldPattern), origin.Pattern),
			))
			if getErr != nil {
				return domain.ErrInternal(getErr).WithMessage("failed to re-read origin after conflict")
			}
			if again.Kind != origin.Kind {
				return domain.ErrOriginKindConflict()
			}
			stored = domain.Origin{Pattern: again.Pattern, Kind: again.Kind}
			return nil
		}
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
		if _, err := tx.Statements().GetProjectByID(ctx, projectID); err != nil {
			if mapped := mapStorageError(err); mapped != err {
				return mapped
			}
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrProjectNotFound()
			}
			return domain.ErrInternal(err).WithMessage("failed to load project")
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
