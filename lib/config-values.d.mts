export type ClientIpStrategy = "none" | "trusted_header" | "trusted_proxy";
export type ServerConfig = {
  databaseUrl: string;
  databasePoolMax: number;
  appOrigin: string;
  midtransServerKey: string;
  midtransIsProduction: boolean;
  clientIpStrategy: ClientIpStrategy;
  trustedClientIpHeader: string;
  trustedProxyHops: number;
  requireOrderingQr: boolean;
  isProduction: boolean;
  allowDevStaffBypass: boolean;
};
export function getServerConfig(env?: Record<string, string | undefined>, nodeEnv?: string): ServerConfig;
export function getMigrationDatabaseUrl(env?: Record<string, string | undefined>, nodeEnv?: string): string;
