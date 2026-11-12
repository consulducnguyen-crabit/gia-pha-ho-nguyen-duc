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
import { addTargets, applyAdd, type AddOp } from "../src/editAdd";
import { SERVER_TIME } from "../src/editCore";
import {
  applyDelete,
  deleteReads,
  parseDeletedAudit,
  type DeleteOp,
} from "../src/editDelete";
import {
  applyRelation,
  relationReads,
  type RelationOp,
} from "../src/editRelation";

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
    c: ["Nguyễn Văn C", null, null, 2, "C", null, []],
    m: ["Mẹ M", null, null, null, "S", null, []],
  },
  relations: [
    ["a", "b", "F", "B", 1],
    ["a", "c", "F", "B", 1],
  ],
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
    for (const id of ["a", "b", "c", "m"]) {
      await setDoc(doc(db, "persons", id), {
        displayName: id,
        normalizedName: id,
        sex: id === "m" ? "F" : "M",
        category: id === "m" ? "SPOUSE" : "CLAN",
        profileVersion: 1,
      });
      await setDoc(doc(db, "memberProfiles", id), { ...profile });
    }
    for (const child of ["b", "c"])
      await setDoc(doc(db, "relations", `r-a-${child}`), {
        parentId: "a",
        childId: child,
        parentRole: "FATHER",
        relationType: "BIOLOGICAL",
        lineageTransmission: true,
        verificationStatus: "APPROVED",
        version: 1,
        schemaVersion: 1,
      });
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

async function planAdd(db: Firestore, op: AddOp, expectedVersion = 0) {
  const docs: Record<string, Record<string, unknown> | null> = {};
  for (const id of addTargets(op)) {
    const d = await getDoc(doc(db, "persons", id));
    docs[id] = d.exists() ? d.data() : null;
  }
  const snap = await getDoc(doc(db, "treeSnapshots", "main"));
  return applyAdd(
    { snapshot: snap.data()!, docs },
    { op, expectedVersion, actorUid: "admin" },
  );
}
const newChild = (
  over: Partial<Extract<AddOp, { type: "addChild" }>> = {},
): AddOp => ({
  type: "addChild",
  newId: "p-newkid",
  fatherId: "a",
  motherId: null,
  adoptive: false,
  category: "CLAN",
  branch: "c1",
  child: {
    name: "Giả Con",
    sex: "M",
    birthYear: 1960,
    deathYear: null,
    note: "ghi chú con",
  },
  ...over,
});
const newSpouse = (): AddOp => ({
  type: "addSpouse",
  personId: "b",
  order: "1",
  spouse: {
    kind: "new",
    newId: "p-newspouse",
    category: "SPOUSE",
    person: {
      name: "Vợ Giả",
      sex: "F",
      birthYear: null,
      deathYear: null,
      note: "",
    },
  },
});
type Writes = Awaited<ReturnType<typeof planAdd>>["writes"];
const without = (w: Writes, ...paths: string[]) =>
  w.filter((x) => !paths.includes(x.path));
const tweakWrite = (
  w: Writes,
  path: string,
  extra: Record<string, unknown>,
): Writes =>
  w.map((x) => (x.path === path ? { ...x, data: { ...x.data, ...extra } } : x));

