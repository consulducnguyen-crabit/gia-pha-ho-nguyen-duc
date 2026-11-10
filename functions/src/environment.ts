export function requireLocalEmulators(env: NodeJS.ProcessEnv = process.env) {
  if (
    env.FUNCTIONS_EMULATOR !== "true" ||
    env.GCLOUD_PROJECT !== "demo-gia-pha" ||
    env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
    env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
  )
    throw new Error("Backend này chỉ hoạt động trên demo emulator cục bộ.");
}
