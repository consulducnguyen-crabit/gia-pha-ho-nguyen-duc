import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertGraphCanAdd,
  normalizeName,
  objectInput,
  parseOperation,
  positiveRevision,
  requestId,
  requiredApprovals,
  safeId,
  type RelationOperation,
} from "../src/proposalValidation";

const person = {
  kind: "PERSON_BASIC",
  personId: "fake-person",
  baseVersion: 0,
  displayName: " Đặng Ánh ",
  evidence: "Nguồn giả phục vụ kiểm thử",
};
const relation = (
  overrides: Partial<RelationOperation> = {},
): RelationOperation => ({
  kind: "RELATION_CREATE",
  relationId: "fake-relation",
  parentId: "parent",
  childId: "child",
  parentRole: "FATHER",
  relationType: "BIOLOGICAL",
  lineageTransmission: false,
  lineageReason: "",
  evidence: "Nguồn giả đã kiểm tra",
  ...overrides,
});
const edge = (overrides: Record<string, unknown> = {}) => ({
  parentId: "a",
  childId: "b",
  parentRole: "FATHER",
  relationType: "BIOLOGICAL",
  lineageTransmission: false,
  verificationStatus: "APPROVED",
  version: 1,
  schemaVersion: 1,
  ...overrides,
});
const invalid = (fn: () => unknown) =>
  expect(fn).toThrowError(
    expect.objectContaining({ code: "invalid-argument" }),
  );
const conflict = (fn: () => unknown) =>
  expect(fn).toThrowError(
    expect.objectContaining({ code: "failed-precondition" }),
  );

describe("proposal input privacy and identity boundary", () => {
  it("preserves immutable IDs while normalizing only public name text", () => {
    expect(parseOperation(person)).toMatchObject({
      personId: "fake-person",
      displayName: "Đặng Ánh",
    });
    expect(normalizeName(" Đặng Ánh ")).toBe("dang anh");
    expect(requestId(randomUUID())).toHaveLength(36);
  });
  it("does not accept roles, approval status, sensitive fields, or missing evidence", () => {
    for (const extra of [
      { role: "admin" },
      { status: "APPROVED" },
      { privateNote: "fake" },
      { approvedBy: "attacker" },
    ])
      invalid(() => parseOperation({ ...person, ...extra }));
    invalid(() => parseOperation({ ...person, evidence: " " }));
    const missing = { ...person } as Record<string, unknown>;
    delete missing.evidence;
    invalid(() => parseOperation(missing));
  });
  it("rejects inherited payload values and non-object envelopes", () => {
    invalid(() => objectInput(Object.create({ a: 1 }), ["a"]));
    for (const value of [null, [], "fake", 1])
      invalid(() => objectInput(value, []));
  });
  it("rejects paths, invalid IDs, versions, and oversized or control-character text", () => {
    for (const id of ["a/b", "", ".", "x".repeat(129), 12])
      invalid(() => safeId(id));
    for (const version of [null, -1, 1.2, "1", Number.MAX_SAFE_INTEGER]) {
      invalid(() => parseOperation({ ...person, baseVersion: version }));
      invalid(() => positiveRevision(version));
    }
    invalid(() => positiveRevision(0));
    invalid(() => parseOperation({ ...person, displayName: "x".repeat(161) }));
    invalid(() => parseOperation({ ...person, evidence: "x".repeat(1001) }));
    invalid(() => parseOperation({ ...person, displayName: "Fake\u0000Name" }));
  });
  it("requires exact relation enums and a boolean transmission flag", () => {
    for (const parentRole of ["UNSPECIFIED", ["FATHER"], null])
      invalid(() => parseOperation({ ...relation(), parentRole }));
    for (const relationType of [["BIOLOGICAL"], "UNKNOWN"])
      invalid(() => parseOperation({ ...relation(), relationType }));
    for (const lineageTransmission of ["true", 1, null])
      invalid(() => parseOperation({ ...relation(), lineageTransmission }));
  });
  it("lets biological and adoptive children carry the paternal lineage without a mandatory reason", () => {
    for (const relationType of ["BIOLOGICAL", "ADOPTIVE"] as const) {
      const parsed = parseOperation(
        relation({ relationType, lineageTransmission: true }),
      );
      expect(parsed).toMatchObject({
        relationType,
        lineageTransmission: true,
        lineageReason: "",
      });
    }
    expect(requiredApprovals()).toBe(1);
  });
  it("only the explicitly designated father transmits the paternal lineage", () => {
    for (const relationType of ["BIOLOGICAL", "ADOPTIVE"] as const)
      invalid(() =>
        parseOperation(
          relation({
            relationType,
            parentRole: "MOTHER",
            lineageTransmission: true,
          }),
        ),
      );
  });
  it("rejects self-parenting before any graph lookup", () => {
    invalid(() =>
      parseOperation(relation({ parentId: "same", childId: "same" })),
    );
  });
});

