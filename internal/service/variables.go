package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// VariableService reads and writes the variables a requester owns or inherits.
//
// Unlike the settings ladder it replaces, variables do not override one
// another: a name entered at several owner levels yields one variable per
// level, and choosing between them is the caller's business. Storage restricts
// reads to the variables the requester may hold, so a value entered for another
// team can never reach a caller here.
type VariableService interface {
	// GetVariables returns every variable the requester can read, narrowed to
	// names when any are given. Names nobody entered a variable for are simply
	// absent; an empty result is an ordinary outcome, not an error.
	// If the variable is stored encrypted, it is not decrypted automatically.
	GetVariables(ctx context.Context, requester domain.VariableOwner, names ...string) ([]*domain.Variable, error)
	// SetVariable writes variable under its own name and owner, replacing one
	// already entered at that name and owner. If the [isSecret] flag is set
	// the variable will be stored encrypted.
	SetVariable(ctx context.Context, name string, owner domain.VariableOwner, value any, isSecret bool) error
	// DeleteVariable removes the variable owner entered under name. It returns
	// [domain.ErrVariableNotFound] when owner entered no such variable, which
	// includes the case where owner can only see one it inherited: a variable
	// is deletable only by the owner that entered it.
	DeleteVariable(ctx context.Context, owner domain.VariableOwner, name string) error
}

type variableService struct {
	v2Pool *DB
	keys   KeyService
}

func NewVariableService(
	v2Pool *DB,
	keys KeyService,
) VariableService {
	return &variableService{
		v2Pool: v2Pool,
		keys:   keys,
	}
}

func (s *variableService) GetVariables(ctx context.Context, requester domain.VariableOwner, names ...string) ([]*domain.Variable, error) {
	variables, err := s.v2Pool.Statements().GetVariables(ctx, requester, names...)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to get variables from database")
	}
	return variables, nil
}

func (s *variableService) SetVariable(ctx context.Context,
	name string, owner domain.VariableOwner,
	value any, isSecret bool,
) error {
	var variable *domain.Variable

	if isSecret {
		crypter, err := s.keys.GetProjectCrypter(ctx, owner.ProjectID, domain.EncryptionKeyPurposeSecret)
		if err != nil {
			return err
		}
		variable, err = domain.NewSecretVariable(name, owner, value, crypter)
		if err != nil {
			return err
		}
	} else {
		variable = domain.NewVariable(name, owner, value)
	}

	if err := s.v2Pool.Statements().SetVariable(ctx, variable); err != nil {
		return domain.ErrInternal(err).WithMessage("failed to write variable to database")
	}
	return nil
}

func (s *variableService) DeleteVariable(ctx context.Context, owner domain.VariableOwner, name string) error {
	if err := s.v2Pool.Statements().DeleteVariable(ctx, owner, name); err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return domain.ErrVariableNotFound().WithParent(err)
		}
		return domain.ErrInternal(err).WithMessage("failed to delete variable from database")
	}
	return nil
}
