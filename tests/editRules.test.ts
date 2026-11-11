// Kiểm tra rules + lô ghi của applyEdit trên emulator Firestore (dữ liệu giả).
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { applyEdit, EditError, type EditState } from "../src/editCore";
import { commitEdit, stageWrites, type SetTarget } from "../src/editClient";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-gia-pha-edit",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
}, 30000);
afterAll(async () => {
  await env?.cleanup();
});

const tree = {
  v: 1,
  persons: {
    a: ["Nguyễn Văn A", 1900, 1970, 1, "C", "c1", ["VERIFY"]],
    b: ["Nguyễn Văn B", null, null, 2, "C", null, []],
  },
  relations: [["a", "b", "F", "B", 1]],
  unions: [],
  branches: { c1: ["Chi 1", "a", null, null] },
};
const profile = {
  displayName: "Nguyễn Văn A",
  normalizedName: "nguyen van a",
  profileVersion: 1,
  schemaVersion: 1,
  birthYear: 1900,
  deathYear: 1970,
};
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const [uid, extra] of [
      ["admin", { canManageMembership: true }],
      ["member", {}],
    ] as const)
      await setDoc(doc(db, "users", uid), {
        enabled: true,
        roleIds: ["member"],
        accessVersion: 1,
        schemaVersion: 1,
        ...extra,
      });
    await setDoc(doc(db, "treeSnapshots", "main"), {
      schemaVersion: 1,
      dataVersion: "fake",
      data: JSON.stringify(tree),
    });
    for (const id of ["a", "b"]) {
      await setDoc(doc(db, "persons", id), {
        displayName: id,
        sex: "M",
        profileVersion: 1,
      });
      await setDoc(doc(db, "memberProfiles", id), { ...profile });
    }
    await setDoc(doc(db, "personPrivate", "a"), { note: "ghi chú giả" });
  });
});

async function snapshotState(db: Firestore, id = "a"): Promise<EditState> {
  const get = async (col: string) => {
    const s = await getDoc(doc(db, col, id));
    return s.exists() ? s.data() : null;
  };
  const snap = await getDoc(doc(db, "treeSnapshots", "main"));
  return {
    snapshot: snap.data()!,
    person: await get("persons"),
    profile: await get("memberProfiles"),
    priv: await get("personPrivate"),
  };
}
async function plan(
  db: Firestore,
  changes: object,
  expectedVersion = 0,
  id = "a",
) {
  return applyEdit(await snapshotState(db, id), {
    op: { type: "updatePerson", personId: id, changes },
    expectedVersion,
    actorUid: "admin",
  });
}
async function commit(
  db: Firestore,
  writes: Awaited<ReturnType<typeof plan>>["writes"],
) {
  const batch = writeBatch(db);
  stageWrites(db, batch as unknown as SetTarget, writes);
  return batch.commit();
}
const admin = () =>
  env.authenticatedContext("admin").firestore() as unknown as Firestore;