describe("thêm con / vợ chồng: rules", () => {
  it("admin thêm con hợp lệ: tạo người, quan hệ, snapshot, nhật ký", async () => {
    const db = admin();
    const r = await planAdd(db, newChild());
    await assertSucceeds(commit(db, r.writes));
    expect((await getDoc(doc(db, "persons", "p-newkid"))).exists()).toBe(true);
    expect((await getDoc(doc(db, "memberProfiles", "p-newkid"))).exists()).toBe(
      true,
    );
    expect(
      (await getDoc(doc(db, "personPrivate", "p-newkid"))).data()!.note,
    ).toBe("ghi chú con");
    const snap = (await getDoc(doc(db, "treeSnapshots", "main"))).data()!;
    expect(snap.editVersion).toBe(1);
    expect(snap.data).toContain("p-newkid");
    expect((await getDoc(doc(db, "auditLogs", "edit-1"))).data()!.event).toBe(
      "PERSON_ADDED",
    );
  });

  it("thành viên thường không thêm được", async () => {
    const r = await planAdd(admin(), newChild());
    const member = env
      .authenticatedContext("member")
      .firestore() as unknown as Firestore;
    await assertFails(commit(member, r.writes));
  });

  it("thiếu một phần của lô thì bị chặn (snapshot, nhật ký, quan hệ, người)", async () => {
    const db = admin();
    const r = await planAdd(db, newChild());
    for (const skip of [
      "treeSnapshots/main",
      "auditLogs/edit-1",
      "relations/r-a-p-newkid",
      "persons/p-newkid",
    ])
      await assertFails(commit(db, without(r.writes, skip)));
  });

  it("snapshot không thể 'thêm' người đã tồn tại hoặc dùng quan hệ có sẵn", async () => {
    const db = admin();
    const r = await planAdd(db, newChild());
    // Nhật ký PERSON_ADDED trỏ vào người đã có (b) cùng quan hệ có sẵn: chỉ snapshot + nhật ký.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "relations", "r-a-b"), { x: 1 });
    });
    const lie = r.writes
      .filter(
        (w) =>
          w.path === "treeSnapshots/main" || w.path.startsWith("auditLogs/"),
      )
      .map((w) =>
        w.path.startsWith("auditLogs/")
          ? {
              ...w,
              data: {
                ...w.data,
                personId: "b",
                target: "persons/b",
                createdPersonIds: ["b"],
                relationIds: ["r-a-b"],
              },
            }
          : w,
      );
    await assertFails(commit(db, lie));
  });

  it("trường lạ, sai người, sai nguồn trong tài liệu mới bị chặn", async () => {
    const db = admin();
    const r = await planAdd(db, newChild());
    await assertFails(
      commit(db, tweakWrite(r.writes, "persons/p-newkid", { role: "admin" })),
    );
    await assertFails(
      commit(
        db,
        tweakWrite(r.writes, "persons/p-newkid", { category: "ADMIN" }),
      ),
    );
    await assertFails(
      commit(
        db,
        tweakWrite(r.writes, "persons/p-newkid", { profileVersion: 5 }),
      ),
    );
    await assertFails(
      commit(
        db,
        tweakWrite(r.writes, "memberProfiles/p-newkid", { note: "lộ" }),
      ),
    );
    await assertFails(
      commit(
        db,
        tweakWrite(r.writes, "relations/r-a-p-newkid", { childId: "b" }),
      ),
    );
    await assertFails(
      commit(
        db,
        tweakWrite(r.writes, "relations/r-a-p-newkid", { parentRole: "BOSS" }),
      ),
    );
    await assertFails(
      commit(db, tweakWrite(r.writes, "relations/r-a-p-newkid", { extra: 1 })),
    );
    await assertFails(
      commit(
        db,
        tweakWrite(r.writes, "relations/r-a-p-newkid", { sourceRefs: ["x"] }),
      ),
    );
    // Tạo thêm một người không có trong nhật ký.
    await assertFails(
      commit(db, [...r.writes, { ...r.writes[0], path: "persons/p-intruder" }]),
    );
  });

  it("phát lại cùng phiên bản bị chặn", async () => {
    const db = admin();
    const first = await planAdd(db, newChild());
    const second = await planAdd(db, newChild({ newId: "p-other" }));
    await assertSucceeds(commit(db, first.writes));
    await assertFails(commit(db, second.writes));
  });

  it("thêm vợ/chồng mới: người, union, snapshot, nhật ký", async () => {
    const db = admin();
    const r = await planAdd(db, newSpouse());
    await assertSucceeds(commit(db, r.writes));
    expect((await getDoc(doc(db, "persons", "p-newspouse"))).exists()).toBe(
      true,
    );
    const snap = (await getDoc(doc(db, "treeSnapshots", "main"))).data()!;
    expect(snap.data).toContain("p-newspouse");
    expect((await getDoc(doc(db, "auditLogs", "edit-1"))).data()!.event).toBe(
      "SPOUSE_ADDED",
    );
  });

  it("mã người chứa ký tự regex không vượt được kiểm tra quan hệ của snapshot", async () => {
    const db = admin();
    const r = await planAdd(db, newChild());
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "relations", "r-a-b"), {
        childId: "b",
      });
    });
    const person = r.writes.find((w) => w.path === "persons/p-newkid")!;
    const snapshot = r.writes.find((w) => w.path === "treeSnapshots/main")!;
    const audit = r.writes.find((w) => w.path.startsWith("auditLogs/"))!;
    const id = "x|.*";
    await assertFails(
      commit(db, [
        { ...person, path: `persons/${id}` },
        snapshot,
        {
          ...audit,
          data: {
            ...audit.data,
            personId: id,
            target: `persons/${id}`,
            createdPersonIds: [id],
            relationIds: ["r-a-b"],
          },
        },
      ]),
    );
  });

  it("SPOUSE_ADDED không ghi đè hồ sơ riêng của người đã có", async () => {
    const db = admin();
    const r = await planAdd(db, {
      type: "addSpouse",
      personId: "b",
      order: null,
      spouse: { kind: "existing", id: "a" },
    });
    await assertSucceeds(commit(db, r.writes));
    await env.clearFirestore();
    // Thiết lập lại dữ liệu nền rồi thử đường tấn công.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users", "admin"), {
        enabled: true,
        roleIds: ["member"],
        canManageMembership: true,
        accessVersion: 1,
        schemaVersion: 1,
      });
      await setDoc(doc(c.firestore(), "treeSnapshots", "main"), {
        schemaVersion: 1,
        dataVersion: "fake",
        data: JSON.stringify(tree),
      });
      for (const id of ["a", "b"]) {
        await setDoc(doc(c.firestore(), "persons", id), {
          displayName: id,
          sex: "M",
          profileVersion: 1,
        });
        await setDoc(doc(c.firestore(), "memberProfiles", id), { ...profile });
      }
      await setDoc(doc(c.firestore(), "personPrivate", "a"), { note: "cũ" });
    });
    const again = await planAdd(db, {
      type: "addSpouse",
      personId: "b",
      order: null,
      spouse: { kind: "existing", id: "a" },
    });
    const evil = [
      ...again.writes.map((w) =>
        w.path.startsWith("auditLogs/")
          ? { ...w, data: { ...w.data, createdPersonIds: ["a"] } }
          : w,
      ),
      {
        path: "personPrivate/a",
        mode: "set" as const,
        data: { note: "ghi đè", schemaVersion: 1 },
      },
    ];
    await assertFails(commit(db, evil));
    expect((await getDoc(doc(db, "personPrivate", "a"))).data()!.note).toBe(
      "cũ",
    );
  });

  it("union phải đúng cặp, đúng id, hai người khác nhau và đã tồn tại", async () => {
    const db = admin();
    const r = await planAdd(db, {
      type: "addSpouse",
      personId: "b",
      order: null,
      spouse: { kind: "existing", id: "a" },
    });
    const setUnion = (extra: Record<string, unknown>) =>
      tweakWrite(r.writes, "unions/u-a-b", extra);
    await assertFails(commit(db, setUnion({ partnerIds: ["b", "b"] })));
    await assertFails(commit(db, setUnion({ partnerIds: ["b", "ghost"] })));
    const renamed = r.writes.map((w) =>
      w.path === "unions/u-a-b"
        ? { ...w, path: "unions/u-zzz" }
        : w.path.startsWith("auditLogs/")
          ? { ...w, data: { ...w.data, unionId: "u-zzz" } }
          : w,
    );
    await assertFails(commit(db, renamed));
    await assertSucceeds(commit(db, r.writes));
  });

  it("lineageTransmission phải đúng chính sách (cha + con dòng họ)", async () => {
    const db = admin();
    const r = await planAdd(db, newChild());
    await assertFails(
      commit(
        db,
        tweakWrite(r.writes, "relations/r-a-p-newkid", {
          lineageTransmission: false,
        }),
      ),
    );
    await assertFails(
      commit(
        db,
        tweakWrite(r.writes, "relations/r-a-p-newkid", {
          parentRole: "MOTHER",
          lineageTransmission: true,
        }),
      ),
    );
    await assertFails(
      commit(db, tweakWrite(r.writes, "persons/p-newkid", { generation: "3" })),
    );
    await assertSucceeds(commit(db, r.writes));
  });

  it("union có sẵn không bị ghi đè; thiếu union hoặc nhật ký thì bị chặn", async () => {
    const db = admin();
    const r = await planAdd(db, newSpouse());
    await assertFails(commit(db, without(r.writes, "unions/u-b-p-newspouse")));
    await assertFails(commit(db, without(r.writes, "auditLogs/edit-1")));
    await assertFails(
      commit(db, tweakWrite(r.writes, "unions/u-b-p-newspouse", { extra: 1 })),
    );
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "unions", "u-b-p-newspouse"), { old: 1 });
    });
    await assertFails(commit(db, r.writes));
  });
});

