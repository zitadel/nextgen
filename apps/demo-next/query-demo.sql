SELECT 
    p.id project_id
    , u.id userID
    , ua.value email -- email
    , pk.credential_id
    , pk.public_key
    , s.token_id
FROM zitadel_nextgen.projects p
LEFT JOIN zitadel_nextgen.users u ON u.project_id = p.id
LEFT JOIN zitadel_nextgen.user_attributes ua ON ua.user_id = u.id AND ua.key = 'email'
LEFT JOIN zitadel_nextgen.user_passkeys pk ON pk.user_id = u.id
LEFT JOIN zitadel_nextgen.sessions s ON s.user_id = u.id
order by p.created_at ASC
LIMIT 5;