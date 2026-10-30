export interface BootstrapUserOptions {
  email: string;
  password: string;
  user_id: string;
  team_id: string;
  project_id: string;
  schema_url: string;
}

/** Node-only bootstrap document builder shared by the CLI and cloud setup. */
export declare function bootstrapUserDocument(options: BootstrapUserOptions): {
  header: { project_id: string; team_id: string; schema_url: string; id: string };
  attributes: {
    username: string;
    email: string;
    "zitadel.source": "cli";
    "zitadel.default_user": true;
  };
  authenticators: { password: { encoded_hash: string; change_required: false } };
};
