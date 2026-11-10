// Fake identities only. No production project or remote host can be selected.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
)
  throw Error("Set both exact local emulator hosts; production is forbidden.");
const app = initializeApp({ projectId: "demo-gia-pha" });
const auth = getAuth(app);
const db = getFirestore(app);
for (const [uid, email] of [
  ["demo-manager", "quanly@example.test"],
  ["demo-invitee", "duocmoi@example.test"],
]) {
  try {
    await auth.createUser({
      uid,
      email,
      emailVerified: true,
      password: "Demo-only-2026!",
    });
  } catch (error) {
    if (error.code !== "auth/uid-already-exists") throw error;
    const existing = await auth.getUser(uid);
    if (
      existing.email !== email ||
      !existing.emailVerified ||
      existing.disabled
    )
      throw Error("Fake identity differs from fixture; use a fresh emulator.");
  }
}
const manager = db.doc("users/demo-manager");
await db.runTransaction(async (tx) => {
  const existing = await tx.get(manager);
  if (!existing.exists)
    tx.create(manager, {
      enabled: true,
      roleIds: ["member"],
      canManageMembership: true,
      accessVersion: 1,
      schemaVersion: 1,
    });
  else if (
    existing.data().enabled !== true ||
    existing.data().canManageMembership !== true
  )
    throw Error(
      "Manager fixture was revoked; use a fresh emulator instead of granting it again.",
    );
});
console.log(
  "Fake manager and pending invitee ready. See docs/INVITATIONS.md for local demo login.",
);
process.exit(0);
