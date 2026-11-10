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
  updateDoc,
  deleteDoc,
  getDocFromServer,
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

describe("membership and mutation regressions", () => {
  for (const role of ["member", "editor", "approver", "disabled"])
    it(`${role} cannot elevate, re-enable or delete their own account`, async () => {
      const account = doc(
        env.authenticatedContext(role).firestore(),
        "users",
        role,
      );
      await assertFails(
        updateDoc(account, { enabled: true, roleIds: ["admin"] }),
      );
      await assertFails(setDoc(account, { enabled: true, roleIds: ["admin"] }));
      await assertFails(deleteDoc(account));
    });

  it("an uninvited account cannot provision its own membership", async () => {
    const db = env
      .authenticatedContext("uninvited-regression", {
        role: "admin",
        enabled: true,
      })
      .firestore();
    await assertFails(
      setDoc(doc(db, "users", "uninvited-regression"), {
        enabled: true,
        roleIds: ["admin"],
      }),
    );
    await assertFails(getDocFromServer(doc(db, "memberProfiles", "fake")));
  });

  for (const role of ["member", "editor", "approver"])
    it(`${role} cannot update or delete existing protected documents`, async () => {
      const names = [
        "persons",
        "personPrivate",
        "relations",
        "unions",
        "branches",
        "generationOverrides",
        "memberProfiles",
        "auditLogs",
        "changeRequests",
      ];
      const id = `mutation-regression-${role}`;
      await env.withSecurityRulesDisabled(async (c) => {
        for (const name of names)
          await setDoc(doc(c.firestore(), name, id), {
            displayName: "Hồ sơ giả kiểm thử",
            authorUid: role,
            status: "DRAFT",
          });
      });
      const db = env.authenticatedContext(role).firestore();
      for (const name of names) {
        await assertFails(
          updateDoc(doc(db, name, id), {
            displayName: "Sửa trái phép",
            status: "APPROVED",
          }),
        );
        await assertFails(deleteDoc(doc(db, name, id)));
      }
    });

  for (const role of ["member", "editor", "approver"])
    it(`${role} cannot bypass canonical privacy through nested names`, async () => {
      const path = "persons/nested-regression/names";
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), path, role), {
          value: "Tên giả nhạy cảm",
        });
      });
      const db = env.authenticatedContext(role).firestore();
      const name = doc(db, path, role);
      await assertFails(getDoc(name));
      await assertFails(getDocs(collection(db, path)));
      await assertFails(
        setDoc(doc(db, path, `new-${role}`), { value: "Tên giả" }),
      );
      await assertFails(updateDoc(name, { value: "Sửa trái phép" }));
      await assertFails(deleteDoc(name));
    });

  it("revoking membership blocks subsequent server reads with the same auth context", async () => {
    const uid = "revocation-regression";
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users", uid), {
        enabled: true,
        roleIds: ["member"],
      });
      await setDoc(doc(c.firestore(), "changeRequests", uid), {
        authorUid: uid,
        status: "DRAFT",
      });
    });
    const db = env.authenticatedContext(uid).firestore();
    const profile = doc(db, "memberProfiles", "fake");
    const proposal = doc(db, "changeRequests", uid);
    await assertSucceeds(getDocFromServer(profile));
    await assertSucceeds(getDocFromServer(proposal));
    await env.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), "users", uid), { enabled: false });
    });
    await assertFails(getDocFromServer(profile));
    await assertFails(getDocFromServer(proposal));
    await assertFails(
      getDocs(
        query(collection(db, "changeRequests"), where("authorUid", "==", uid)),
      ),
    );
  });

  it("a disabled account cannot read even its own proposal", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), "changeRequests", "disabled-regression"),
        {
          authorUid: "disabled",
          status: "DRAFT",
        },
      );
    });
    const db = env.authenticatedContext("disabled").firestore();
    await assertFails(
      getDocFromServer(doc(db, "changeRequests", "disabled-regression")),
    );
    await assertFails(
      getDocs(
        query(
          collection(db, "changeRequests"),
          where("authorUid", "==", "disabled"),
        ),
      ),
    );
  });
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
