package all

import (
	_ "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres"
	_ "github.com/zitadel/nextgen/internal/storage/v2/dialect/sqlite"
	_ "github.com/zitadel/nextgen/internal/storage/v2/dialect/spanner"
)
