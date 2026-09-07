package service

import (
	"context"
	"errors"
	"slices"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type VariableToSet struct {
	Name     string
	Value    any
	IsSecret bool
}

// VariableService reads and writes the variables a requester owns or inherits.
//
// Unlike the settings ladder it replaces, variables do not override one
// another: a name entered at several owner levels yields one variable per
// level, and choosing between them is the caller's business. Storage restricts
// reads to the variables the requester may hold, so a value entered for another
// team can never reach a caller here.
type VariableService interface {
	GetVariables(ctx context.Context, requester domain.VariableOwner, names ...string) ([]*domain.Variable, error)
	SetVariables(ctx context.Context, owner domain.VariableOwner, variablesToSet []VariableToSet) error
	DeleteVariable(ctx context.Context, owner domain.VariableOwner, name string) error
	ReplaceVariables(ctx context.Context, requester domain.VariableOwner, doc map[string]any) (map[string]any, error)
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

func (s *variableService) SetVariables(ctx context.Context, owner domain.VariableOwner, variablesToSet []VariableToSet) error {
	if len(variablesToSet) == 0 {
		return nil
	}

	var crypter crypto.Crypter
	var err error

	containsSecret := slices.ContainsFunc(variablesToSet, func(set VariableToSet) bool {
		return set.IsSecret
	})
	if containsSecret {
		crypter, err = s.keys.GetProjectCrypter(ctx, owner.ProjectID, domain.EncryptionKeyPurposeSecret)
		if err != nil {
			return err
		}
	}

	vars := make([]*domain.Variable, len(variablesToSet), len(variablesToSet))
	for i, v := range variablesToSet {
		if v.IsSecret {
			vars[i], err = domain.NewSecretVariable(v.Name, owner, v.Value, crypter)
			if err != nil {
				return err
			}
		} else {
			vars[i], err = domain.NewVariable(v.Name, owner, v.Value)
			if err != nil {
				return err
			}
		}
	}

	// no need to start a transaction if there is only one variable
	if len(vars) == 1 {
		err = s.v2Pool.Statements().SetVariable(ctx, vars[0])
		if err != nil {
			return domain.ErrInternal(err).WithMessage("failed to write variable to database")
		}
		return nil
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		for _, v := range vars {
			if err := tx.Statements().SetVariable(ctx, v); err != nil {
				return domain.ErrInternal(err).WithMessage("failed to write variable to database")
			}
		}
		return nil
	})
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to set variables in the database")
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

func (s *variableService) ReplaceVariables(ctx context.Context, requester domain.VariableOwner, doc map[string]any) (map[string]any, error) {
	placeholders, err := domain.ScanDocumentForVariables(doc)
	if err != nil {
		return nil, err
	}
	if len(placeholders) == 0 {
		return doc, nil
	}

	// One name per query term, however many placeholders reference it.
	variableNames := make([]string, 0, len(placeholders))
	seen := make(map[string]bool, len(placeholders))
	for _, placeholder := range placeholders {
		if seen[placeholder.VariableName] {
			continue
		}
		seen[placeholder.VariableName] = true
		variableNames = append(variableNames, placeholder.VariableName)
	}

	varList, err := s.v2Pool.Statements().GetVariables(ctx, requester, variableNames...)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to get variables from database")
	}
	varMap := domain.VariableListToMap(varList)

	if err := domain.ValidateSecretPlaceholders(placeholders, varMap); err != nil {
		return nil, err
	}

	var containsSecrets bool
	for _, v := range varMap {
		if v.IsSecret {
			containsSecrets = true
			break
		}
	}

	if containsSecrets {
		varMap, err = domain.Variables(varMap).DecryptAll(s.decrypterOfWritingKey(ctx))
		if err != nil {
			return nil, err
		}
	}

	if err := domain.ReplaceVariables(placeholders, varMap); err != nil {
		return nil, err
	}

	return doc, nil
}

func (s *variableService) decrypterOfWritingKey(ctx context.Context) crypto.Decrypter {
	crypters := make(map[string]crypto.Decrypter)

	return crypto.DecrypterFn(func(encrypted string) (string, error) {
		header, err := domain.DecodeJWEHeader(encrypted)
		if err != nil {
			return "", domain.ErrInternal(err).WithMessage("failed to decode the header of an encrypted variable")
		}

		crypter, ok := crypters[header.KeyID]
		if !ok {
			crypter, err = s.keys.GetCrypter(ctx, header.KeyID, header.EncryptionAlgorithm)
			if err != nil {
				return "", err
			}
			crypters[header.KeyID] = crypter
		}
		return crypter.Decrypt(encrypted)
	})
}
