DELETE FROM zitadel_nextgen.projects
WHERE id IN (
    SELECT 'proj_' || i AS id FROM generate_series(1, 10) s(i)
);
