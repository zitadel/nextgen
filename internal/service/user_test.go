package service_test

import (
	"context"
	"errors"
	"testing"

	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/crypto/cryptomock"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbmock"

	"github.com/zitadel/nextgen/internal/domain"
)

// beginnerDB satisfies both database.QueryExecutor and database.Beginner,
// matching what SetPassword requires from dbClient.
type beginnerDB struct {
	*dbmock.MockQueryExecutor
	*dbmock.MockBeginner
}

func TestUserService_SetPassword(t *testing.T) {
	t.Parallel()

	const (
		projectID = "proj-1"
		userID    = "user-1"
		password  = "s3cr3t"
		hashed    = "hashed-value"
	)

	baseInput := service.SetPasswordInput{
		ProjectID: projectID,
		UserID:    userID,
		Password:  password,
	}

	tests := []struct {
		name              string
		input             service.SetPasswordInput
		notABeginner      bool
		setupHasher       func(*cryptomock.MockHasher)
		setupDB           func(*dbmock.MockBeginner, *dbmock.MockTransaction)
		setupPasswordRepo func(*domainmock.MockUserPasswordRepository)
		wantErr           error
	}{
		{
			name:  "success",
			input: baseInput,
			setupHasher: func(h *cryptomock.MockHasher) {
				h.EXPECT().Hash(password).Return(hashed, nil)
			},
			setupDB: func(b *dbmock.MockBeginner, tx *dbmock.MockTransaction) {
				b.EXPECT().Begin(gomock.Any(), nil).Return(tx, nil)
				tx.EXPECT().End(gomock.Any(), nil).Return(nil)
			},
			setupPasswordRepo: func(r *domainmock.MockUserPasswordRepository) {
				r.EXPECT().DeleteByUserID(gomock.Any(), gomock.Any(), projectID, userID).Return(nil)
				r.EXPECT().Create(gomock.Any(), gomock.Any(), &domain.CreateUserPassword{
					ProjectID:      projectID,
					UserID:         userID,
					EncodedHash:    hashed,
					ChangeRequired: false,
					VerificationID: nil,
				}).Return(nil)
			},
		},
		{
			name: "propagates_change_required",
			input: service.SetPasswordInput{
				ProjectID:                projectID,
				UserID:                   userID,
				Password:                 password,
				IsPasswordChangeRequired: true,
			},
			setupHasher: func(h *cryptomock.MockHasher) {
				h.EXPECT().Hash(password).Return(hashed, nil)
			},
			setupDB: func(b *dbmock.MockBeginner, tx *dbmock.MockTransaction) {
				b.EXPECT().Begin(gomock.Any(), nil).Return(tx, nil)
				tx.EXPECT().End(gomock.Any(), nil).Return(nil)
			},
			setupPasswordRepo: func(r *domainmock.MockUserPasswordRepository) {
				r.EXPECT().DeleteByUserID(gomock.Any(), gomock.Any(), projectID, userID).Return(nil)
				r.EXPECT().Create(gomock.Any(), gomock.Any(), &domain.CreateUserPassword{
					ProjectID:      projectID,
					UserID:         userID,
					EncodedHash:    hashed,
					ChangeRequired: true,
					VerificationID: nil,
				}).Return(nil)
			},
		},
		{
			name:  "hash_error",
			input: baseInput,
			setupHasher: func(h *cryptomock.MockHasher) {
				h.EXPECT().Hash(password).Return("", errors.New("bcrypt failed"))
			},
			wantErr: domain.ErrInternal(nil),
		},
		{
			name:         "not_a_beginner",
			input:        baseInput,
			notABeginner: true,
			setupHasher: func(h *cryptomock.MockHasher) {
				h.EXPECT().Hash(password).Return(hashed, nil)
			},
			wantErr: domain.ErrInternal(database.ErrNotABeginner),
		},
		{
			name:  "begin_error",
			input: baseInput,
			setupHasher: func(h *cryptomock.MockHasher) {
				h.EXPECT().Hash(password).Return(hashed, nil)
			},
			setupDB: func(b *dbmock.MockBeginner, _ *dbmock.MockTransaction) {
				b.EXPECT().Begin(gomock.Any(), nil).Return(nil, errors.New("conn failed"))
			},
			wantErr: domain.ErrInternal(nil),
		},
		{
			name:  "delete_error",
			input: baseInput,
			setupHasher: func(h *cryptomock.MockHasher) {
				h.EXPECT().Hash(password).Return(hashed, nil)
			},
			setupDB: func(b *dbmock.MockBeginner, tx *dbmock.MockTransaction) {
				b.EXPECT().Begin(gomock.Any(), nil).Return(tx, nil)
				tx.EXPECT().End(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, err error) error { return err })
			},
			setupPasswordRepo: func(r *domainmock.MockUserPasswordRepository) {
				r.EXPECT().DeleteByUserID(gomock.Any(), gomock.Any(), projectID, userID).Return(errors.New("delete failed"))
			},
			wantErr: domain.ErrInternal(nil),
		},
		{
			name:  "create_foreign_key_error",
			input: baseInput,
			setupHasher: func(h *cryptomock.MockHasher) {
				h.EXPECT().Hash(password).Return(hashed, nil)
			},
			setupDB: func(b *dbmock.MockBeginner, tx *dbmock.MockTransaction) {
				b.EXPECT().Begin(gomock.Any(), nil).Return(tx, nil)
				tx.EXPECT().End(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, err error) error { return err })
			},
			setupPasswordRepo: func(r *domainmock.MockUserPasswordRepository) {
				r.EXPECT().DeleteByUserID(gomock.Any(), gomock.Any(), projectID, userID).Return(nil)
				r.EXPECT().Create(gomock.Any(), gomock.Any(), &domain.CreateUserPassword{
					ProjectID:      projectID,
					UserID:         userID,
					EncodedHash:    hashed,
					ChangeRequired: false,
					VerificationID: nil,
				}).Return(&database.ForeignKeyError{})
			},
			wantErr: domain.ErrUserNotFound(),
		},
		{
			name:  "create_other_error",
			input: baseInput,
			setupHasher: func(h *cryptomock.MockHasher) {
				h.EXPECT().Hash(password).Return(hashed, nil)
			},
			setupDB: func(b *dbmock.MockBeginner, tx *dbmock.MockTransaction) {
				b.EXPECT().Begin(gomock.Any(), nil).Return(tx, nil)
				tx.EXPECT().End(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, err error) error { return err })
			},
			setupPasswordRepo: func(r *domainmock.MockUserPasswordRepository) {
				r.EXPECT().DeleteByUserID(gomock.Any(), gomock.Any(), projectID, userID).Return(nil)
				r.EXPECT().Create(gomock.Any(), gomock.Any(), &domain.CreateUserPassword{
					ProjectID:      projectID,
					UserID:         userID,
					EncodedHash:    hashed,
					ChangeRequired: false,
					VerificationID: nil,
				}).Return(errors.New("boom"))
			},
			wantErr: domain.ErrInternal(nil),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			ctrl := gomock.NewController(t)
			hasher := cryptomock.NewMockHasher(ctrl)
			tx := dbmock.NewMockTransaction(ctrl)
			passwordRepo := domainmock.NewMockUserPasswordRepository(ctrl)
			beginner := dbmock.NewMockBeginner(ctrl)

			if tt.setupHasher != nil {
				tt.setupHasher(hasher)
			}
			if tt.setupDB != nil {
				tt.setupDB(beginner, tx)
			}
			if tt.setupPasswordRepo != nil {
				tt.setupPasswordRepo(passwordRepo)
			}

			var db database.QueryExecutor
			if tt.notABeginner {
				db = dbmock.NewMockQueryExecutor(ctrl)
			} else {
				db = &beginnerDB{
					MockQueryExecutor: dbmock.NewMockQueryExecutor(ctrl),
					MockBeginner:      beginner,
				}
			}

			svc := service.NewUserService(db, nil, passwordRepo, nil, nil, hasher)
			err := svc.SetPassword(t.Context(), tt.input)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("SetPassword err = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("SetPassword returned unexpected error: %v", err)
			}
		})
	}
}