describe("ghi trực tiếp trong app: rules", () => {
  it("admin ghi lô hợp lệ thành công và phiên bản tăng một", async () => {
    const db = admin();
    const r = await plan(db, {
      name: "Nguyễn Văn An",
      note: "mới",
      removeFlags: ["VERIFY"],
    });
    await assertSucceeds(commit(db, r.writes));
    const snap = await getDoc(doc(db, "treeSnapshots", "main"));
    expect(snap.data()!.editVersion).toBe(1);
    expect(snap.data()!.dataVersion).toBe("fake");
    expect((await getDoc(doc(db, "persons", "a"))).data()!.displayName).toBe(
      "Nguyễn Văn An",
    );
    expect((await getDoc(doc(db, "auditLogs", "edit-1"))).data()).toMatchObject(
      { target: "persons/a", actorUid: "admin" },
    );
  });

  it("thành viên thường không ghi được cùng lô đó, và không đọc được nhật ký", async () => {
    const r = await plan(admin(), { name: "Tên khác" });
    const member = env
      .authenticatedContext("member")
      .firestore() as unknown as Firestore;
    await assertFails(commit(member, r.writes));
    await assertFails(getDoc(doc(member, "auditLogs", "edit-1")));
    await assertFails(getDoc(doc(member, "persons", "a")));
    await assertFails(getDoc(doc(member, "personPrivate", "a")));
    const anon = env
      .unauthenticatedContext()
      .firestore() as unknown as Firestore;
    await assertFails(commit(anon, r.writes));
  });

  it("admin đọc được persons, personPrivate; ghi một phần của lô thì bị chặn", async () => {
    const db = admin();
    await assertSucceeds(getDoc(doc(db, "persons", "a")));
    await assertSucceeds(getDoc(doc(db, "personPrivate", "a")));
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "auditLogs", "other-event"), {
        event: "INVITATION_CREATED",
      });
      await setDoc(doc(c.firestore(), "auditLogs", "edit-9"), {
        event: "PERSON_EDITED",
      });
    });
    await assertFails(getDoc(doc(db, "auditLogs", "other-event")));
    await assertSucceeds(getDoc(doc(db, "auditLogs", "edit-9")));
    await assertFails(getDocs(collection(db, "auditLogs")));
    const r = await plan(db, { name: "Tên khác" });
    // Thiếu nhật ký hoặc thiếu ảnh chụp thì cả lô bị chặn.
    for (const skip of ["auditLogs/edit-1", "treeSnapshots/main"])
      await assertFails(
        commit(
          db,
          r.writes.filter((w) => w.path !== skip),
        ),
      );
    await assertFails(
      setDoc(doc(db, "persons", "a"), {
        displayName: "Lén",
        profileVersion: 2,
      }),
    );
  });

  it("nhật ký sai mục tiêu, sai người thực hiện hoặc nhảy phiên bản đều bị chặn", async () => {
    const db = admin();
    const r = await plan(db, { name: "Tên khác" });
    const tweak = (fn: (d: Record<string, unknown>) => void) =>
      r.writes.map((w) => {
        if (!w.path.startsWith("auditLogs/")) return w;
        const data = { ...w.data };
        fn(data);
        return { ...w, data };
      });
    await assertFails(
      commit(
        db,
        tweak((d) => (d.target = "persons/b")),
      ),
    );
    await assertFails(
      commit(
        db,
        tweak((d) => (d.actorUid = "someone")),
      ),
    );
    await assertFails(
      commit(
        db,
        tweak((d) => (d.event = "OTHER")),
      ),
    );
    const skip = r.writes.map((w) =>
      w.path === "treeSnapshots/main"
        ? { ...w, data: { ...w.data, editVersion: 2 } }
        : w,
    );
    await assertFails(commit(db, skip));
  });

  it("ghi lại cùng phiên bản (cạnh tranh/phát lại) bị chặn vì nhật ký đã tồn tại", async () => {
    const db = admin();
    const first = await plan(db, { name: "Lần một" });
    const stale = await plan(db, { name: "Lần hai" }); // cùng phiên bản gốc 0
    await assertSucceeds(commit(db, first.writes));
    await assertFails(commit(db, stale.writes));
    expect((await getDoc(doc(db, "persons", "a"))).data()!.displayName).toBe(
      "Lần một",
    );
  });

  it("không sửa/xóa nhật ký, không xóa hay tạo mới persons, không đổi trường ngoài data/editVersion", async () => {
    const db = admin();
    await assertSucceeds(
      commit(db, (await plan(db, { name: "Tên mới" })).writes),
    );
    await assertFails(
      updateDoc(doc(db, "auditLogs", "edit-1"), { event: "PERSON_EDITED" }),
    );
    await assertFails(deleteDoc(doc(db, "auditLogs", "edit-1")));
    await assertFails(deleteDoc(doc(db, "persons", "a")));
    await assertFails(deleteDoc(doc(db, "treeSnapshots", "main")));
    await assertFails(
      setDoc(doc(db, "persons", "newbie"), { profileVersion: 1 }),
    );
    const b = writeBatch(db);
    b.update(doc(db, "treeSnapshots", "main"), {
      dataVersion: "hack",
      editVersion: 2,
    });
    b.set(doc(db, "auditLogs", "edit-2"), {
      event: "PERSON_EDITED",
      actorUid: "admin",
      target: "persons/a",
      editVersion: 2,
    });
    await assertFails(b.commit());
  });

  it("lô thiếu persons/memberProfiles (chỉ snapshot + nhật ký) bị chặn, kể cả sửa quan hệ lén", async () => {
    const db = admin();
    const r = await plan(db, { name: "Tên khác" });
    for (const skip of ["persons/a", "memberProfiles/a"])
      await assertFails(
        commit(
          db,
          r.writes.filter((w) => w.path !== skip),
        ),
      );
    // Chỉ persons + memberProfiles + nhật ký, thiếu snapshot.
    await assertFails(
      commit(
        db,
        r.writes.filter((w) => w.path !== "treeSnapshots/main"),
      ),
    );
  });

  it("không ghi được trường ngoài allowlist hay sai kiểu", async () => {
    const db = admin();
    const r = await plan(db, { name: "Tên khác" });
    const mutate = (path: string, fn: (d: Record<string, unknown>) => void) =>
      r.writes.map((w) => {
        if (w.path !== path) return w;
        const data = { ...w.data };
        fn(data);
        return { ...w, data };
      });
    await assertFails(
      commit(
        db,
        mutate("memberProfiles/a", (d) => (d.note = "riêng tư")),
      ),
    );
    await assertFails(
      commit(
        db,
        mutate("memberProfiles/a", (d) => (d.sex = "F")),
      ),
    );
    await assertFails(
      commit(
        db,
        mutate("memberProfiles/a", (d) => (d.birthYear = "1900")),
      ),
    );
    await assertFails(
      commit(
        db,
        mutate("persons/a", (d) => (d.category = "EXTERNAL")),
      ),
    );
    await assertFails(
      commit(
        db,
        mutate("persons/a", (d) => (d.updatedBy = "someone")),
      ),
    );
    await assertFails(
      commit(
        db,
        mutate("treeSnapshots/main", (d) => (d.data = { not: "string" })),
      ),
    );
    await assertFails(
      commit(
        db,
        mutate("treeSnapshots/main", (d) => (d.data = "x".repeat(900001))),
      ),
    );
    await assertFails(
      commit(
        db,
        mutate("auditLogs/edit-1", (d) => (d.extra = "lạ")),
      ),
    );
    await assertFails(
      commit(
        db,
        mutate("auditLogs/edit-1", (d) => (d.timestamp = new Date(2020, 1, 1))),
      ),
    );
  });

  it("personPrivate: khóa lạ bị chặn; nhật ký của người khác không dùng được cho persons/memberProfiles", async () => {
    const db = admin();
    const r = await plan(db, { note: "mới" });
    const withPrivate = (extra: Record<string, unknown>) =>
      r.writes.map((w) =>
        w.path === "personPrivate/a"
          ? { ...w, data: { ...w.data, ...extra } }
          : w,
      );
    await assertFails(commit(db, withPrivate({ other: 1 })));
    await assertFails(commit(db, withPrivate({ note: "x".repeat(2001) })));
    // Nhật ký trỏ người b nhưng lô ghi persons/memberProfiles của a.
    const wrongPerson = r.writes.map((w) =>
      w.path.startsWith("auditLogs/")
        ? {
            ...w,
            data: { ...w.data, personId: "b", target: "persons/b" },
          }
        : w,
    );
    await assertFails(commit(db, wrongPerson));
    await assertSucceeds(commit(db, r.writes));
  });

  it("kiểu dữ liệu: editVersion không phải int, sex lạ, reviewFlags sai kiểu bị chặn", async () => {
    const db = admin();
    const r = await plan(db, { name: "Tên khác" });
    const mutate = (path: string, extra: Record<string, unknown>) =>
      r.writes.map((w) =>
        w.path === path ? { ...w, data: { ...w.data, ...extra } } : w,
      );
    await assertFails(commit(db, mutate("persons/a", { sex: "X" })));
    await assertFails(commit(db, mutate("persons/a", { reviewFlags: "abc" })));
    await assertFails(commit(db, mutate("auditLogs/edit-1", { fields: "x" })));
    await assertFails(commit(db, mutate("auditLogs/edit-1", { before: [1] })));
    await assertFails(
      commit(db, mutate("memberProfiles/a", { birthYear: 3000 })),
    );
  });

  it("manager bị khóa (enabled=false) không ghi được", async () => {
    const r = await plan(admin(), { name: "Tên khác" });
    await env.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), "users", "admin"), { enabled: false });
    });
    await assertFails(commit(admin(), r.writes));
  });

  it("profileVersion phải tăng đúng một ở persons và memberProfiles", async () => {
    const db = admin();
    const r = await plan(db, { name: "Tên mới" });
    for (const path of ["persons/a", "memberProfiles/a"]) {
      const bad = r.writes.map((w) =>
        w.path === path ? { ...w, data: { ...w.data, profileVersion: 7 } } : w,
      );
      await assertFails(commit(db, bad));
    }
  });

  it("commitEdit chạy trọn vòng; xung đột phiên bản bị chặn ở lõi", async () => {
    const db = admin();
    const res = await commitEdit(db, {
      op: {
        type: "updatePerson",
        personId: "a",
        changes: { birthYear: 1901 },
      },
      expectedVersion: 0,
      actorUid: "admin",
    });
    expect(res.nextVersion).toBe(1);
    await expect(
      commitEdit(db, {
        op: { type: "updatePerson", personId: "a", changes: { name: "X" } },
        expectedVersion: 0,
        actorUid: "admin",
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      commitEdit(db, {
        op: { type: "updatePerson", personId: "a", changes: { name: "X" } },
        expectedVersion: 1,
        actorUid: "member-spoof",
      }),
    ).rejects.not.toBeInstanceOf(EditError);
    const profileDoc = (await getDoc(doc(db, "memberProfiles", "a"))).data()!;
    expect(profileDoc.birthYear).toBe(1901);
    expect(profileDoc.profileVersion).toBe(2);
  });
});
