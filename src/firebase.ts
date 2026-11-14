import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
const env = import.meta.env;
export const emulator = env.VITE_USE_EMULATORS === "true";
if (emulator && !["localhost", "127.0.0.1"].includes(location.hostname))
  throw new Error("Emulator chỉ chạy trên máy cục bộ.");
const configured =
  emulator ||
  ["API_KEY", "AUTH_DOMAIN", "PROJECT_ID", "STORAGE_BUCKET", "APP_ID"].every(
    (k) => env[`VITE_FIREBASE_${k}`],
  );
const app = configured
  ? initializeApp(
      emulator
        ? {
            apiKey: "demo-key",
            projectId: "demo-gia-pha",
            authDomain: "localhost",
            storageBucket: "demo-gia-pha.appspot.com",
          }
        : {
            apiKey: env.VITE_FIREBASE_API_KEY,
            authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: env.VITE_FIREBASE_PROJECT_ID,
            storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
            appId: env.VITE_FIREBASE_APP_ID,
          },
    )
  : null;
export const firebaseApp = app;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const membershipFunctions =
  app && emulator ? getFunctions(app, "us-central1") : null;
if (emulator && auth && db) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
if (membershipFunctions)
  connectFunctionsEmulator(membershipFunctions, "127.0.0.1", 5001);
