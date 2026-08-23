/**
 * The single entry point every component uses to reach the backend.
 *
 * Implementation is chosen once, at module load, from NEXT_PUBLIC_DEMO_MODE.
 * There is no runtime fallback between the two: if demo mode is off and the
 * backend is unreachable, callers get an ApiError and the UI shows a retryable
 * failure. Fixtures never rescue a broken live request.
 */

import * as live from "./client";
import * as demo from "./demoAdapter";

export const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

const impl = IS_DEMO_MODE ? demo : live;

export const createSource = impl.createSource;
export const getJob = impl.getJob;
export const getSource = impl.getSource;
export const getSourceEvidence = impl.getSourceEvidence;
export const getEvent = impl.getEvent;
export const runQuery = impl.runQuery;
export const getEvidenceSource = impl.getEvidenceSource;
export const getHealth = impl.getHealth;
export const runEvaluation = impl.runEvaluation;

export {
  API_BASE_URL,
  API_PREFIX,
  ApiError,
  DEFAULT_COLLECTION_ID,
  assetUrl,
  setAuthTokenProvider,
  type ApiErrorKind,
  type UploadProgress,
} from "./client";

export * from "./schemas";