describe("bounded parentage graph correctness", () => {
  it("permits explicit father and mother without inferring sex or lineage", () => {
    expect(() =>
      assertGraphCanAdd(
        [edge({ parentId: "father", childId: "child" })],
        relation({ parentId: "mother", parentRole: "MOTHER" }),
      ),
    ).not.toThrow();
    expect(() =>
      assertGraphCanAdd(
        [],
        relation({ parentId: "unconnected-root", childId: "child" }),
      ),
    ).not.toThrow();
  });
  it("rejects duplicate pairs even when proposed type or role differs", () => {
    conflict(() =>
      assertGraphCanAdd(
        [edge({ parentId: "parent", childId: "child" })],
        relation({ parentRole: "MOTHER", relationType: "ADOPTIVE" }),
      ),
    );
  });
  it("rejects a conflicting biological slot and permits separately reviewed adoptive slots", () => {
    conflict(() => assertGraphCanAdd([edge({ childId: "child" })], relation()));
    expect(() =>
      assertGraphCanAdd(
        [edge({ childId: "child" })],
        relation({ relationType: "ADOPTIVE" }),
      ),
    ).not.toThrow();
  });
  it("rejects multiple incoming lineage paths across role and adoption type", () => {
    conflict(() =>
      assertGraphCanAdd(
        [edge({ childId: "child", lineageTransmission: true })],
        relation({
          parentRole: "MOTHER",
          relationType: "ADOPTIVE",
          lineageTransmission: true,
          lineageReason: "Nguồn giả",
        }),
      ),
    );
  });
  it("detects direct, indirect and mixed adoption cycles", () => {
    const existing = [
      edge(),
      edge({
        parentId: "b",
        childId: "c",
        relationType: "ADOPTIVE",
        parentRole: "MOTHER",
      }),
    ];
    conflict(() =>
      assertGraphCanAdd(existing, relation({ parentId: "c", childId: "a" })),
    );
    conflict(() =>
      assertGraphCanAdd([edge()], relation({ parentId: "b", childId: "a" })),
    );
  });
  it("refuses unrelated proposals if the historical graph is already cyclic", () => {
    conflict(() =>
      assertGraphCanAdd(
        [edge(), edge({ parentId: "b", childId: "a" })],
        relation(),
      ),
    );
  });
  it("fails closed for malformed, future, or unclassified legacy edges", () => {
    for (const mutation of [
      { schemaVersion: 2 },
      { version: null },
      { parentRole: "UNSPECIFIED" },
      { lineageTransmission: "true" },
      { verificationStatus: "PENDING" },
      { childId: "a" },
      { relationType: ["BIOLOGICAL"] },
    ])
      conflict(() => assertGraphCanAdd([edge(mutation)], relation()));
  });
  it("validates conflicts within old data rather than only comparing the new edge", () => {
    conflict(() =>
      assertGraphCanAdd([edge(), edge({ parentId: "other" })], relation()),
    );
  });
  it("allows a single lineage founder and chains below it, including adoption", () => {
    const lineage = (overrides: Record<string, unknown>) =>
      edge({ lineageTransmission: true, ...overrides });
    expect(() =>
      assertGraphCanAdd(
        [lineage({ parentId: "root", childId: "a" })],
        relation({
          parentId: "a",
          childId: "b",
          relationType: "ADOPTIVE",
          lineageTransmission: true,
        }),
      ),
    ).not.toThrow();
  });
  it("rejects a second unconnected lineage root", () => {
    conflict(() =>
      assertGraphCanAdd(
        [edge({ parentId: "root", childId: "a", lineageTransmission: true })],
        relation({
          parentId: "other",
          childId: "x",
          lineageTransmission: true,
        }),
      ),
    );
  });
  it("allows joining two roots into one by linking a root under another person", () => {
    // root2 -> y exists beside root1 -> x only if legacy data had two roots;
    // linking root1 under a node of the other tree leaves exactly one root.
    expect(() =>
      assertGraphCanAdd(
        [
          edge({ parentId: "root1", childId: "x", lineageTransmission: true }),
          edge({ parentId: "root2", childId: "y", lineageTransmission: true }),
        ],
        relation({
          parentId: "y",
          childId: "root1",
          lineageTransmission: true,
        }),
      ),
    ).not.toThrow();
  });
  it("ignores non-lineage relations and in-married spouses when counting roots", () => {
    expect(() =>
      assertGraphCanAdd(
        [edge({ parentId: "root", childId: "a", lineageTransmission: true })],
        relation({
          parentId: "mother-line",
          childId: "a2",
          parentRole: "MOTHER",
          lineageTransmission: false,
        }),
      ),
    ).not.toThrow();
  });
  it("caps growth at 200 edges while allowing a bounded 200th edge", () => {
    const chain = Array.from({ length: 200 }, (_, index) =>
      edge({ parentId: `p${index}`, childId: `p${index + 1}` }),
    );
    expect(() =>
      assertGraphCanAdd(chain.slice(0, 199), relation()),
    ).not.toThrow();
    conflict(() => assertGraphCanAdd(chain, relation()));
  });
});
