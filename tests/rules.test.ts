import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { ref, getBytes, uploadBytes } from "firebase/storage";
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-gia-pha",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
    storage: {
      rules: readFileSync("storage.rules", "utf8"),
      host: "127.0.0.1",
      port: 9199,
    },
  });
  await env.withSecurityRulesDisabled(async (c) => {
    for (const role of ["member", "editor", "approver", "disabled"])
      await setDoc(doc(c.firestore(), "users", role), {
        enabled: role !== "disabled",
        roleIds: [role],
      });
    await setDoc(doc(c.firestore(), "memberProfiles", "fake"), {
      displayName: "Nhân vật giả",
    });
    await setDoc(doc(c.firestore(), "changeRequests", "own"), {
      authorUid: "member",
      status: "DRAFT",
    });
    await setDoc(doc(c.firestore(), "changeRequests", "other"), {
      authorUid: "editor",
      status: "DRAFT",
    });
    for (const name of [
      "persons",
      "personPrivate",
      "relations",
      "unions",
      "generationOverrides",
    ]) {
      await setDoc(doc(c.firestore(), name, "sensitive"), {
        note: "Dữ liệu giả nhạy cảm",
      });
    }
    await uploadBytes(
      ref(c.storage(), "private/persons/fake/image"),
      new Uint8Array([1]),
    );
  });
}, 30000);
afterAll(async () => {
  await env?.cleanup();
});
describe("default-deny access", () => {
  for (const role of ["member", "editor", "approver"])
    it(`${role} cannot read sensitive canonical documents`, async () => {
      const db = env.authenticatedContext(role).firestore();
      for (const name of [
        "persons",
        "personPrivate",
        "relations",
        "unions",
        "generationOverrides",
      ]) {
        await assertFails(getDoc(doc(db, name, "sensitive")));
        await assertFails(getDocs(collection(db, name)));
      }
    });
  for (const role of ["anonymous", "pending", "disabled"])
    it(`${role} cannot read or write genealogy`, async () => {
      const c =
        role === "anonymous"
          ? env.unauthenticatedContext()
          : env.authenticatedContext(role);
      await assertFails(getDoc(doc(c.firestore(), "memberProfiles", "fake")));
      await assertFails(getDocs(collection(c.firestore(), "memberProfiles")));
      await assertFails(setDoc(doc(c.firestore(), "persons", "attack"), {}));
    });
  for (const role of ["member", "editor", "approver"])
    it(`${role} reads but cannot mutate canonical records`, async () => {
      const db = env.authenticatedContext(role).firestore();
      await assertSucceeds(getDoc(doc(db, "memberProfiles", "fake")));
      for (const name of [
        "persons",
        "memberProfiles",
        "personPrivate",
        "relations",
        "branches",
        "users",
        "auditLogs",
        "changeRequests",
      ])
        await assertFails(
          setDoc(doc(db, name, "attack"), {
            enabled: true,
            status: "APPROVED",
            roleIds: ["admin"],
          }),
        );
    });
  it("ignores claimed roles without membership", async () => {
    await assertFails(
      getDoc(
        doc(
          env
            .authenticatedContext("pending", { role: "admin", enabled: true })
            .firestore(),
          "memberProfiles",
          "fake",
        ),
      ),
    );
  });
  it("only allows own account and own filtered proposals", async () => {
    const db = env.authenticatedContext("member").firestore();
    await assertSucceeds(getDoc(doc(db, "users", "member")));
    await assertFails(getDoc(doc(db, "users", "editor")));
    await assertSucceeds(
      getDocs(
        query(
          collection(db, "changeRequests"),
          where("authorUid", "==", "member"),
        ),
      ),
    );
    await assertFails(getDocs(collection(db, "changeRequests")));
    await assertFails(getDoc(doc(db, "changeRequests", "other")));
  });
  for (const role of [
    "anonymous",
    "pending",
    "member",
    "editor",
    "approver",
    "disabled",
  ])
    it(`${role} cannot access media before granular ACL implementation`, async () => {
      const c =
        role === "anonymous"
          ? env.unauthenticatedContext()
          : env.authenticatedContext(role);
      const file = ref(c.storage(), "private/persons/fake/image");
      await assertFails(getBytes(file));
      await assertFails(uploadBytes(file, new Uint8Array([2])));
    });
});
