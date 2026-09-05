/**
 * Decides whether a URL found in a note body is served by this
 * deployment's own object storage (spec/domains/storage.md).
 *
 * It is the one condition of `ExternalFetchPolicy.ensureFetchable` that
 * carries no I/O, split out so the read paths — the reference-import
 * registration condition of `updateNoteBody` / `restoreNoteRevision`, the
 * `skipped` decision of `importExternalReferences`, orphan-media
 * collection, and the note-detail reference report — can all share one
 * rule instead of each growing their own.
 *
 * `deliveryBaseUrl` is the prefix every stored object's URL starts with.
 * It is read back from `ObjectStorage.publicUrl` rather than spelled
 * here, so the deployment's URL shape stays inside the adapter
 * ([ADR 049](../../../../../spec/adr/049-object-storage-public-url.md)):
 * an app-relative delivery path and a bucket's public domain both reduce
 * to a prefix, and the policy needs nothing else about either.
 */
export interface StorageUrlPolicy {
  isInternal(url: string): boolean;
}

export const StorageUrlPolicy = {
  /**
   * `appUrl` is what a body-relative URL resolves against; both it and
   * `deliveryBaseUrl` come from the composition root, so an invalid pair
   * is a deployment misconfiguration rather than a business-rule
   * violation and is left to surface as such.
   */
  create: (
    params: Readonly<{ appUrl: string; deliveryBaseUrl: string }>,
  ): StorageUrlPolicy => {
    const base = new URL(params.deliveryBaseUrl, params.appUrl).toString();
    return {
      isInternal: (url: string): boolean =>
        URL.canParse(url, params.appUrl) &&
        new URL(url, params.appUrl).toString().startsWith(base),
    };
  },
};
