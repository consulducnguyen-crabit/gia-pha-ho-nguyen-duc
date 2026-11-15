import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { requireLocalEmulators } from "./environment.js";
import { proposalService } from "./proposals.js";

function service() {
  // Before Admin initialization or any privileged operation. Production is closed.
  try {
    requireLocalEmulators();
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "Backend chỉ dùng cho emulator cục bộ.",
    );
  }
  const app = getApps()[0] ?? initializeApp({ projectId: "demo-gia-pha" });
  return {
    ...proposalService(getFirestore(app), getAuth(app)),
  };
}
type Operation = keyof ReturnType<typeof service>;
function endpoint(operation: Operation) {
  return onCall(async (request: CallableRequest<unknown>) => {
    try {
      return await service()[operation](request.auth?.uid, request.data);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      // Do not log request data, email, or raw SDK errors.
      throw new HttpsError(
        "internal",
        "Không thể hoàn tất yêu cầu. Vui lòng thử lại.",
      );
    }
  });
}
export const createChangeDraft = endpoint("createChangeDraft");
export const editChangeDraft = endpoint("editChangeDraft");
export const submitChangeRequest = endpoint("submitChangeRequest");
export const reviewChangeRequest = endpoint("reviewChangeRequest");
export const getChangeRequest = endpoint("getChangeRequest");
export const listChangeRequests = endpoint("listChangeRequests");
