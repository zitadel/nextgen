package database

//go:generate mockgen -typed -package dbmock -destination ./dbmock/database.mock.go github.com/zitadel/nextgen/internal//storage/database Pool,Connection,Row,Rows,Transaction
