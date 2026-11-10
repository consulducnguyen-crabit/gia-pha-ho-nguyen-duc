import { describe, expect, it } from "vitest";
import { requireLocalEmulators } from "../src/environment";

const local = {
  FUNCTIONS_EMULATOR: "true",
  GCLOUD_PROJECT: "demo-gia-pha",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
};
describe("privileged backend environment boundary", () => {
  it("accepts only the fixed local demo emulators", () => {
    expect(() => requireLocalEmulators(local)).not.toThrow();
  });
  for (const key of Object.keys(local)) {
    it(`fails closed when ${key} is absent`, () => {
      const env: NodeJS.ProcessEnv = { ...local };
      delete env[key];
      expect(() => requireLocalEmulators(env)).toThrow();
    });
  }
  for (const [key, value] of [
    ["FUNCTIONS_EMULATOR", "false"],
    ["GCLOUD_PROJECT", "real-production-project"],
    ["FIRESTORE_EMULATOR_HOST", "firestore.googleapis.com:443"],
    ["FIREBASE_AUTH_EMULATOR_HOST", "identitytoolkit.googleapis.com:443"],
    ["FIRESTORE_EMULATOR_HOST", "127.0.0.1:8081"],
    ["FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099"],
  ]) {
    it(`rejects a non-local configuration for ${key}: ${value}`, () => {
      expect(() => requireLocalEmulators({ ...local, [key]: value })).toThrow();
    });
  }
});