async function planRel(db: Firestore, op: RelationOp, expectedVersion = 0) {
  const snap = await getDoc(doc(db, "treeSnapshots", "main"));
  const reads = relationReads(snap.data()!, op);
  const docs: Record<string, Record<string, unknown> | null> = {};
  for (const id of reads.persons) {
    const d = await getDoc(doc(db, "persons", id));
    docs[id] = d.exists() ? d.data() : null;
  }
  const relations: Record<string, Record<string, unknown> | null> = {};
  for (const id of reads.relations) {
    const d = await getDoc(doc(db, "relations", id));
    relations[id] = d.exists() ? d.data() : null;
  }
  return applyRelation(
    { snapshot: snap.data()!, docs, relations },
    { op, expectedVersion, actorUid: "admin" },
  );
}
const replaceFather = (): RelationOp => ({
  type: "setParent",
  childId: "b",
  role: "FATHER",
  parentId: "c",
  adoptive: false,
  confirmReplace: true,
});
const addMother = (): RelationOp => ({
  type: "setParent",
  childId: "b",
  role: "MOTHER",
  parentId: "m",
  adoptive: false,
  confirmReplace: false,
});
const typeOp = (): RelationOp => ({
  type: "setRelationType",
  parentId: "a",
  childId: "b",
  adoptive: true,
});

