// Checks only fake fixtures on fixed local demo emulators. Never production.
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, getDocs } from "firebase/firestore";
import { getBytes, ref } from "firebase/storage";

const [mode, file] = process.argv.slice(2);
if (!["--record", "--verify"].includes(mode) || !file?.startsWith("/tmp/"))
  throw Error("Use --record or --verify with a /tmp/ snapshot path.");
const hash = (value) => createHash("sha256").update(value).digest("hex");
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  return value;
}
const env = await initializeTestEnvironment({
  projectId: "demo-gia-pha",
  firestore: { host: "127.0.0.1", port: 8080 },
  storage: { host: "127.0.0.1", port: 9199 },
});
try {
  let snapshot;
  await env.withSecurityRulesDisabled(async (context) => {
    const collections = {};
    for (const path of [
      "users",
      "memberProfiles",
      "persons",
      "personPrivate",
      "relations",
      "unions",
      "branches",
      "generationOverrides",
      "auditLogs",
      "changeRequests",
      "persons/nested-regression/names",
    ]) {
      const result = await getDocs(collection(context.firestore(), path));
      const docs = result.docs
        .map((doc) => [doc.id, doc.data()])
        .sort(([a], [b]) => a.localeCompare(b));
      collections[path] = {
        count: docs.length,
        sha256: hash(JSON.stringify(stable(docs))),
      };
    }
    const result = await getDocs(
      collection(context.firestore(), "memberProfiles"),
    );
    for (let i = 1; i <= 6; i++) {
      assert.equal(
        result.docs.find((doc) => doc.id === `fake-${i}`)?.data().displayName,
        `Nhân vật giả ${i}`,
      );
    }
    const media = await getBytes(
      ref(context.storage(), "private/persons/fake/image"),
    );
    const response = await fetch(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "thanhvien@example.test",
          password: "Demo-only-2026!",
          returnSecureToken: true,
        }),
      },
    );
    assert.equal(response.ok, true, "Restored fake Auth login must succeed");
    const { localId } = await response.json();
    assert.equal(typeof localId, "string");
    snapshot = {
      collections,
      authUid: localId,
      mediaSha256: hash(Buffer.from(media)),
    };
  });
  if (mode === "--record")
    await writeFile(file, JSON.stringify(snapshot, null, 2));
  else assert.deepEqual(snapshot, JSON.parse(await readFile(file, "utf8")));
  console.log(
    `Emulator restore ${mode.slice(2)} passed: collection counts/hashes, six fake profiles, Auth identity/login and media hash.`,
  );
} finally {
  await env.cleanup();
}
