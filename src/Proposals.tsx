import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { emulator, membershipFunctions } from "./firebase";

type PersonOperation = {
  kind: "PERSON_BASIC";
  personId: string;
  baseVersion: number;
  displayName: string;
  evidence: string;
};
type RelationOperation = {
  kind: "RELATION_CREATE";
  relationId: string;
  parentId: string;
  childId: string;
  parentRole: "FATHER" | "MOTHER";
  relationType: "BIOLOGICAL" | "ADOPTIVE";
  lineageTransmission: boolean;
  lineageReason: string;
  evidence: string;
};
type Operation = PersonOperation | RelationOperation;
type Status = "DRAFT" | "SUBMITTED" | "NEEDS_INFO" | "REJECTED" | "APPROVED";
type Proposal = {
  requestId: string;
  authorUid: string;
  status: Status;
  revision: number;
  operation: Operation;
  before: unknown;
  requiredApprovals: number;
  approvalCount: number;
  reviewNote: string;
};
const statusLabel: Record<Status, string> = {
  DRAFT: "Bản nháp",
  SUBMITTED: "Chờ duyệt",
  NEEDS_INFO: "Cần bổ sung",
  REJECTED: "Đã từ chối",
  APPROVED: "Đã phê duyệt",
};

async function call<T>(name: string, data: unknown): Promise<T> {
  if (!emulator || !membershipFunctions)
    throw new Error("Chức năng chỉ có trên emulator.");
  return (await httpsCallable<unknown, T>(membershipFunctions, name)(data))
    .data;
}
function errorMessage(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : "";
  if (code === "functions/permission-denied")
    return "Bạn không có quyền thực hiện thao tác này hoặc tài khoản chưa xác minh email.";
  if (code === "functions/unauthenticated") return "Vui lòng đăng nhập lại.";
  if (code === "functions/not-found")
    return "Không tìm thấy đề xuất được phép xem.";
  if (code === "functions/invalid-argument")
    return "Kiểm tra thông tin đã nhập. Chỉ gửi dữ liệu trong phạm vi được hỗ trợ.";
  if (code === "functions/already-exists")
    return "Yêu cầu đã được ghi nhận hoặc mã đã được dùng. Tải lại đề xuất trước khi tiếp tục.";
  if (code === "functions/failed-precondition" || code === "functions/aborted")
    return "Không thể áp dụng: phiên bản, phiếu duyệt hoặc quan hệ có thể đã thay đổi. Tải lại và kiểm tra trước khi thử tiếp.";
  return "Không thể hoàn tất yêu cầu. Kiểm tra kết nối và thử lại.";
}
function title(operation: Operation) {
  return operation.kind === "PERSON_BASIC"
    ? operation.displayName
    : `${operation.parentId} → ${operation.childId}`;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function shownText(value: unknown) {
  return typeof value === "string" && value ? value : "Chưa có";
}
function BeforeAfter({ proposal }: { proposal: Proposal }) {
  const operation = proposal.operation;
  const before = object(proposal.before);
  if (operation.kind === "PERSON_BASIC") {
    const person = object(before.person);
    return (
      <>
        <h3>Thông tin thay đổi</h3>
        <p>Trước: {shownText(before.displayName ?? person.displayName)}</p>
        <p>Sau: {operation.displayName}</p>
        <p>
          Mã hồ sơ: {operation.personId} · Phiên bản gốc:{" "}
          {operation.baseVersion}
        </p>
      </>
    );
  }
  const parent = object(before.parent);
  const child = object(before.child);
  return (
    <>
      <h3>Quan hệ được đề xuất</h3>
      <p>Trước: Chưa có quan hệ này; không thay thế quan hệ đang tồn tại.</p>
      <p>
        Cha/mẹ: {shownText(before.parentDisplayName ?? parent.displayName)} (
        {operation.parentId})
      </p>
      <p>
        Người con: {shownText(before.childDisplayName ?? child.displayName)} (
        {operation.childId})
      </p>
      <p>
        Vai trò: {operation.parentRole === "FATHER" ? "Cha" : "Mẹ"} ·{" "}
        {operation.relationType === "BIOLOGICAL" ? "Sinh học" : "Nuôi"}
      </p>
      <p>Truyền dòng họ: {operation.lineageTransmission ? "Có" : "Không"}</p>
      {operation.lineageTransmission && operation.lineageReason && (
        <p>Lý do truyền dòng: {operation.lineageReason}</p>
      )}
      <p>Mã quan hệ: {operation.relationId}</p>
    </>
  );
}

export function Proposals({
  mode,
  currentUid,
}: {
  mode: "OWN" | "REVIEW";
  currentUid: string;
}) {
  const [items, setItems] = useState<Proposal[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [editing, setEditing] = useState<Proposal | null>(null);
  const [dirty, setDirty] = useState(false);
  const [newRequestId, setNewRequestId] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const [kind, setKind] = useState<Operation["kind"]>("PERSON_BASIC");
  const [personId, setPersonId] = useState<string>(() => crypto.randomUUID());
  const [baseVersion, setBaseVersion] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [relationId, setRelationId] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const [parentId, setParentId] = useState("");
  const [childId, setChildId] = useState("");
  const [parentRole, setParentRole] =
    useState<RelationOperation["parentRole"]>("FATHER");
  const [relationType, setRelationType] =
    useState<RelationOperation["relationType"]>("BIOLOGICAL");
  const [lineageTransmission, setLineageTransmission] = useState(false);
  const [lineageReason, setLineageReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [lookupId, setLookupId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const live = useRef(false);
  const generation = useRef(0);
  const running = useRef(false);

  async function run(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    const version = generation.current;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await task();
    } catch (error) {
      if (live.current && generation.current === version)
        setError(errorMessage(error));
    } finally {
      if (live.current && generation.current === version) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  async function refresh() {
    const version = generation.current;
    const result = await call<{ items: Proposal[]; truncated: boolean }>(
      "listChangeRequests",
      { scope: mode },
    );
    if (!live.current || generation.current !== version) return;
    setItems(result.items);
    setTruncated(result.truncated);
  }
  useEffect(() => {
    live.current = true;
    void run(refresh);
    return () => {
      live.current = false;
      generation.current++;
      running.current = false;
    };
    // The route key changes with user, scope and reviewer capability.
    // eslint has no hooks dependency rule in this project.
  }, []);
  if (!emulator) return null;

  function loadForm(proposal: Proposal) {
    const operation = proposal.operation;
    setKind(operation.kind);
    setEvidence(operation.evidence);
    setEditing(proposal);
    setDirty(false);
    if (operation.kind === "PERSON_BASIC") {
      setPersonId(operation.personId);
      setBaseVersion(operation.baseVersion);
      setDisplayName(operation.displayName);
    } else {
      setRelationId(operation.relationId);
      setParentId(operation.parentId);
      setChildId(operation.childId);
      setParentRole(operation.parentRole);
      setRelationType(operation.relationType);
      setLineageTransmission(operation.lineageTransmission);
      setLineageReason(operation.lineageReason);
    }
  }
  function newDraft() {
    setEditing(null);
    setDirty(false);
    setSelected(null);
    setNewRequestId(crypto.randomUUID());
    setPersonId(crypto.randomUUID());
    setRelationId(crypto.randomUUID());
    setBaseVersion(0);
    setDisplayName("");
    setParentId("");
    setChildId("");
    setEvidence("");
    setLineageTransmission(false);
    setLineageReason("");
    setError("");
    setStatus("");
  }
  async function show(id: string) {
    const version = generation.current;
    const record = await call<Proposal>("getChangeRequest", { requestId: id });
    if (!live.current || generation.current !== version) return;
    setSelected(record);
    setNote("");
  }
  async function saveDraft() {
    const operation: Operation =
      kind === "PERSON_BASIC"
        ? {
            kind,
            personId: personId.trim(),
            baseVersion,
            displayName: displayName.trim(),
            evidence: evidence.trim(),
          }
        : {
            kind,
            relationId: relationId.trim(),
            parentId: parentId.trim(),
            childId: childId.trim(),
            parentRole,
            relationType,
            lineageTransmission,
            lineageReason: lineageTransmission ? lineageReason.trim() : "",
            evidence: evidence.trim(),
          };
    const version = generation.current;
    const record = editing
      ? await call<Proposal>("editChangeDraft", {
          requestId: editing.requestId,
          expectedRevision: editing.revision,
          operation,
        })
      : await call<Proposal>("createChangeDraft", {
          requestId: newRequestId,
          operation,
        });
    if (!live.current || generation.current !== version) return;
    setSelected(record);
    loadForm(record);
    setStatus(
      editing
        ? "Đã lưu bản sửa. Các phiếu cũ không còn hiệu lực."
        : "Đã lưu bản nháp. Chưa thay đổi dữ liệu chính thức.",
    );
    await refresh();
  }
  function confirmSubmit() {
    if (!selected || running.current) return;
    if (
      !window.confirm(
        `Gửi đề xuất ${selected.requestId}, bản sửa ${selected.revision}? Bản nháp sẽ chuyển sang chờ duyệt.`,
      )
    )
      return;
    void run(submit);
  }
  function confirmReview(decision: "APPROVE" | "REJECT" | "NEEDS_INFO") {
    if (!selected || running.current) return;
    if (decision !== "APPROVE" && !note.trim()) {
      setError("Vui lòng ghi lý do hoặc nội dung cần bổ sung.");
      return;
    }
    const action =
      decision === "APPROVE"
        ? "Ghi nhận phiếu đồng ý"
        : decision === "REJECT"
          ? "Từ chối"
          : "Yêu cầu bổ sung";
    const effect =
      decision === "APPROVE"
        ? "Dữ liệu chỉ được áp dụng khi đủ phiếu hợp lệ."
        : decision === "REJECT"
          ? "Đề xuất sẽ kết thúc ở trạng thái từ chối."
          : "Các phiếu cũ sẽ mất hiệu lực; người đề xuất phải sửa và gửi lại.";
    if (
      !window.confirm(
        `${action} cho đề xuất ${selected.requestId}, bản sửa ${selected.revision}? ${effect}`,
      )
    )
      return;
    void run(() => review(decision));
  }
  async function submit() {
    if (!selected) return;
    const version = generation.current;
    const record = await call<Proposal>("submitChangeRequest", {
      requestId: selected.requestId,
      expectedRevision: selected.revision,
    });
    if (!live.current || generation.current !== version) return;
    setSelected(record);
    setEditing(null);
    setDirty(false);
    setNewRequestId(crypto.randomUUID());
    setPersonId(crypto.randomUUID());
    setRelationId(crypto.randomUUID());
    setBaseVersion(0);
    setDisplayName("");
    setEvidence("");
    setParentId("");
    setChildId("");
    setLineageTransmission(false);
    setLineageReason("");
    setStatus("Đã gửi đề xuất để kiểm tra và phê duyệt.");
    await refresh();
  }
  async function review(decision: "APPROVE" | "REJECT" | "NEEDS_INFO") {
    if (!selected) return;
    if (decision !== "APPROVE" && !note.trim()) {
      setError("Vui lòng ghi lý do hoặc nội dung cần bổ sung.");
      return;
    }
    const version = generation.current;
    const record = await call<Proposal>("reviewChangeRequest", {
      requestId: selected.requestId,
      expectedRevision: selected.revision,
      decision,
      note: note.trim(),
    });
    if (!live.current || generation.current !== version) return;
    setSelected(record);
    setNote("");
    setStatus(
      record.status === "APPROVED"
        ? "Đề xuất đã được phê duyệt và cập nhật dữ liệu chính thức."
        : decision === "APPROVE"
          ? "Đã ghi nhận phiếu. Chưa áp dụng khi chưa đủ người duyệt hợp lệ."
          : decision === "REJECT"
            ? "Đã từ chối đề xuất."
            : "Đã yêu cầu bổ sung. Người đề xuất cần sửa bản nháp trước khi gửi lại.",
    );
    await refresh();
  }

  return (
    <>
      <div className="eyebrow">CẬP NHẬT CÓ KIỂM CHỨNG</div>
      <h1>{mode === "OWN" ? "Đề xuất thay đổi" : "Hộp duyệt"}</h1>
      <div className="notice">
        Bản thử nghiệm cục bộ, chỉ dùng dữ liệu giả. Người đề xuất không tự
        duyệt; mọi thay đổi do một người duyệt khác người đề xuất. Chưa tự tính
        đời hoặc chi.
      </div>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      <section className="detail">
        <h2>{mode === "OWN" ? "Đề xuất của tôi" : "Đề xuất chờ duyệt"}</h2>
        <button disabled={busy} onClick={() => void run(refresh)}>
          Tải lại danh sách
        </button>
        <p>
          {truncated
            ? "Danh sách giới hạn 30 đề xuất. Dùng mã đề xuất để mở mục cụ thể."
            : `${items.length} đề xuất trong danh sách được cấp quyền.`}
        </p>
        {items.map((item) => (
          <article key={item.requestId} className="proposal-list-item">
            <h3>{title(item.operation)}</h3>
            <p>
              {statusLabel[item.status]} · Bản sửa {item.revision}
            </p>
            <button
              disabled={busy}
              onClick={() => void run(() => show(item.requestId))}
            >
              Xem đề xuất
            </button>
          </article>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => show(lookupId.trim()));
          }}
        >
          <label>
            Mã đề xuất cần xem
            <input
              value={lookupId}
              onChange={(event) => setLookupId(event.target.value)}
              required
              disabled={busy}
              autoComplete="off"
            />
          </label>
          <p>
            <button disabled={busy}>Mở theo mã đề xuất</button>
          </p>
        </form>
      </section>
      {selected && (
        <section className="detail">
          <h2>Chi tiết đề xuất</h2>
          <label>
            Mã đề xuất đang xem
            <input readOnly value={selected.requestId} />
          </label>
          <p>
            Trạng thái: {statusLabel[selected.status]} · Bản sửa:{" "}
            {selected.revision}
          </p>
          <p>
            Cần {selected.requiredApprovals} người duyệt; đã ghi nhận{" "}
            {selected.approvalCount}.
          </p>
          <BeforeAfter proposal={selected} />
          <p>Nguồn và căn cứ: {selected.operation.evidence}</p>
          {selected.reviewNote && (
            <p>Ý kiến người duyệt: {selected.reviewNote}</p>
          )}
          <button
            disabled={busy}
            onClick={() => void run(() => show(selected.requestId))}
          >
            Tải lại đề xuất
          </button>
          {mode === "OWN" &&
            selected.authorUid === currentUid &&
            (selected.status === "DRAFT" ||
              selected.status === "NEEDS_INFO") && (
              <>
                <p>
                  <button disabled={busy} onClick={() => loadForm(selected)}>
                    Sửa bản nháp
                  </button>
                </p>
                {selected.status === "DRAFT" && (
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      (editing?.requestId === selected.requestId && dirty)
                    }
                    onClick={confirmSubmit}
                  >
                    Gửi đề xuất
                  </button>
                )}
                {selected.status === "DRAFT" &&
                  editing?.requestId === selected.requestId &&
                  dirty && (
                    <p>Có thay đổi chưa lưu. Lưu bản sửa trước khi gửi.</p>
                  )}
                {selected.status === "NEEDS_INFO" && (
                  <p>
                    Cần lưu bản sửa mới trước khi gửi lại. Phiếu cũ đã được loại
                    bỏ.
                  </p>
                )}
              </>
            )}
          {mode === "REVIEW" &&
            selected.status === "SUBMITTED" &&
            (selected.authorUid === currentUid ? (
              <p>Không thể duyệt đề xuất của chính mình.</p>
            ) : (
              <>
                <label>
                  Ý kiến duyệt
                  <textarea
                    aria-label="Ý kiến duyệt"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={500}
                    disabled={busy}
                    className="form-field form-note-field"
                  />
                </label>
                <p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => confirmReview("APPROVE")}
                  >
                    Đồng ý duyệt
                  </button>
                </p>
                <p>
                  <button
                    disabled={busy}
                    onClick={() => confirmReview("NEEDS_INFO")}
                  >
                    Yêu cầu bổ sung
                  </button>
                </p>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => confirmReview("REJECT")}
                >
                  Từ chối đề xuất
                </button>
              </>
            ))}
        </section>
      )}
      {mode === "OWN" && (
        <section className="detail">
          <h2>{editing ? "Sửa bản nháp" : "Bản nháp mới"}</h2>
          <button disabled={busy} onClick={newDraft}>
            Tạo bản nháp khác
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(saveDraft);
            }}
            onChange={() => setDirty(true)}
          >
            <fieldset disabled={busy} className="proposal-fields">
              <label>
                Loại đề xuất
                <select
                  aria-label="Loại đề xuất"
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value as Operation["kind"])
                  }
                  className="form-field"
                >
                  <option value="PERSON_BASIC">Họ tên cơ bản</option>
                  <option value="RELATION_CREATE">
                    Thêm quan hệ cha/mẹ-con
                  </option>
                </select>
              </label>
              {kind === "PERSON_BASIC" ? (
                <>
                  <label>
                    Mã hồ sơ
                    <input
                      value={personId}
                      onChange={(event) => setPersonId(event.target.value)}
                      required
                      maxLength={128}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Phiên bản hồ sơ gốc
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={baseVersion}
                      onChange={(event) =>
                        setBaseVersion(Number(event.target.value))
                      }
                      required
                    />
                  </label>
                  <p>
                    Nhập 0 để thêm hồ sơ mới. Khi sửa, dùng đúng mã và phiên bản
                    đang xem trong tra cứu.
                  </p>
                  <label>
                    Họ tên đề xuất
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      required
                      maxLength={160}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Mã quan hệ
                    <input
                      value={relationId}
                      onChange={(event) => setRelationId(event.target.value)}
                      required
                      maxLength={128}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Mã cha/mẹ
                    <input
                      value={parentId}
                      onChange={(event) => setParentId(event.target.value)}
                      required
                      maxLength={128}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Mã người con
                    <input
                      value={childId}
                      onChange={(event) => setChildId(event.target.value)}
                      required
                      maxLength={128}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Vai trò cha/mẹ
                    <select
                      aria-label="Vai trò cha/mẹ"
                      value={parentRole}
                      onChange={(event) => {
                        const role = event.target
                          .value as RelationOperation["parentRole"];
                        setParentRole(role);
                        if (role === "MOTHER") setLineageTransmission(false);
                      }}
                      className="form-field"
                    >
                      <option value="FATHER">Cha</option>
                      <option value="MOTHER">Mẹ</option>
                    </select>
                  </label>
                  <label>
                    Loại quan hệ
                    <select
                      aria-label="Loại quan hệ"
                      value={relationType}
                      onChange={(event) =>
                        setRelationType(
                          event.target
                            .value as RelationOperation["relationType"],
                        )
                      }
                      className="form-field"
                    >
                      <option value="BIOLOGICAL">Sinh học</option>
                      <option value="ADOPTIVE">Nuôi</option>
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={lineageTransmission}
                      disabled={parentRole !== "FATHER"}
                      onChange={(event) =>
                        setLineageTransmission(event.target.checked)
                      }
                      className="checkbox-field"
                    />
                    Truyền dòng họ
                  </label>
                  <p>
                    Dòng họ nội truyền theo nam: chỉ quan hệ với cha mới truyền
                    dòng. Con nuôi cũng tính đời theo dòng và được ghi chú loại
                    quan hệ, không phân biệt đối xử. Người duyệt xác nhận rõ
                    ràng từng quan hệ.
                  </p>
                  {lineageTransmission && (
                    <label>
                      Lý do truyền dòng
                      <textarea
                        aria-label="Lý do truyền dòng"
                        value={lineageReason}
                        onChange={(event) =>
                          setLineageReason(event.target.value)
                        }
                        maxLength={1000}
                        className="form-field form-note-field"
                      />
                    </label>
                  )}
                </>
              )}
              <label>
                Nguồn và căn cứ
                <textarea
                  aria-label="Nguồn và căn cứ"
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value)}
                  required
                  maxLength={1000}
                  className="form-field form-note-field"
                />
              </label>
              <button className="primary">
                {editing ? "Lưu bản sửa" : "Lưu bản nháp"}
              </button>
            </fieldset>
          </form>
        </section>
      )}
    </>
  );
}