describe("đổi cha/mẹ và loại con: rules", () => {
  it("thêm mẹ; thay cha (ẩn quan hệ cũ); đổi loại con nuôi: thành công", async () => {
    const db = admin();
    await assertSucceeds(commit(db, (await planRel(db, addMother())).writes));
    expect((await getDoc(doc(db, "relations", "r-m-b"))).exists()).toBe(true);
    await assertSucceeds(
      commit(db, (await planRel(db, replaceFather(), 1)).writes),
    );
    const old = (await getDoc(doc(db, "relations", "r-a-b"))).data()!;
    expect(old.deleted).toBe(true);
    expect(old.replacedBy).toBe("r-c-b");
    expect((await getDoc(doc(db, "relations", "r-c-b"))).exists()).toBe(true);
    await assertSucceeds(
      commit(
        db,
        (
          await planRel(
            db,
            {
              type: "setRelationType",
              parentId: "c",
              childId: "b",
              adoptive: true,
            },
            2,
          )
        ).writes,
      ),
    );
    expect(
      (await getDoc(doc(db, "relations", "r-c-b"))).data()!.relationType,
    ).toBe("ADOPTIVE");
    expect(
      (await getDoc(doc(db, "treeSnapshots", "main"))).data()!.editVersion,
    ).toBe(3);
  });

  it("thành viên thường không đổi được; thiếu phần nào của lô thì bị chặn", async () => {
    const db = admin();
    const r = await planRel(db, replaceFather());
    const member = env
      .authenticatedContext("member")
      .firestore() as unknown as Firestore;
    await assertFails(commit(member, r.writes));
    for (const skip of [
      "relations/r-a-b",
      "relations/r-c-b",
      "treeSnapshots/main",
      "auditLogs/edit-1",
    ])
      await assertFails(commit(db, without(r.writes, skip)));
    const t = await planRel(db, typeOp());
    await assertFails(commit(db, without(t.writes, "relations/r-a-b")));
  });

  it("không ẩn quan hệ của người khác, không thêm trường lạ, không xóa cứng", async () => {
    const db = admin();
    const r = await planRel(db, replaceFather());
    // Nhật ký nói ẩn quan hệ của c nhưng lô ẩn quan hệ của b.
    await assertFails(
      commit(
        db,
        r.writes.map((w) =>
          w.path.startsWith("auditLogs/")
            ? { ...w, data: { ...w.data, removedRelationIds: ["r-a-c"] } }
            : w,
        ),
      ),
    );
    await assertFails(
      commit(db, tweakWrite(r.writes, "relations/r-a-b", { parentId: "c" })),
    );
    await assertFails(
      commit(db, tweakWrite(r.writes, "relations/r-a-b", { deleted: false })),
    );
    await assertFails(
      commit(db, tweakWrite(r.writes, "relations/r-a-b", { version: 9 })),
    );
    await assertFails(
      commit(
        db,
        tweakWrite(r.writes, "relations/r-c-b", { lineageTransmission: false }),
      ),
    );
    await assertFails(deleteDoc(doc(db, "relations", "r-a-b")));
    const t = await planRel(db, typeOp());
    await assertFails(
      commit(db, tweakWrite(t.writes, "relations/r-a-b", { parentId: "c" })),
    );
    await assertFails(
      commit(
        db,
        tweakWrite(t.writes, "relations/r-a-b", { relationType: "OTHER" }),
      ),
    );
  });

  it("không ghi đè dấu vết quan hệ đã ẩn, không sửa quan hệ đã ẩn, không ẩn sai vai trò", async () => {
    const db = admin();
    await assertSucceeds(
      commit(db, (await planRel(db, replaceFather())).writes),
    );
    // 1. Ẩn LẠI quan hệ đã ẩn (r-a-b) trong một lô PARENT_CHANGED khác (thêm mẹ m).
    const mother = await planRel(db, addMother(), 1);
    const hideAgain = [
      ...mother.writes.map((w) =>
        w.path.startsWith("auditLogs/")
          ? { ...w, data: { ...w.data, removedRelationIds: ["r-a-b"] } }
          : w,
      ),
      {
        path: "relations/r-a-b",
        mode: "merge" as const,
        data: {
          deleted: true,
          deletedAt: SERVER_TIME,
          deletedBy: "admin",
          replacedBy: "r-m-b",
          version: 3,
        },
      },
    ];
    await assertFails(commit(db, hideAgain));
    // 2. Đổi loại con trên quan hệ đã ẩn: dùng lô của r-a-c nhưng trỏ sang r-a-b.
    const type = await planRel(
      db,
      { type: "setRelationType", parentId: "a", childId: "c", adoptive: true },
      1,
    );
    const onHidden = type.writes.map((w) =>
      w.path === "relations/r-a-c"
        ? { ...w, path: "relations/r-a-b", data: { ...w.data, version: 3 } }
        : w.path.startsWith("auditLogs/")
          ? {
              ...w,
              data: {
                ...w.data,
                personId: "b",
                target: "persons/b",
                relationIds: ["r-a-b"],
              },
            }
          : w,
    );
    await assertFails(commit(db, onHidden));
    expect(
      (await getDoc(doc(db, "relations", "r-a-b"))).data()!.replacedBy,
    ).toBe("r-c-b");
  });

  it("đặt CHA mới nhưng ẩn quan hệ MẸ bị chặn (vai trò phải khớp)", async () => {
    const db = admin();
    await assertSucceeds(commit(db, (await planRel(db, addMother())).writes));
    const r = await planRel(db, replaceFather(), 1);
    const wrongRole = r.writes.map((w) =>
      w.path === "relations/r-a-b"
        ? {
            ...w,
            path: "relations/r-m-b",
            data: { ...w.data, replacedBy: "r-c-b" },
          }
        : w.path.startsWith("auditLogs/")
          ? { ...w, data: { ...w.data, removedRelationIds: ["r-m-b"] } }
          : w,
    );
    await assertFails(commit(db, wrongRole));
    await assertSucceeds(commit(db, r.writes));
  });

  it("phát lại cùng phiên bản bị chặn; quan hệ không được tạo lại sau khi ẩn", async () => {
    const db = admin();
    const first = await planRel(db, replaceFather());
    const second = await planRel(db, addMother());
    await assertSucceeds(commit(db, first.writes));
    await assertFails(commit(db, second.writes));
  });

  it("thành viên thường không đọc được quan hệ; admin đọc theo mã nhưng không liệt kê", async () => {
    const db = admin();
    await assertSucceeds(getDoc(doc(db, "relations", "r-a-b")));
    await assertFails(getDocs(collection(db, "relations")));
    const member = env
      .authenticatedContext("member")
      .firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(member, "relations", "r-a-b")));
  });
});

