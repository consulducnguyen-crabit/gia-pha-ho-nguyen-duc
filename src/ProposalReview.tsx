// Chi tiết + duyệt MỘT đề xuất thêm thành viên (quản trị viên; docs/MEMBER_PROPOSALS.md, PR3).
// Đề xuất là dữ liệu không tin cậy: mọi chuỗi chỉ render bằng text React. Ghi vào cây luôn qua commitApproveProposal
// (cùng giao dịch với đánh dấu APPROVED); từ chối/yêu cầu bổ sung qua decideProposal. Rules mới là ranh giới thật.
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "./firebase";
import {
  commitApproveProposal,
  decideProposal,
  getProposalById,
  type MyProposal,
} from "./editClient";
import { formatVnTime } from "./auditView";
import { PersonFieldsInputs } from "./PersonAdd";
import {
  REASON_MAX,
  buildProposal,
  cleanReason,
  statusLabel,
  type ChildPayload,
  type ProposalDoc,
  type SpousePayload,
} from "./memberProposal";
import {
  payloadToChildForm,
  payloadToSpouseForm,
  lostOtherParent,
  kindLabel,
} from "./proposalView";
import {
  adminActions,
  authorText,
  decisionErrorMessage,
  droppedOtherParent,
  isOwnProposal,
  similarExisting,
  verifiedResubmit,
  type AuthorInfo,
} from "./proposalAdmin";
import type { AddErrors, ChildForm, SpouseForm } from "./addForm";
import { yearsLabel, type TreeIndex } from "./treeModel";

const when = (ms: number | null) =>
  ms === null ? "" : formatVnTime(new Date(ms));

export interface ReviewDone {
  message: string;
  /** Người mới được ghi vào cây (duyệt thành công): để dẫn tới hồ sơ. */
  personId?: string;
}

interface ReviewProps {
  item: MyProposal;
  uid: string;
  author: AuthorInfo | undefined;
  /** Các đề xuất đang mở khác cùng người được gắn (cảnh báo trùng). */
  otherOpen: MyProposal[];
  onClose: () => void;
  onDone: (done: ReviewDone) => void;
  /** Dữ liệu có thể đã đổi (xung đột/đã xử lý/quyền): nơi gọi tải lại cây và đề xuất này. */
  onStale: (id: string) => void;
}

/**
 * Biểu mẫu chỉ được khởi tạo KHI ĐÃ CÓ cây: payloadToChildForm cần danh sách vợ/chồng hiện tại để giữ "cha/mẹ còn
 * lại"; khởi tạo khi cây chưa về sẽ làm ô này rỗng và Duyệt âm thầm bỏ quan hệ. Chưa có cây thì chỉ hiện trạng thái chờ.
 */
export function ProposalReview(
  props: ReviewProps & {
    index: TreeIndex | null;
    tree: "loading" | "error" | "ready";
    onRetryTree: () => void;
  },
) {
  const { index, tree, onRetryTree, ...rest } = props;
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const waiting = !index;
  useEffect(() => {
    if (waiting) titleRef.current?.focus();
  }, [waiting]);
  if (index) return <ReviewInner {...rest} index={index} />;
  const d = props.item.doc;
  return (
    <section className="edit-panel proposal-review" aria-label="Chi tiết đề xuất">
      <h2 tabIndex={-1} ref={titleRef}>
        {kindLabel(d.kind)}: {d.payload.name}
      </h2>
      {tree === "error" ? (
        <div role="alert" className="notice">
          Chưa tải được cây gia phả nên chưa thể xem đầy đủ hay duyệt đề xuất
          này.{" "}
          <button type="button" className="link-button" onClick={onRetryTree}>
            Thử lại
          </button>
        </div>
      ) : (
        <p role="status" className="notice">
          Đang tải cây gia phả… Biểu mẫu duyệt sẽ hiện khi cây tải xong.
        </p>
      )}
      <div className="edit-actions">
        <button type="button" onClick={props.onClose}>
          Về danh sách
        </button>
      </div>
    </section>
  );
}

