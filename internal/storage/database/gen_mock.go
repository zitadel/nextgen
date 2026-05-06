package database

//go:generate mkdir -p ./dbmock
//go:generate go tool mockgen -source=./database.go -aux_files github.com/zitadel/nextgen/internal/storage/database=./tx.go,github.com/zitadel/nextgen/internal/storage/database=./migration.go -package=dbmock -destination=./dbmock/database.mock.go
//go:generate go tool mockgen -source=./tx.go -aux_files github.com/zitadel/nextgen/internal/storage/database=./database.go -package=dbmock -destination=./dbmock/tx.mock.go
