// Deliberately refuses every non-emulator destination.
import { initializeApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
} from "firebase/auth";
const project = "demo-gia-pha";
if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
)
  throw Error(
    "Set both local emulator hosts explicitly; production is forbidden.",
  );
const app = initializeApp({ apiKey: "demo-key", projectId: project });
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const email = "thanhvien@example.test",
  password = "Demo-only-2026!";
let uid;
try {
  uid = (await createUserWithEmailAndPassword(auth, email, password)).user.uid;
} catch (e) {
  if (e.code !== "auth/email-already-in-use") throw e;
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  uid = (await signInWithEmailAndPassword(auth, email, password)).user.uid;
}
async function put(path, fields) {
  const response = await fetch(
    `http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/${path}`,
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    },
  );
  if (!response.ok) throw Error(`Seed failed: ${response.status}`);
}
await put(`users/${uid}`, {
  enabled: { booleanValue: true },
  roleIds: { arrayValue: { values: [{ stringValue: "member" }] } },
});
for (let i = 1; i <= 6; i++)
  await put(`memberProfiles/fake-${i}`, {
    displayName: { stringValue: `Nhân vật giả ${i}` },
    normalizedName: { stringValue: `nhan vat gia ${i}` },
    profileVersion: { integerValue: "1" },
    schemaVersion: { integerValue: "1" },
  });
console.log(
  "Seed emulator hoàn tất. Tài khoản giả: " + email + " / " + password,
);
process.exit(0);