function ReviewInner({
  item,
  index,
  uid,
  author,
  otherOpen,
  onClose,
  onDone,
  onStale,
}: ReviewProps & { index: TreeIndex }) {
  const d = item.doc;
  const uniq = useId();
  const idOf = (k: string) => `${uniq}-${k}`;
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => titleRef.current?.focus(), []);
  const anchor = index?.snapshot.persons.get(d.anchorId);
  const own = isOwnProposal(d, uid);
  const acts = adminActions(d.status);
  const editable = acts.approve && !own;

  // "Gửi lại của …": chỉ hiện khi đề xuất cũ cùng tác giả và ĐÃ RÚT/TỪ CHỐI (rules không kiểm resubmitOf).
  const [oldState, setOldState] = useState<
    "none" | "loading" | "error" | { old: ProposalDoc | null }
  >(d.resubmitOf ? "loading" : "none");
  useEffect(() => {
    if (!d.resubmitOf) return;
    let live = true;
    getProposalById(db!, d.resubmitOf)
      .then((r) => live && setOldState({ old: r?.doc ?? null }))
      .catch(() => live && setOldState("error"));
    return () => {
      live = false;
    };
  }, [d.resubmitOf]);
  const resubmitOld =
    typeof oldState === "object" ? verifiedResubmit(d, oldState.old) : null;

  // Biểu mẫu điền sẵn từ đề xuất; quản trị viên được sửa mọi trường nội dung (không đổi người được gắn/loại đề xuất).
  const spouseIds = index ? index.spouses(d.anchorId) : [];
  const [child, setChild] = useState<ChildForm>(() =>
    d.kind === "CHILD"
      ? payloadToChildForm(d.payload as ChildPayload, spouseIds)
      : ({} as ChildForm),
  );
  const [spouse, setSpouse] = useState<SpouseForm>(() =>
    d.kind === "SPOUSE"
      ? payloadToSpouseForm(d.payload as SpousePayload)
      : ({} as SpouseForm),
  );
  const values = d.kind === "CHILD" ? child : spouse;
  const lostParent =
    d.kind === "CHILD" &&
    !!index &&
    lostOtherParent(d.payload as ChildPayload, spouseIds);
  const [errors, setErrors] = useState<AddErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  // Chốt an toàn: đề xuất có cha/mẹ còn lại mà ô đang "Không ghi" thì phải xác nhận trước khi bỏ quan hệ đó.
  const [askDrop, setAskDrop] = useState(false);
  const dropRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (askDrop) dropRef.current?.focus();
  }, [askDrop]);
  const rootRef = useRef<HTMLElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const rejectRef = useRef<HTMLButtonElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (confirmReject) confirmRef.current?.focus();
  }, [confirmReject]);
  // Lỗi lý do: đưa focus vào ô lý do (WCAG: lỗi nhập phải dẫn tới đúng ô).
  useEffect(() => {
    if (reasonError) reasonRef.current?.focus();
  }, [reasonError]);
  // Phụ thuộc cả `editable`: sau khi tải lại, đề xuất có thể thành "đã xử lý" nên vùng lỗi chuyển nhánh (mount lại).
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError, editable]);
  useEffect(() => {
    if (Object.keys(errors).length)
      rootRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
  }, [errors]);

  const set = <K extends string>(k: K, v: unknown) => {
    if (d.kind === "CHILD") setChild({ ...child, [k]: v } as ChildForm);
    else setSpouse({ ...spouse, [k]: v } as SpouseForm);
  };
  const canBeLineageFather = (id: string) => {
    const f = index?.snapshot.persons.get(id);
    return f?.category === "CLAN" && f.generation !== null;
  };

  function parseReason(required: boolean): string | null | undefined {
    // undefined = lỗi (đã hiện); null = trống hợp lệ (chỉ khi không bắt buộc).
    try {
      setReasonError(null);
      return cleanReason(reason, required);
    } catch (error) {
      setReasonError(
        error instanceof Error ? error.message : "Lý do không hợp lệ.",
      );
      reasonRef.current?.focus(); // cả khi lỗi trùng lần trước (state không đổi nên effect không chạy)
      return undefined;
    }
  }

  async function run(task: () => Promise<ReviewDone>) {
    setBusy(true);
    setFormError(null);
    try {
      onDone(await task());
    } catch (error) {
      setFormError(decisionErrorMessage(error));
      // Có thể dữ liệu đã đổi (đã xử lý, xung đột phiên bản, quyền): tải lại để hiện trạng thái thật.
      onStale(d.id);
    } finally {
      setBusy(false);
    }
  }

  function approve(confirmedDrop = false) {
    if (!editable) return;
    const note = parseReason(false);
    if (note === undefined) return;
    if (
      !confirmedDrop &&
      d.kind === "CHILD" &&
      droppedOtherParent(d.payload as ChildPayload, child.otherParent)
    ) {
      setAskDrop(true);
      return;
    }
    setAskDrop(false);
    const r = buildProposal(d.kind, d.anchorId, values, {
      newId: d.newId,
      authorUid: d.authorUid,
      canBeLineageFather,
    });
    if ("errors" in r) {
      const { form, otherParent, branch, ...rest } = r.errors;
      setErrors(rest);
      setFormError(
        [form, otherParent, branch].filter(Boolean).join(" ") ||
          (Object.keys(rest).length ? "Hãy sửa các ô báo lỗi rồi duyệt lại." : null),
      );
      return;
    }
    setErrors({});
    void run(async () => {
      await commitApproveProposal(db!, {
        proposalId: d.id,
        expectedVersion: index.snapshot.editVersion,
        actorUid: uid,
        // Nội dung quản trị viên đã xem/sửa; applyAdd vẫn kiểm tra đầy đủ lần nữa.
        edits: r.proposal.payload as Partial<ChildPayload & SpousePayload>,
        ...(note ? { reason: note } : {}),
      });
      return {
        message: `Đã duyệt và ghi "${r.proposal.payload.name}" vào gia phả. Đề xuất chuyển sang ĐÃ DUYỆT.`,
        personId: d.newId,
      };
    });
  }

  function decide(status: "REJECTED" | "NEEDS_INFO") {
    if (own) return;
    const text = parseReason(true);
    if (!text) return;
    void run(async () => {
      await decideProposal(db!, {
        proposalId: d.id,
        status,
        reason: text,
        actorUid: uid,
      });
      return {
        message:
          status === "REJECTED"
            ? `Đã từ chối đề xuất "${d.payload.name}".`
            : `Đã yêu cầu bổ sung cho đề xuất "${d.payload.name}".`,
      };
    });
  }

  const similar =
    index && editable ? similarExisting(index, d, values.name || d.payload.name) : [];
  const sent = when(item.createdAtMs);
  const updated = when(item.updatedAtMs);

  return (
    <section className="edit-panel proposal-review" ref={rootRef} aria-label="Chi tiết đề xuất">
      <h2 tabIndex={-1} ref={titleRef}>
        {kindLabel(d.kind)}: {d.payload.name}
      </h2>
      <p>
        <span className="proposal-status" data-status={d.status}>
          {statusLabel(d.status)}
        </span>
      </p>
      <dl className="proposal-facts">
        <div>
          <dt>Người gửi</dt>
          <dd>{authorText(author)}</dd>
        </div>
        <div>
          <dt>Gửi lúc</dt>
          <dd>{sent || "không rõ"}</dd>
        </div>
        <div>
          <dt>Gắn với</dt>
          <dd>
            {anchor ? (
              <Link to={`/person/${anchor.id}`}>
                {anchor.name} {yearsLabel(anchor)}
              </Link>
            ) : (
              "Người này không còn trong cây (có thể đã bị ẩn)"
            )}
          </dd>
        </div>
        {d.source && (
          <div>
            <dt>Nguồn/căn cứ</dt>
            <dd className="proposal-text">{d.source}</dd>
          </div>
        )}
        {resubmitOld && (
          <div>
            <dt>Gửi lại</dt>
            <dd>
              Gửi lại của đề xuất #{resubmitOld.id} (
              {statusLabel(resubmitOld.status)})
              {resubmitOld.status === "REJECTED" && resubmitOld.decisionReason
                ? `; lý do từ chối trước đó: ${resubmitOld.decisionReason}`
                : ""}
            </dd>
          </div>
        )}
        {d.infoRequestReason && (
          <div>
            <dt>Đã yêu cầu bổ sung</dt>
            <dd className="proposal-text">{d.infoRequestReason}</dd>
          </div>
        )}
        {d.decisionReason && (
          <div>
            <dt>Ghi chú/lý do quyết định</dt>
            <dd className="proposal-text">{d.decisionReason}</dd>
          </div>
        )}
        {!editable && updated && (
          <div>
            <dt>Cập nhật lúc</dt>
            <dd>{updated}</dd>
          </div>
        )}
      </dl>
      {d.status === "APPROVED" && (
        <p className="tree-meta">
          Đã ghi vào gia phả
          {d.appliedEditVersion ? ` ở lần sửa #${d.appliedEditVersion}` : ""}.{" "}
          {index?.snapshot.persons.has(d.newId) && (
            <Link to={`/person/${d.newId}`}>Mở hồ sơ người đã thêm</Link>
          )}
        </p>
      )}
      {(similar.length > 0 || (editable && otherOpen.length > 0)) && (
        <div className="notice proposal-warn" role="status">
          <strong>Có thể trùng, hãy đối chiếu trước khi duyệt</strong> (không
          chặn việc duyệt):
          <ul>
            {similar.map((p) => (
              <li key={p.id}>
                {d.kind === "CHILD" ? "Con" : "Vợ/chồng"} hiện có tên gần giống:{" "}
                <Link to={`/person/${p.id}`}>{p.name}</Link> {yearsLabel(p)}
              </li>
            ))}
            {otherOpen.map((o) => (
              <li key={o.doc.id}>
                Đề xuất khác cùng người được gắn:{" "}
                {kindLabel(o.doc.kind)} “{o.doc.payload.name}” (
                {statusLabel(o.doc.status)})
              </li>
            ))}
          </ul>
        </div>
      )}
      {anchor === undefined && index && editable && (
        <p className="notice" role="status">
          Người được gắn không còn trong cây nên không thể duyệt; bạn vẫn có thể
          Từ chối hoặc Cần bổ sung.
        </p>
      )}
      {own && acts.approve && (
        <p className="notice" role="status">
          Đây là đề xuất do chính bạn gửi. Quy tắc không cho tự duyệt, từ chối
          hoặc yêu cầu bổ sung đề xuất của mình; hãy nhờ quản trị viên khác xử
          lý.
        </p>
      )}
      {editable && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <fieldset disabled={busy} className="proposal-fields">
            <legend>Nội dung ghi vào gia phả (có thể sửa trước khi duyệt)</legend>
            {d.kind === "CHILD" ? (
              <ChildFields
                form={child}
                set={set}
                errors={errors}
                idOf={idOf}
                index={index}
                anchorId={d.anchorId}
                anchorName={anchor?.name ?? "Người được gắn"}
                lostParent={lostParent}
                canBeLineageFather={canBeLineageFather}
              />
            ) : (
              <SpouseFields
                form={spouse}
                set={set}
                errors={errors}
                idOf={idOf}
              />
            )}
          </fieldset>
          <fieldset disabled={busy} className="proposal-fields">
            <legend>Quyết định</legend>
            <label>
              Lý do hoặc ghi chú gửi người gửi
              <textarea
                className="form-note-field"
                ref={reasonRef}
                value={reason}
                maxLength={REASON_MAX}
                onChange={(e) => setReason(e.target.value)}
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={idOf("reason-help")}
              />
              <span id={idOf("reason-help")} className="tree-meta">
                {reason.length}/{REASON_MAX} ký tự. Bắt buộc khi Từ chối hoặc
                Cần bổ sung; tùy chọn khi Duyệt. Người gửi đọc được nội dung
                này ở "Đề xuất của tôi" (nội dung sửa ở trên không báo riêng).
              </span>
              {reasonError && (
                <span role="alert" className="edit-error">
                  {reasonError}
                </span>
              )}
            </label>
          </fieldset>
          {formError && (
            <div
              role="alert"
              className="notice edit-form-error"
              tabIndex={-1}
              ref={errorRef}
            >
              {formError}
            </div>
          )}
          {askDrop ? (
            <div className="edit-actions" role="group" aria-label="Xác nhận bỏ cha/mẹ còn lại">
              <span className="edit-note" role="alert">
                Đề xuất có ghi cha/mẹ còn lại
                {(() => {
                  const id = (d.payload as ChildPayload).otherParentId;
                  const p = id ? index.snapshot.persons.get(id) : null;
                  return p ? ` (${p.name})` : "";
                })()}{" "}
                nhưng ô đó đang để "Không ghi". Nếu duyệt, người mới sẽ KHÔNG có
                quan hệ với người này.
              </span>
              <button
                type="button"
                className="danger"
                ref={dropRef}
                disabled={busy}
                onClick={() => approve(true)}
              >
                {busy ? "Đang xử lý…" : "Vẫn duyệt, không ghi cha/mẹ còn lại"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setAskDrop(false)}
              >
                Quay lại chọn
              </button>
            </div>
          ) : confirmReject ? (
            <div className="edit-actions" role="group" aria-label="Xác nhận từ chối">
              <span className="edit-note">
                Từ chối là quyết định cuối: người gửi chỉ có thể gửi lại thành
                đề xuất mới.
              </span>
              <button
                type="button"
                className="danger"
                ref={confirmRef}
                disabled={busy}
                onClick={() => decide("REJECTED")}
              >
                {busy ? "Đang xử lý…" : "Xác nhận từ chối"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmReject(false);
                  globalThis.setTimeout(() => rejectRef.current?.focus(), 0);
                }}
              >
                Không từ chối
              </button>
            </div>
          ) : (
            <div className="edit-actions">
              <button
                type="button"
                className="primary"
                disabled={busy || anchor === undefined}
                onClick={() => approve()}
              >
                {busy ? "Đang xử lý…" : "Duyệt và ghi vào gia phả"}
              </button>
              {acts.needInfo && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide("NEEDS_INFO")}
                >
                  Cần bổ sung
                </button>
              )}
              {acts.reject && (
                <button
                  type="button"
                  className="danger"
                  ref={rejectRef}
                  disabled={busy}
                  onClick={() => {
                    if (parseReason(true)) setConfirmReject(true);
                  }}
                >
                  Từ chối
                </button>
              )}
              <button type="button" disabled={busy} onClick={onClose}>
                Về danh sách
              </button>
            </div>
          )}
        </form>
      )}
      {!editable && (
        <>
          {formError && (
            <div role="alert" className="notice edit-form-error" tabIndex={-1} ref={errorRef}>
              {formError}
            </div>
          )}
          <div className="edit-actions">
            <button type="button" onClick={onClose}>
              Về danh sách
            </button>
          </div>
        </>
      )}
    </section>
  );
}

