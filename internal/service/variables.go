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

// VariableService reads and writes the variables one owner entered (ADR 061).
//
// The owner is an address, not a position in a ladder: nothing is inherited
// from the project by its environments, or seen by the project in them. Storage
// matches every owner column exactly, so a value entered at another owner can
// never reach a caller here -- and, since the primary key is the name plus that
// owner, a read yields at most one variable per name and there is nothing to
// choose between.
type VariableService interface {
	GetVariables(ctx context.Context, owner domain.VariableOwner, names ...string) ([]*domain.Variable, error)
	GetDecryptedVariables(ctx context.Context, owner domain.VariableOwner, names ...string) ([]*domain.Variable, error)
	SetVariables(ctx context.Context, owner domain.VariableOwner, variablesToSet []VariableToSet) error
	DeleteVariable(ctx context.Context, owner domain.VariableOwner, name string) error
	ReplaceVariablesInPlace(ctx context.Context, owner domain.VariableOwner, doc map[string]any) error
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

func (s *variableService) GetVariables(ctx context.Context, owner domain.VariableOwner, names ...string) ([]*domain.Variable, error) {
	variables, err := s.v2Pool.Statements().GetVariables(ctx, owner, names...)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to get variables from database")
	}
	return variables, nil
}

func (s *variableService) GetDecryptedVariables(ctx context.Context, owner domain.VariableOwner, names ...string) ([]*domain.Variable, error) {
	variables, err := s.GetVariables(ctx, owner, names...)
	if err != nil {
		return nil, err
	}

	// Built once and shared, so several secrets under one key cost one lookup;
	// built lazily, so a read holding no secret never reaches the key service.
	var decrypter crypto.Decrypter

	decrypted := make([]*domain.Variable, 0, len(variables))
	for _, variable := range variables {
		if !variable.IsSecret {
			decrypted = append(decrypted, variable)
			continue
		}
		if decrypter == nil {
			decrypter = s.decrypterOfWritingKey(ctx)
		}
		value, err := variable.GetDecryptedValue(decrypter)
		if err != nil {
			return nil, domain.ErrFailedToDecryptVariable(err).WithDetails(map[string]any{"name": variable.Name})
		}
		decrypted = append(decrypted, &domain.Variable{
			Name:     variable.Name,
			Owner:    variable.Owner,
			Value:    value,
			IsSecret: true,
		})
	}
	return decrypted, nil
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
			return setVariableError(err)
		}
		return nil
	}

	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		for _, v := range vars {
			// The cause travels: a Spanner abort has to stay matchable for
			// ReadWriteTransaction to retry the callback.
			if err := tx.Statements().SetVariable(ctx, v); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return setVariableError(err)
	}
	return nil
}

// setVariableError names the one write failure a caller can act on. The
// variables table references (project_id, name) on environments, so an owner
// naming an environment that does not exist is refused by the database rather
// than stored where nothing would ever read it -- which, with no inheritance to
// fall back on, would read as empty rather than as the project's value.
//
// The project reference fails the same way, but it cannot be reached here: the
// project is resolved from the request before a variable is built.
func setVariableError(err error) error {
	if de, ok := errors.AsType[domain.Error](err); ok {
		return de
	}
	if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
		return domain.ErrEnvironmentNotFound().WithParent(err)
	}
	return domain.ErrInternal(err).WithMessage("failed to write variable to database")
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

func (s *variableService) ReplaceVariablesInPlace(ctx context.Context, owner domain.VariableOwner, doc map[string]any) error {
	placeholders, err := domain.ScanDocumentForVariables(doc)
	if err != nil {
		return err
	}
	if len(placeholders) == 0 {
		return nil
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

	varList, err := s.v2Pool.Statements().GetVariables(ctx, owner, variableNames...)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to get variables from database")
	}
	varMap := domain.VariableListToMap(varList)

	if err := domain.ValidateSecretPlaceholders(placeholders, varMap); err != nil {
		return err
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
			return err
		}
	}

	if err := domain.ReplaceVariables(placeholders, varMap); err != nil {
		return err
	}

	return nil
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
