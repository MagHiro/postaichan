/** The single production DATABASE_URL login performs runtime work and can SET ROLE for migrations. */
export type ProductionDatabaseRole = Readonly<{
  is_superuser: boolean;
  owns_public_schema: boolean;
  owns_app_objects: boolean;
  runtime_member: boolean;
  ddl_member: boolean;
  runtime_group_safe: boolean;
  ddl_group_safe: boolean;
}>;

export function isSafeProductionDatabaseRole(role: ProductionDatabaseRole | null | undefined): boolean {
  return Boolean(role
    && !role.is_superuser
    && role.owns_public_schema
    && !role.owns_app_objects
    && role.runtime_member
    && role.ddl_member
    && role.runtime_group_safe
    && role.ddl_group_safe);
}
