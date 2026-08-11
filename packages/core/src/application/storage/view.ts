/**
 * DTO projections for the storage usecases. Fields are primitives only;
 * branded value objects widen naturally, so projection needs no casts.
 */

/**
 * `url` is the address the icon is served from, built by the object
 * store itself (ADR-011) — the usecase never learns the deployment's URL
 * shape. It is not written to the profile here: `updateProfile` owns
 * `User.avatarUrl`, and the form carries this value there (ADR-016).
 */
export type StoreAvatarView = Readonly<{
  fileId: string;
  url: string;
}>;
