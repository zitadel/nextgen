package all

import (
	_ "github.com/zitadel/zitadel/v5/internal/storage/dialect/postgres"
	_ "github.com/zitadel/zitadel/v5/internal/storage/dialect/spanner"
	_ "github.com/zitadel/zitadel/v5/internal/storage/dialect/sqlite"
)