async function planDel(db: Firestore, op: DeleteOp, expectedVersion: number) {
  const snap = await getDoc(doc(db, "treeSnapshots", "main"));
  const person = await getDoc(doc(db, "persons", op.personId));
  let audit: Record<string, unknown> | null = null;
  let ids: string[];
  if (op.type === "restorePerson") {
    const a = await getDoc(doc(db, "auditLogs", `edit-${op.deleteVersion}`));
    audit = a.exists() ? a.data() : null;
    ids = parseDeletedAudit(
      audit!,
      op.personId,
      op.deleteVersion,
    ).relations.map((r) => `r-${String(r[0])}-${op.personId}`);
  } else ids = deleteReads(snap.data()!, op.personId);
  const relations: Record<string, Record<string, unknown> | null> = {};
  for (const id of ids) {
    const d = await getDoc(doc(db, "relations", id));
    relations[id] = d.exists() ? d.data() : null;
  }
  return applyDelete(
    {
      snapshot: snap.data()!,
      person: person.exists() ? person.data() : null,
      relations,
      audit,
    },
    { op, expectedVersion, actorUid: "admin" },
  );
}
const delB = (): DeleteOp => ({
  type: "deletePerson",
  personId: "b",
  confirm: true,
});
const restoreB = (v: number): DeleteOp => ({
  type: "restorePerson",
  personId: "b",
  deleteVersion: v,
});

