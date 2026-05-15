# Repository Agent Instructions

These instructions apply to `internal/storage/database/repository/`.

## 1. Scope Split: Relational Repositories vs Users EAV

- Use the repository pattern in this folder for traditional relational tables.
- Do not treat users as a traditional table-shaped repository entity.
- Users use the EAV model described in `docs/adrs/008-users-eav-store.md`.

## 2. Relational Repository Structure

Repository structs should expose:
- `qualifiedTableName() string`
- `PrimaryKeyColumns() []database.Column`
- `UpdatedAtColumn() database.Column` (for updatable entities)

## 3. Relational CRUD Patterns

- **Create / read / update / delete**: Use `database.NewStatementBuilder` for SQL, or focused parameterized statements when clearer (for example multi-statement handoff transactions).
- **Read**: Use `repository.getOne[T]` or `repository.getMany[T]` where they fit.
- Optional helpers such as `updateOne` / `deleteOne` exist in `repository.go`; use them when convenient, not as a requirement.

## 4. Conditions And Changes

- Build filters with `database.And(...)`, `database.Or(...)`, and
  `database.NewTextCondition(...)` (or typed condition helpers).
- Represent scoping values such as `project_id` as `Condition`s.
- Avoid special-casing `project_id` as a separate method argument when the
  repository helper already accepts conditions.
- Use `database.NewChange(column, value)` for updates.

## 5. Safety Constraints

- Ensure write operations are constrained by primary key and tenant scope.
- When using `updateOne` / `deleteOne`, they validate conditions with
  `checkPKOrUniqueKeyCondition`. Custom write helpers should mirror that pattern.
