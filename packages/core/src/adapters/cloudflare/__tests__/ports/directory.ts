import type { AccountDeletionManifestStore } from "../../../../application/ports/accountDeletionManifestStore";
import type { DistributedOperationStore } from "../../../../application/ports/distributedOperationStore";
import type { GlobalMaintenanceRunStore } from "../../../../application/ports/globalMaintenanceRunStore";
import type { IdentityUniqueDirectory } from "../../../../domain/identity/ports/identityUniqueDirectory";
import { createD1AccountDeletionManifestStore } from "../../d1/repositories/accountDeletionManifestStore";
import { createD1DistributedOperationStore } from "../../d1/repositories/distributedOperationStore";
import { createD1GlobalMaintenanceRunStore } from "../../d1/repositories/globalMaintenanceRunStore";
import { createD1IdentityUniqueDirectory } from "../../d1/repositories/identityUniqueDirectory";
import { port } from "../pendingPorts";
import type { GlobalPortDeps } from "./deps";

/**
 * Step 6 — the D1 directory / operation bundle, where the conditional
 * updates concentrate.
 *
 * `GlobalMaintenanceRunStore` must read its sweep-table set from
 * `deps.maintenanceTablesByKind` **at run creation time** and snapshot it
 * onto the run row, never re-read it afterwards (ADR 061) — that record
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
    identityUniqueDirectory: port<IdentityUniqueDirectory>(
      "IdentityUniqueDirectory",
      () => createD1IdentityUniqueDirectory(deps),
    ),
    distributedOperationStore: port<DistributedOperationStore>(
      "DistributedOperationStore",
      () => createD1DistributedOperationStore(deps),
    ),
    accountDeletionManifestStore: port<AccountDeletionManifestStore>(
      "AccountDeletionManifestStore",
      () => createD1AccountDeletionManifestStore(deps),
    ),
    globalMaintenanceRunStore: port<GlobalMaintenanceRunStore>(
      "GlobalMaintenanceRunStore",
      () => createD1GlobalMaintenanceRunStore(deps),
    ),
  };
}
