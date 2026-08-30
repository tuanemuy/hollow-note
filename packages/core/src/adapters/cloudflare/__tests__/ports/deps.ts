import type { AccountDeletionReceipt } from "../../../../application/ports/accountDeletionManifestStore";
import type { MaintenanceKind } from "../../../../application/ports/globalMaintenanceRunStore";
import type { IdGenerator } from "../../../../application/ports/idGenerator";
import type { PersonalCleanupComponent } from "../../../../application/ports/scopeCleanupAdmissionStore";
import type { ScopeKey } from "../../../../application/scope";
import type { TestClock } from "../../../conformance/testClock";
import type { ScopeObjectNamespace } from "../../do/scopeStub";
import type { SqlSession } from "../../sql/session";

/**
 * Everything a Cloudflare port implementation may need, gathered once by
 * the conformance factory.
 *
 * `namespace` and `objectKeyPrefix` are the isolation this backend was
 * handed out under: the workers pool separates storage per **file**,
 * while the suites contract for a fresh backend per **test**, so every
 * factory call takes a new namespace. Production passes empty strings
 * through the same arguments.
 */
export type CloudflareBackendDeps = Readonly<{
  db: D1Database;
  bucket: R2Bucket;
  scopeObjects: ScopeObjectNamespace;
  /** Durable Object name prefix; `""` in production. */
  namespace: string;
  /** R2 key prefix; `""` in production. */
  objectKeyPrefix: string;
  clock: TestClock;
  idGenerator: IdGenerator;
  maintenanceShardIds: readonly string[];
  /**
   * Mutable on purpose: `ConformanceBackend.setMaintenanceTables`
   * replaces one kind's set after the backend was built, standing in for
   * a deploy that changes the configuration mid-run. Only runs created
   * *after* the call may see it.
   */
  maintenanceTablesByKind: Record<MaintenanceKind, readonly string[]>;
  /**
   * WorkspaceIds `ConformanceBackend.makeWorkspaceDirectoryUnreadable`
   * has put out of reach. Mutable for the same reason
   * `maintenanceTablesByKind` is: the suites induce the outage *after*
   * the ports were built, and the directory readers hold this very set.
   * Production wires an empty one and never adds to it.
   */
  workspaceDirectoryOutages: Set<string>;
  requiredCleanupComponents: readonly PersonalCleanupComponent[] | undefined;
  requiredFinalizeReceipts: readonly AccountDeletionReceipt[] | undefined;
}>;

/** Deps plus the session a global-plane port reads and writes through. */
export type GlobalPortDeps = CloudflareBackendDeps &
  Readonly<{ session: SqlSession }>;

/** Deps plus the session and identity of one scope object. */
export type ScopePortDeps = CloudflareBackendDeps &
  Readonly<{ session: SqlSession; scope: ScopeKey }>;
