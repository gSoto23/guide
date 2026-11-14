/**
 * Amazon RDS for PostgreSQL 16 (ADR-0009, SEC-17).
 * Storage is encrypted, automated backups enable point-in-time recovery, and production is
 * protected from deletion.
 */
import { isProduction, stageConfig } from "./config";
import { vpc } from "./network";

export const database = new sst.aws.Postgres("Database", {
  vpc,
  version: "16",
  instance: stageConfig.databaseInstance,
  storage: "20 GB",
  multiAz: stageConfig.databaseMultiAz,
  transform: {
    // Connections must use TLS (security review T103). SST's default parameter group allows
    // plaintext; the services connect with sslmode set.
    parameterGroup: (args) => {
      args.parameters = [
        { name: "rds.force_ssl", value: "1" },
        ...((args.parameters as { name: string; value: string }[] | undefined) ?? []).filter(
          (parameter) => parameter.name !== "rds.force_ssl",
        ),
      ];
    },
    instance: (args) => {
      args.storageEncrypted = true;
      args.backupRetentionPeriod = isProduction ? 14 : 7;
      args.deletionProtection = isProduction;
      args.copyTagsToSnapshot = true;
    },
  },
});