describe("ẩn và khôi phục người: rules", () => {
  it("ẩn rồi khôi phục: thành công, bản thành viên mất rồi có lại", async () => {
    const db = admin();
    await assertSucceeds(commit(db, (await planDel(db, delB(), 0)).writes));
    expect((await getDoc(doc(db, "persons", "b"))).data()!.deleted).toBe(true);
    expect((await getDoc(doc(db, "memberProfiles", "b"))).exists()).toBe(false);
    expect((await getDoc(doc(db, "relations", "r-a-b"))).data()!.deleted).toBe(
      true,
    );
    await assertSucceeds(
      commit(db, (await planDel(db, restoreB(1), 1)).writes),
    );
    expect((await getDoc(doc(db, "persons", "b"))).data()!.deleted).toBe(false);
    expect((await getDoc(doc(db, "memberProfiles", "b"))).exists()).toBe(true);
    expect((await getDoc(doc(db, "relations", "r-a-b"))).data()!.deleted).toBe(
      false,
    );
    const snap = JSON.parse(
      (await getDoc(doc(db, "treeSnapshots", "main"))).data()!.data,
    );
    expect(snap.persons.b).toBeDefined();
  });

  it("thành viên thường không ẩn được; thiếu phần nào của lô thì bị chặn", async () => {
    const db = admin();
    const r = await planDel(db, delB(), 0);
    const member = env
      .authenticatedContext("member")
      .firestore() as unknown as Firestore;
    await assertFails(commit(member, r.writes));
    for (const skip of [
      "persons/b",
      "memberProfiles/b",
      "relations/r-a-b",
      "treeSnapshots/main",
      "auditLogs/edit-1",
    ])
      await assertFails(commit(db, without(r.writes, skip)));
  });

  it("không ẩn quan hệ của người khác, không thêm trường lạ, không đổi nhãn sự kiện", async () => {
    const db = admin();
    const r = await planDel(db, delB(), 0);
    await assertFails(
      commit(db, tweakWrite(r.writes, "persons/b", { displayName: "X" })),
    );
    await assertFails(
      commit(db, tweakWrite(r.writes, "relations/r-a-b", { parentId: "c" })),
    );
    await assertFails(
      commit(db, tweakWrite(r.writes, "persons/b", { deletedAtVersion: 9 })),
    );
    await assertFails(
      commit(
        db,
        r.writes.map((w) =>
          w.path.startsWith("auditLogs/")
            ? { ...w, data: { ...w.data, relationIds: ["r-a-c"] } }
            : w,
        ),
      ),
    );
    await assertFails(
      commit(
        db,
        r.writes.map((w) =>
          w.path.startsWith("auditLogs/")
            ? { ...w, data: { ...w.data, event: "PERSON_EDITED" } }
            : w,
        ),
      ),
    );
    await assertSucceeds(commit(db, r.writes));
  });

  it("người đã ẩn không sửa được và không làm cha/mẹ; lô ẩn không phát lại được", async () => {
    const db = admin();
    const edit = applyEdit(await snapshotState(db, "b"), {
      op: {
        type: "updatePerson",
        personId: "b",
        changes: { name: "Tên Mới" },
      },
      expectedVersion: 0,
      actorUid: "admin",
    });
    const first = await planDel(db, delB(), 0);
    await assertSucceeds(commit(db, first.writes));
    // Lô sửa hợp lệ về hình thức nhưng nhắm người đã ẩn (đổi sang phiên bản 2).
    const bumped = edit.writes.map((w) =>
      w.path === "auditLogs/edit-1"
        ? {
            ...w,
            path: "auditLogs/edit-2",
            data: { ...w.data, editVersion: 2 },
          }
        : w.path === "treeSnapshots/main"
          ? { ...w, data: { ...w.data, editVersion: 2 } }
          : w,
    );
    await assertFails(commit(db, bumped));
    await assertFails(commit(db, first.writes));
    // Chọn người đã ẩn làm cha: quan hệ mới bị chặn dù lô đúng hình thức.
    const rel = await planRel(
      db,
      {
        type: "setParent",
        childId: "c",
        role: "MOTHER",
        parentId: "m",
        adoptive: false,
        confirmReplace: false,
      },
      1,
    );
    // Khớp đủ mọi điều kiện khác (id, nhật ký, truyền dòng): chỉ còn điều kiện "cha/mẹ chưa bị ẩn".
    const toDeleted = rel.writes.map((w) =>
      w.path === "relations/r-m-c"
        ? {
            ...w,
            path: "relations/r-b-c",
            data: {
              ...w.data,
              parentId: "b",
              parentRole: "FATHER",
              lineageTransmission: true,
            },
          }
        : w.path.startsWith("auditLogs/")
          ? { ...w, data: { ...w.data, relationIds: ["r-b-c"] } }
          : w,
    );
    await assertFails(commit(db, toDeleted));
  });

  it("ẩn và khôi phục vợ/chồng (có union): thành công; nhật ký sai union hoặc union của người khác bị chặn", async () => {
    const db = admin();
    // Clients không đọc được unions; đọc bằng quyền test.
    const readUnion = async () => {
      let data: Record<string, unknown> = {};
      await env.withSecurityRulesDisabled(async (c) => {
        data =
          (
            await getDoc(doc(c.firestore(), "unions", "u-b-p-newspouse"))
          ).data() ?? {};
      });
      return data;
    };
    await assertSucceeds(
      commit(db, (await planAdd(db, newSpouse(), 0)).writes),
    );
    const spouse = (): DeleteOp => ({
      type: "deletePerson",
      personId: "p-newspouse",
      confirm: true,
    });
    const hide = await planDel(db, spouse(), 1);
    await assertFails(
      commit(
        db,
        hide.writes.map((w) =>
          w.path.startsWith("auditLogs/")
            ? { ...w, data: { ...w.data, unionId: "u-a-b" } }
            : w,
        ),
      ),
    );
    await assertFails(
      commit(db, without(hide.writes, "unions/u-b-p-newspouse")),
    );
    await assertSucceeds(commit(db, hide.writes));
    expect((await readUnion()).deleted).toBe(true);
    const restore = await planDel(
      db,
      { type: "restorePerson", personId: "p-newspouse", deleteVersion: 2 },
      2,
    );
    await assertSucceeds(commit(db, restore.writes));
    expect((await readUnion()).deleted).toBe(false);
    expect(
      (await getDoc(doc(db, "memberProfiles", "p-newspouse"))).exists(),
    ).toBe(true);
  });

  // Người b có nhiều vợ/chồng (lịch sử có thật): thêm n vợ/chồng mới cho b, rồi ẩn/khôi phục b.
  async function givenSpouses(db: Firestore, n: number) {
    for (let i = 0; i < n; i++) {
      const op = newSpouse() as Extract<AddOp, { type: "addSpouse" }>;
      const spouse = op.spouse as { newId: string };
      spouse.newId = `p-sp${i}`;
      op.order = String(i + 1);
      await assertSucceeds(commit(db, (await planAdd(db, op, i)).writes));
    }
  }
  const auditOf = (w: Writes) =>
    w.find((x) => x.path.startsWith("auditLogs/"))!;

  it("ẩn rồi khôi phục người có 6 vợ/chồng: thành công (trong giới hạn truy cập của rules)", async () => {
    const db = admin();
    await givenSpouses(db, 6);
    const hide = await planDel(db, delB(), 6);
    const a = auditOf(hide.writes).data;
    expect(a.unionId).toBe("u-b-p-sp0");
    expect(a.moreUnionIds).toHaveLength(5);
    await assertSucceeds(commit(db, hide.writes));
    const restore = await planDel(db, restoreB(7), 7);
    await assertSucceeds(commit(db, restore.writes));
    await env.withSecurityRulesDisabled(async (c) => {
      for (let i = 0; i < 6; i++)
        expect(
          (await getDoc(doc(c.firestore(), "unions", `u-b-p-sp${i}`))).data()!
            .deleted,
        ).toBe(false);
    });
  });

  it("nhật ký liệt kê vợ/chồng nhưng lô không ghi liên kết đó, hoặc liệt kê quá 5 hoặc liên kết lạ: bị chặn", async () => {
    const db = admin();
    await givenSpouses(db, 3);
    const hide = await planDel(db, delB(), 3);
    // Bỏ một liên kết khỏi lô nhưng vẫn liệt kê trong nhật ký.
    await assertFails(commit(db, without(hide.writes, "unions/u-b-p-sp2")));
    await assertFails(commit(db, without(hide.writes, "unions/u-b-p-sp1")));
    const withMore = (more: unknown) =>
      hide.writes.map((w) =>
        w.path.startsWith("auditLogs/")
          ? { ...w, data: { ...w.data, moreUnionIds: more } }
          : w,
      );
    await assertFails(commit(db, withMore(["u-b-p-sp1", "u-khac-lạ"])));
    await assertFails(
      commit(db, withMore(["u-b-p-sp1", "u-b-p-sp2", "a", "b", "c", "d"])),
    );
    await assertFails(commit(db, withMore("u-b-p-sp1")));
    await assertSucceeds(commit(db, hide.writes));
  });

  it("khôi phục bỏ sót một liên kết vợ/chồng đã liệt kê: bị chặn", async () => {
    const db = admin();
    await givenSpouses(db, 3);
    await assertSucceeds(commit(db, (await planDel(db, delB(), 3)).writes));
    const restore = await planDel(db, restoreB(4), 4);
    await assertFails(commit(db, without(restore.writes, "unions/u-b-p-sp2")));
    await assertSucceeds(commit(db, restore.writes));
  });

  it("khôi phục: không dùng được số phiên bản sai, không làm hai lần", async () => {
    const db = admin();
    await assertSucceeds(commit(db, (await planDel(db, delB(), 0)).writes));
    await assertSucceeds(
      commit(db, (await planDel(db, restoreB(1), 1)).writes),
    );
    await expect(planDel(db, restoreB(1), 2)).rejects.toBeInstanceOf(EditError);
  });
});
