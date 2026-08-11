import { describeSignInOAuthClientContract } from "../../conformance/signInOAuthClient";
import {
  createDevSignInOAuthClient,
  encodeDevAuthorizationCode,
} from "../devSignInOAuthClient";
import { createGoogleSignInOAuthClient } from "../googleSignInOAuthClient";

const APP_URL = "https://app.example.test";
const REDIRECT_URI = `${APP_URL}/auth/callback/google`;

/**
 * The single place the Google suite's precondition is expressed: without
 * a client id / secret there is no provider to talk to, so the
 * registration below stays and its exchange half runs skipped (AC-6).
 * The authorization-request half needs no credentials and always runs.
 */
function googleCredentials(): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  return clientId !== undefined &&
    clientId.length > 0 &&
    clientSecret !== undefined &&
    clientSecret.length > 0
    ? { clientId, clientSecret }
    : null;
}

describeSignInOAuthClientContract("dev", () => ({
  client: createDevSignInOAuthClient({ appUrl: APP_URL }),
  provider: "google",
  redirectUri: REDIRECT_URI,
  exchange: { kind: "offline", mintCode: encodeDevAuthorizationCode },
}));

const credentials = googleCredentials();
describeSignInOAuthClientContract(
  "google",
  () => ({
    client: createGoogleSignInOAuthClient(
      credentials ?? { clientId: "", clientSecret: "" },
    ),
    provider: "google",
    redirectUri: REDIRECT_URI,
    exchange: { kind: "live" },
  }),
  { enabled: credentials !== null },
);
