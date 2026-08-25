import { describeAuthTokenRepositoryContract } from "../../../conformance/authTokenRepository";
import { describeIdentityRemovalReceiptStoreContract } from "../../../conformance/identityRemovalReceiptStore";
import { describeIdentityRepositoryContract } from "../../../conformance/identityRepository";
import { describeLoginAttemptStoreContract } from "../../../conformance/loginAttemptStore";
import { describeOAuthStateStoreContract } from "../../../conformance/oauthStateStore";
import { describeSessionRepositoryContract } from "../../../conformance/sessionRepository";
import { describeUserBatchReaderContract } from "../../../conformance/userBatchReader";
import { describeUserRepositoryContract } from "../../../conformance/userRepository";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Step 5 — D1 Identity. Ports wired in `../ports/identity.ts`.
// Red until they are: a failure reading "not implemented: X.y" means the
// adapter is missing, anything else means it disagrees with the contract.
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
