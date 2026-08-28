import { describeAuthTokenRepositoryContract } from "../../../conformance/authTokenRepository";
import { describeIdentityRemovalReceiptStoreContract } from "../../../conformance/identityRemovalReceiptStore";
import { describeIdentityRepositoryContract } from "../../../conformance/identityRepository";
import { describeLoginAttemptStoreContract } from "../../../conformance/loginAttemptStore";
import { describeOAuthStateStoreContract } from "../../../conformance/oauthStateStore";
import { describeSessionRepositoryContract } from "../../../conformance/sessionRepository";
import { describeUserBatchReaderContract } from "../../../conformance/userBatchReader";
import { describeUserRepositoryContract } from "../../../conformance/userRepository";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Suites for the D1 Identity ports (`../ports/identity.ts`).
const BACKEND = "cloudflare";

describeUserRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeIdentityRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeSessionRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeAuthTokenRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeIdentityRemovalReceiptStoreContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeUserBatchReaderContract(BACKEND, makeCloudflareConformanceBackend);
describeLoginAttemptStoreContract(BACKEND, makeCloudflareConformanceBackend);
describeOAuthStateStoreContract(BACKEND, makeCloudflareConformanceBackend);
