DELETE FROM zitadel_nextgen.instances
WHERE id IN (
    SELECT 
    'inst_' || i AS id
    FROM generate_series(1, 10) s(i)
);