type SetFn = (k: string, v: unknown) => void;

function ChildFields({
  form,
  set,
  errors,
  idOf,
  index,
  anchorId,
  anchorName,
  lostParent,
  canBeLineageFather,
}: {
  form: ChildForm;
  set: SetFn;
  errors: AddErrors;
  idOf: (k: string) => string;
  index: TreeIndex | null;
  anchorId: string;
  anchorName: string;
  lostParent: boolean;
  canBeLineageFather: (id: string) => boolean;
}) {
  const spouses = index ? index.spouses(anchorId) : [];
  const fatherId =
    form.role === "FATHER"
      ? anchorId
      : form.role === "MOTHER"
        ? form.otherParent || null
        : null;
  const fatherEligible = !!fatherId && canBeLineageFather(fatherId);
  const otherLabel =
    form.role === "FATHER"
      ? "Mẹ của đứa trẻ (nếu có ghi)"
      : form.role === "MOTHER"
        ? "Cha của đứa trẻ (nếu có ghi)"
        : "Cha/mẹ còn lại";
  return (
    <>
      {lostParent && (
        <p className="notice" role="status">
          Người cha/mẹ còn lại trong đề xuất không còn trong danh sách vợ/chồng;
          hãy chọn lại nếu cần.
        </p>
      )}
      <fieldset className="proposal-fields">
        <legend>{anchorName} là… (bắt buộc)</legend>
        {(["FATHER", "MOTHER"] as const).map((r) => (
          <label key={r} className="checkbox-field">
            <input
              type="radio"
              name={idOf("role")}
              checked={form.role === r}
              onChange={() => set("role", r)}
              aria-invalid={errors.role ? true : undefined}
              aria-describedby={errors.role ? idOf("role-err") : undefined}
            />
            {r === "FATHER" ? "Cha của đứa trẻ" : "Mẹ của đứa trẻ"}
          </label>
        ))}
        {errors.role && (
          <span id={idOf("role-err")} role="alert" className="edit-error">
            {errors.role}
          </span>
        )}
      </fieldset>
      <label>
        {otherLabel}
        <select
          className="form-field"
          value={form.otherParent}
          onChange={(e) => set("otherParent", e.target.value)}
        >
          <option value="">Không ghi</option>
          {spouses.map((s) => (
            <option key={s} value={s}>
              {index?.snapshot.persons.get(s)?.name ?? s}
            </option>
          ))}
        </select>
        <span className="tree-meta">
          Chỉ chọn được người đã có quan hệ vợ/chồng.
        </span>
      </label>
      <PersonFieldsInputs
        values={form}
        errors={errors}
        idOf={idOf}
        set={(k, v) => set(k, v)}
      />
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={form.adoptive}
          onChange={(e) => set("adoptive", e.target.checked)}
        />
        Con nuôi (vẫn tính đời theo dòng như con ruột)
      </label>
      <label>
        Loại
        <select
          className="form-field"
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
          aria-invalid={errors.category ? true : undefined}
          aria-describedby={errors.category ? idOf("category-err") : undefined}
        >
          <option value="CLAN">Thuộc dòng họ</option>
          <option value="EXTERNAL">Họ ngoại</option>
        </select>
        <span className="tree-meta">
          {form.role && !fatherEligible
            ? "Cha không thuộc dòng họ (hoặc chưa ghi cha) nên chỉ chọn được Họ ngoại."
            : "Thuộc dòng họ chỉ khi cha thuộc dòng họ và đã nối tới thủy tổ."}
        </span>
        {errors.category && (
          <span id={idOf("category-err")} role="alert" className="edit-error">
            {errors.category}
          </span>
        )}
      </label>
      {form.category === "CLAN" && (
        <label>
          Chi
          <select
            className="form-field"
            value={form.branch}
            onChange={(e) => set("branch", e.target.value)}
          >
            <option value="">Không thuộc chi nào</option>
            {(index?.snapshot.branches ?? []).map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function SpouseFields({
  form,
  set,
  errors,
  idOf,
}: {
  form: SpouseForm;
  set: SetFn;
  errors: AddErrors;
  idOf: (k: string) => string;
}) {
  return (
    <>
      <PersonFieldsInputs
        values={form}
        errors={errors}
        idOf={idOf}
        set={(k, v) => set(k, v)}
      />
      <label>
        Loại
        <select
          className="form-field"
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
        >
          <option value="SPOUSE">Kết hôn vào</option>
          <option value="EXTERNAL">Họ ngoại</option>
        </select>
      </label>
      <label>
        Thứ tự (ví dụ 1, 2; có thể để trống)
        <input
          className="form-field"
          value={form.order}
          maxLength={20}
          onChange={(e) => set("order", e.target.value)}
          aria-invalid={errors.order ? true : undefined}
        />
        {errors.order && (
          <span role="alert" className="edit-error">
            {errors.order}
          </span>
        )}
      </label>
    </>
  );
}
