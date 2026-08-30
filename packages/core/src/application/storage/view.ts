/**
 * DTO projections for the storage usecases. Fields are primitives only;
 * branded value objects widen naturally, so projection needs no casts.
 */

/**
 * `url` is the address the icon is served from, built by the object
 * store itself — the usecase never learns the deployment's URL shape. It
 * is not written to the profile here: `updateProfile` owns
 * `User.avatarUrl`, and the form carries this value there.
 */
export type StoreAvatarView = Readonly<{
  fileId: string;
  url: string;
}>;

/**
 * `mimeType` and `size` are what the store actually holds, not what the
 * client sent: the type is read from the leading bytes and the size is
 * measured after SVG sanitization, so the editor builds its `img` /
 * `video` element from the same figures the metadata row carries.
 */
export type StoreMediaView = Readonly<{
  fileId: string;
  url: string;
  mimeType: string;
  size: number;
}>;
