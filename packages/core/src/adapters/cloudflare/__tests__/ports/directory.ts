import type { AccountDeletionManifestStore } from "../../../../application/ports/accountDeletionManifestStore";
import type { DistributedOperationStore } from "../../../../application/ports/distributedOperationStore";
import type { GlobalMaintenanceRunStore } from "../../../../application/ports/globalMaintenanceRunStore";
import type { IdentityUniqueDirectory } from "../../../../domain/identity/ports/identityUniqueDirectory";
import { createD1AccountDeletionManifestStore } from "../../d1/repositories/accountDeletionManifestStore";
import { createD1DistributedOperationStore } from "../../d1/repositories/distributedOperationStore";
import { createD1GlobalMaintenanceRunStore } from "../../d1/repositories/globalMaintenanceRunStore";
import { createD1IdentityUniqueDirectory } from "../../d1/repositories/identityUniqueDirectory";
import type { GlobalPortDeps } from "./deps";

/**
 * The D1 directory / operation bundle, where the conditional updates
 * concentrate.
 *
 * `GlobalMaintenanceRunStore` reads its sweep-table set from
 * `deps.maintenanceTablesByKind` **at run creation time** and snapshots it
 * onto the run row, never re-reading it afterwards (ADR 061) — that record
 * is deliberately mutable so `setMaintenanceTables` can stand in for a
 * mid-run deploy.
 *
 * Suites: `conformance/directory.test.ts`.
 */
export type DirectoryPorts = Readonly<{
  identityUniqueDirectory: IdentityUniqueDirectory;
  distributedOperationStore: DistributedOperationStore;
  accountDeletionManifestStore: AccountDeletionManifestStore;
  globalMaintenanceRunStore: GlobalMaintenanceRunStore;
}>;

export function createDirectoryPorts(deps: GlobalPortDeps): DirectoryPorts {
  return {
    identityUniqueDirectory: createD1IdentityUniqueDirectory(deps),
    distributedOperationStore: createD1DistributedOperationStore(deps),
    accountDeletionManifestStore: createD1AccountDeletionManifestStore(deps),
    globalMaintenanceRunStore: createD1GlobalMaintenanceRunStore(deps),
  };
}
