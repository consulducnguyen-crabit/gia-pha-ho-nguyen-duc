// Fake approval fixtures only, on fixed local emulators.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
)
  throw Error("Set both exact local emulator hosts; production is forbidden.");
const app = initializeApp({ projectId: "demo-gia-pha" });
const auth = getAuth(app),
  db = getFirestore(app);
for (const [uid, email, reviewer] of [
  ["demo-proposer", "nguoidexuat@example.test", false],
  ["demo-reviewer-one", "duyetmot@example.test", true],
  ["demo-reviewer-two", "duyethai@example.test", true],
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
    const current = await auth.getUser(uid);
    if (current.email !== email || !current.emailVerified || current.disabled)
      throw Error("Fake identity changed; use a fresh emulator.");
  }
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`users/${uid}`),
      current = await tx.get(ref);
    if (!current.exists)
      tx.create(ref, {
        enabled: true,
        roleIds: ["member"],
        accessVersion: 1,
        schemaVersion: 1,
        ...(reviewer ? { canReviewChanges: true, canReviewLineage: true } : {}),
      });
    else if (
      current.data().enabled !== true ||
      (reviewer &&
        (current.data().canReviewChanges !== true ||
          current.data().canReviewLineage !== true))
    )
      throw Error(
        "Approval fixture was revoked; use a fresh emulator instead of regranting rights.",
      );
  });
}
for (const [id, displayName, normalizedName] of [
  ["demo-parent", "Người cha giả", "nguoi cha gia"],
  ["demo-child", "Người con giả", "nguoi con gia"],
]) {
  await db.runTransaction(async (tx) => {
    const person = db.doc(`persons/${id}`),
      profile = db.doc(`memberProfiles/${id}`);
    const existing = await tx.get(person),
      publicDoc = await tx.get(profile);
    if (!existing.exists && !publicDoc.exists) {
      const fields = {
        displayName,
        normalizedName,
        profileVersion: 1,
        schemaVersion: 1,
      };
      tx.create(person, fields);
      tx.create(profile, fields);
    } else if (!existing.exists || !publicDoc.exists)
      throw Error("Partial person fixture; use a fresh emulator.");
  });
}
console.log(
  "Fake proposal author, two reviewers and two basic profiles ready. See docs/PROPOSALS.md.",
);
process.exit(0);
