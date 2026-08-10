import { createSerializationAdapter } from "@tanstack/react-router";
import {
  AppServerError,
  isAppServerErrorShaped,
  type SerializedError,
} from "./errorResponse";

// Registered on the global start instance so `AppServerError` survives the
// Seroval roundtrip. The `test` is structural (`isAppServerErrorShaped`)
// rather than `instanceof`: the server hosts parallel module graphs
// (ssr / rsc / server-fn split), each with its own copy of the class, and
// an identity test in one graph misses instances built in another — the
// error then degrades to the built-in ShallowErrorPlugin, which keeps only
// `message` and loses the kind tag.
export const appServerErrorAdapter = createSerializationAdapter<
  AppServerError,
  SerializedError
>({
  key: "AppServerError",
  test: isAppServerErrorShaped,
  toSerializable: (value) => value.serialized,
  fromSerializable: (value) => new AppServerError(value),
});
