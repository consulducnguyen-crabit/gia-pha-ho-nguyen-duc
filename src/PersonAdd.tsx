// Biểu mẫu thêm con / thêm vợ chồng — chỉ quản trị viên thấy; ghi qua commitAdd (lô nguyên tử có nhật ký).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DuplicateNote } from "./DuplicateNote";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db } from "./firebase";
import { commitAdd, commitUnion, findRemovedUnion } from "./editClient";
import { latestRequest } from "./latestRequest";
import { newPersonId, type AddOp } from "./editAdd";
import { EditError, NAME_MAX, NOTE_MAX } from "./editCore";
import { saveErrorMessage } from "./editForm";
import {
  buildChildOp,
  buildSpouseOp,
  emptyPerson,
  type AddErrors,
  type ChildForm,
  type PersonFields,
  type SpouseForm,
} from "./addForm";
import {
  sameNamePeople,
  yearsLabel,
  type SnapPerson,
  type TreeIndex,
} from "./treeModel";

type Mode = "closed" | "child" | "spouse";
interface Props {
  index: TreeIndex;
  p: SnapPerson;
  uid: string;
  onSaved: (message: string, focusId: string) => void;
  onReload: () => void;
}

function PersonFieldsInputs({
  values,
  errors,
  set,
  idOf,
  nameNote,
}: {
  nameNote?: ReactNode;
  values: PersonFields;
  errors: AddErrors;
  set: <K extends keyof PersonFields>(k: K, v: PersonFields[K]) => void;
  idOf: (k: string) => string;
}) {
  const err = (k: string) =>
    errors[k] ? (
      <span id={idOf(`${k}-err`)} role="alert" className="edit-error">
        {errors[k]}
      </span>
    ) : null;
  const aria = (k: string) => ({
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": errors[k] ? idOf(`${k}-err`) : undefined,
  });
  return (
    <>
      <label>
        Họ tên (bắt buộc)
        <input
          className="form-field"
          value={values.name}
          maxLength={NAME_MAX}
          onChange={(e) => set("name", e.target.value)}
          {...aria("name")}
        />
        {err("name")}
        {nameNote}
      </label>
      <label>
        Giới tính
        <select
          className="form-field"
          value={values.sex}
          onChange={(e) => set("sex", e.target.value as PersonFields["sex"])}
        >
          <option value="">Chưa rõ</option>
          <option value="M">Nam</option>
          <option value="F">Nữ</option>
        </select>
      </label>
      <label>
        Năm sinh
        <input
          className="form-field"
          inputMode="numeric"
          value={values.birthYear}
          onChange={(e) => set("birthYear", e.target.value)}
          {...aria("birthYear")}
        />
        {err("birthYear")}
      </label>
      <label>
        Năm mất
        <input
          className="form-field"
          inputMode="numeric"
          value={values.deathYear}
          onChange={(e) => set("deathYear", e.target.value)}
          {...aria("deathYear")}
        />
        {err("deathYear")}
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={values.deceased || values.deathYear.trim() !== ""}
          disabled={values.deathYear.trim() !== ""}
          onChange={(e) => set("deceased", e.target.checked)}
        />
        Đã mất
        <span className="tree-meta">
          {values.deathYear.trim() !== ""
            ? "Đã có năm mất nên được tính là đã mất."
            : "Tích khi biết đã mất nhưng chưa rõ năm mất."}
        </span>
      </label>
      <label>
        Ghi chú riêng (chỉ quản trị viên xem)
        <textarea
          className="form-note-field"
          value={values.note}
          maxLength={NOTE_MAX}
          onChange={(e) => set("note", e.target.value)}
          {...aria("note")}
        />
        <span className="tree-meta">
          {values.note.length}/{NOTE_MAX} ký tự
        </span>
        {err("note")}
      </label>
    </>
  );
}

export function AddPanel({
  title,
  hint,
  busy,
  saveError,
  conflict,
  onSubmit,
  onCancel,
  onReload,
  errors,
  submitLabel = "Lưu",
  submitDisabled = false,
  children,
}: {
  title: string;
  hint: string;
  busy: boolean;
  saveError: string | null;
  conflict: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  onReload: () => void;
  errors: AddErrors;
  /** Nhãn nút gửi (mặc định "Lưu"). */
  submitLabel?: string;
  /** Khóa nút gửi (ví dụ đang tra liên kết cũ). */
  submitDisabled?: boolean;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => titleRef.current?.focus(), []);
  useEffect(() => {
    if (!Object.keys(errors).length && !saveError) return;
    rootRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"], .edit-form-error')
      ?.focus();
  }, [errors, saveError]);
  return (
    <section className="edit-panel" ref={rootRef} aria-label={title}>
      <h2 tabIndex={-1} ref={titleRef}>
        {title}
      </h2>
      <p className="tree-meta">{hint}</p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onSubmit();
        }}
      >
        <fieldset disabled={busy} className="proposal-fields">
          {children}
        </fieldset>
        {saveError && (
          <div role="alert" className="notice edit-form-error" tabIndex={-1}>
            {saveError}{" "}
            {conflict && (
              <button type="button" className="link-button" onClick={onReload}>
                Tải lại hồ sơ (bỏ nội dung đang nhập)
              </button>
            )}
          </div>
        )}
        <div className="edit-actions">
          <button
            type="submit"
            className="primary"
            disabled={busy || submitDisabled}
          >
            {busy ? "Đang lưu…" : submitLabel}
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            Hủy
          </button>
        </div>
      </form>
    </section>
  );
}

function useSubmit(
  uid: string,
  index: TreeIndex,
  p: SnapPerson,
  onSaved: Props["onSaved"],
  close: () => void,
) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const navigate = useNavigate();
  async function run(
    save: () => Promise<{ focusId: string }>,
    message: string,
  ) {
    setBusy(true);
    setSaveError(null);
    setConflict(false);
    try {
      const result = await save();
      close();
      onSaved(message, result.focusId);
      if (result.focusId !== p.id) navigate(`/person/${result.focusId}`);
    } catch (error) {
      setSaveError(saveErrorMessage(error));
      setConflict(
        error instanceof EditError && error.code === "VERSION_CONFLICT",
      );
    } finally {
      setBusy(false);
    }
  }
  const submit = (op: AddOp, message: string) =>
    run(
      () =>
        commitAdd(db!, {
          op,
          expectedVersion: index.snapshot.editVersion,
          actorUid: uid,
        }),
      message,
    );
  // Khôi phục liên kết vợ/chồng đã gỡ (UNION_REMOVED) giữa người đang xem và spouseId.
  const restoreUnion = (
    spouseId: string,
    removeVersion: number,
    message: string,
  ) =>
    run(
      () =>
        commitUnion(db!, {
          op: {
            type: "restoreRemovedUnion",
            personId: p.id,
            spouseId,
            removeVersion,
          },
          expectedVersion: index.snapshot.editVersion,
          actorUid: uid,
        }),
      message,
    );
  return { busy, saveError, conflict, submit, restoreUnion };
}

function ChildPanel({
  index,
  p,
  uid,
  onSaved,
  onReload,
  close,
}: Props & { close: () => void }) {
  const uniq = useId();
  const [newId] = useState(() => newPersonId());
  const [values, setValues] = useState<ChildForm>({
    ...emptyPerson,
    role: "",
    otherParent: "",
    category: "CLAN",
    adoptive: false,
    branch: p.branch ?? "",
  });
  const [errors, setErrors] = useState<AddErrors>({});
  const { busy, saveError, conflict, submit } = useSubmit(
    uid,
    index,
    p,
    onSaved,
    close,
  );
  const set = <K extends keyof ChildForm>(k: K, v: ChildForm[K]) =>
    setValues({ ...values, [k]: v });
  const spouses = index.spouses(p.id);
  const fatherId =
    values.role === "FATHER"
      ? p.id
      : values.role === "MOTHER"
        ? values.otherParent || null
        : null;
  const canBeLineageFather = (id: string) => {
    const f = index.snapshot.persons.get(id);
    return f?.category === "CLAN" && f.generation !== null;
  };
  const fatherIsClan = !!fatherId && canBeLineageFather(fatherId);
  const category = fatherIsClan ? values.category : "EXTERNAL";
  const fatherGeneration = fatherId
    ? (index.snapshot.persons.get(fatherId)?.generation ?? null)
    : null;
  // Cùng quy tắc editAdd: chỉ con theo dòng mới có đời (= đời cha + 1).
  const childGeneration =
    fatherIsClan && category === "CLAN" && fatherGeneration !== null
      ? fatherGeneration + 1
      : null;
  // Chi mặc định theo chi của cha, trừ khi người dùng đã tự chọn.
  const [branchTouched, setBranchTouched] = useState(false);
  const fatherBranch =
    (fatherId && index.snapshot.persons.get(fatherId)?.branch) || "";
  const branchValue = branchTouched ? values.branch : fatherBranch;
  const otherLabel =
    values.role === "FATHER"
      ? "Mẹ của đứa trẻ (nếu có ghi)"
      : values.role === "MOTHER"
        ? "Cha của đứa trẻ (nếu có ghi)"
        : "Cha/mẹ còn lại";
  const idOf = (k: string) => `${uniq}-${k}`;
  return (
    <AddPanel
      title="Thêm con"
      hint={`Thêm một người con của ${p.name}. Chỉ thêm mới, không đổi quan hệ đã có. Mọi lần lưu đều được ghi nhật ký.`}
      busy={busy}
      saveError={saveError}
      conflict={conflict}
      errors={errors}
      onReload={onReload}
      onCancel={close}
      onSubmit={() => {
        const result = buildChildOp(
          p.id,
          { ...values, category, branch: branchValue },
          { newId, canBeLineageFather },
        );
        if ("errors" in result) return setErrors(result.errors);
        setErrors({});
        void submit(result.op, "Đã thêm người con và ghi nhật ký.");
      }}
    >
      <fieldset className="proposal-fields">
        <legend>{p.name} là… (bắt buộc)</legend>
        {(["FATHER", "MOTHER"] as const).map((r) => (
          <label key={r} className="checkbox-field">
            <input
              type="radio"
              name={idOf("role")}
              checked={values.role === r}
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
          value={values.otherParent}
          onChange={(e) => set("otherParent", e.target.value)}
        >
          <option value="">Không ghi</option>
          {spouses.map((s) => (
            <option key={s} value={s}>
              {index.snapshot.persons.get(s)?.name ?? s}
            </option>
          ))}
        </select>
        <span className="tree-meta">
          Chỉ chọn được người đã có quan hệ vợ/chồng; hãy thêm vợ/chồng trước.
        </span>
      </label>
      <PersonFieldsInputs
        values={values}
        errors={errors}
        idOf={idOf}
        set={(k, v) => set(k, v as never)}
        nameNote={
          <DuplicateNote
            people={sameNamePeople(
              index.snapshot.persons.values(),
              values.name,
              childGeneration,
              null,
            )}
            nameChanged={false}
          />
        }
      />
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={values.adoptive}
          onChange={(e) => set("adoptive", e.target.checked)}
        />
        Con nuôi (vẫn tính đời theo dòng như con ruột)
      </label>
      {fatherIsClan ? (
        <>
          <label>
            Loại
            <select
              className="form-field"
              value={values.category}
              onChange={(e) =>
                set("category", e.target.value as ChildForm["category"])
              }
            >
              <option value="CLAN">Thuộc dòng họ</option>
              <option value="EXTERNAL">Họ ngoại</option>
            </select>
          </label>
          {category === "CLAN" && (
            <label>
              Chi
              <select
                className="form-field"
                value={branchValue}
                onChange={(e) => {
                  setBranchTouched(true);
                  set("branch", e.target.value);
                }}
              >
                <option value="">Không thuộc chi nào</option>
                {index.snapshot.branches.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      ) : (
        values.role && (
          <p className="tree-meta">
            Cha không thuộc dòng họ (hoặc chưa ghi cha) nên người con được ghi
            là họ ngoại và không tính đời.
          </p>
        )
      )}
      {errors.category && (
        <span role="alert" className="edit-error">
          {errors.category}
        </span>
      )}
    </AddPanel>
  );
}

function SpousePanel({
  index,
  p,
  uid,
  onSaved,
  onReload,
  close,
}: Props & { close: () => void }) {
  const uniq = useId();
  const [newId] = useState(() => newPersonId());
  const [values, setValues] = useState<SpouseForm>({
    ...emptyPerson,
    kind: "new",
    existingId: "",
    category: "SPOUSE",
    order: "",
  });
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<AddErrors>({});
  const { busy, saveError, conflict, submit, restoreUnion } = useSubmit(
    uid,
    index,
    p,
    onSaved,
    close,
  );
  // Cặp này từng bị GỠ liên kết: tạo mới sẽ bị chặn (liên kết đã tồn tại, chỉ ẩn), nên đổi sang nút khôi phục.
  const [removedUnion, setRemovedUnion] = useState<{
    removeVersion: number;
  } | null>(null);
  // Tra liên kết cũ: khi chưa xong hoặc lỗi thì khóa gửi (không coi như "không có liên kết cũ").
  const [lookupState, setLookupState] = useState<
    "idle" | "checking" | "failed" | "done"
  >("idle");
  const [lookup] = useState(latestRequest);
  const existingId = values.kind === "existing" ? values.existingId : "";
  useEffect(() => {
    setRemovedUnion(null);
    if (!existingId) {
      setLookupState("idle");
      return;
    }
    setLookupState("checking");
    const isLatest = lookup.start();
    findRemovedUnion(db!, p.id, existingId)
      .then((r) => {
        if (!isLatest()) return;
        setRemovedUnion(r);
        setLookupState("done");
      })
      .catch(() => {
        if (!isLatest()) return;
        setRemovedUnion(null);
        setLookupState("failed");
      });
    return () => lookup.invalidate();
  }, [existingId, p.id, lookup]);
  const set = <K extends keyof SpouseForm>(k: K, v: SpouseForm[K]) =>
    setValues({ ...values, [k]: v });
  const taken = new Set([p.id, ...index.spouses(p.id)]);
  const found = index.search(search).filter((x) => !taken.has(x.id));
  const idOf = (k: string) => `${uniq}-${k}`;
  return (
    <AddPanel
      title="Thêm vợ/chồng"
      hint={`Thêm quan hệ vợ/chồng cho ${p.name}. Thêm liên kết mới, hoặc khôi phục liên kết đã gỡ nếu hai người từng có; không đổi quan hệ đã có. Mọi lần lưu đều được ghi nhật ký.`}
      busy={busy}
      saveError={saveError}
      conflict={conflict}
      errors={errors}
      onReload={onReload}
      onCancel={close}
      submitLabel={removedUnion ? "Khôi phục liên kết đã gỡ" : "Lưu"}
      submitDisabled={lookupState === "checking" || lookupState === "failed"}
      onSubmit={() => {
        if (removedUnion && existingId) {
          setErrors({});
          void restoreUnion(
            existingId,
            removedUnion.removeVersion,
            "Đã khôi phục liên kết vợ/chồng đã gỡ và ghi nhật ký.",
          );
          return;
        }
        const result = buildSpouseOp(p.id, values, { newId });
        if ("errors" in result) return setErrors(result.errors);
        setErrors({});
        void submit(result.op, "Đã thêm quan hệ vợ/chồng và ghi nhật ký.");
      }}
    >
      <fieldset className="proposal-fields">
        <legend>Người vợ/chồng</legend>
        {(["new", "existing"] as const).map((k) => (
          <label key={k} className="checkbox-field">
            <input
              type="radio"
              name={idOf("kind")}
              checked={values.kind === k}
              onChange={() => set("kind", k)}
            />
            {k === "new" ? "Người mới" : "Người đã có trong cây"}
          </label>
        ))}
      </fieldset>
      {values.kind === "existing" ? (
        <>
          <label>
            Tìm theo tên
            <input
              className="form-field"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            Chọn người
            <select
              className="form-field"
              value={values.existingId}
              onChange={(e) => set("existingId", e.target.value)}
              aria-invalid={errors.existingId ? true : undefined}
            >
              <option value="">
                {search.trim()
                  ? found.length
                    ? "— Chọn —"
                    : "Không có kết quả"
                  : "Gõ tên để tìm"}
              </option>
              {found.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} {yearsLabel(x)}
                </option>
              ))}
            </select>
            {errors.existingId && (
              <span role="alert" className="edit-error">
                {errors.existingId}
              </span>
            )}
          </label>
          {lookupState === "checking" && (
            <p className="edit-note" role="status">
              Đang kiểm tra liên kết cũ giữa hai người…
            </p>
          )}
          {lookupState === "failed" && (
            <p className="edit-error" role="alert">
              Không kiểm tra được liên kết cũ; chọn lại người này hoặc tải lại
              hồ sơ rồi thử lại.
            </p>
          )}
          {removedUnion && (
            <p className="edit-note" role="status">
              Hai người này từng có liên kết vợ/chồng đã bị gỡ (lần gỡ số{" "}
              {removedUnion.removeVersion}). Bấm "Khôi phục liên kết đã gỡ" để
              đưa lại đúng liên kết đó; thứ tự và các thông tin khác không đổi.
            </p>
          )}
        </>
      ) : (
        <>
          <PersonFieldsInputs
            values={values}
            errors={errors}
            idOf={idOf}
            set={(k, v) => set(k, v as never)}
          />
          <label>
            Loại
            <select
              className="form-field"
              value={values.category}
              onChange={(e) =>
                set("category", e.target.value as SpouseForm["category"])
              }
            >
              <option value="SPOUSE">Kết hôn vào</option>
              <option value="EXTERNAL">Họ ngoại</option>
            </select>
          </label>
        </>
      )}
      <label>
        Thứ tự (ví dụ 1, 2; có thể để trống)
        <input
          className="form-field"
          disabled={removedUnion !== null}
          value={values.order}
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
    </AddPanel>
  );
}

export function PersonAdd(props: Props) {
  // Lối "Thêm thành viên": đường dẫn ?add=child|spouse chỉ mở sẵn biểu mẫu, rồi được xóa để lần tải lại/lưu xong không mở lại.
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>(() => {
    const a = params.get("add");
    return a === "child" || a === "spouse" ? a : "closed";
  });
  useEffect(() => {
    if (params.has("add")) {
      const next = new URLSearchParams(params);
      next.delete("add");
      setParams(next, { replace: true });
    }
  }, []);
  const [restore, setRestore] = useState<Mode | null>(null);
  const childBtn = useRef<HTMLButtonElement | null>(null);
  const spouseBtn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (mode === "closed" && restore) {
      (restore === "child" ? childBtn : spouseBtn).current?.focus();
      setRestore(null);
    }
  }, [mode, restore]);
  const close = (from: Mode) => () => {
    setRestore(from);
    setMode("closed");
  };
  if (mode === "child") return <ChildPanel {...props} close={close("child")} />;
  if (mode === "spouse")
    return <SpousePanel {...props} close={close("spouse")} />;
  return (
    <p className="edit-actions">
      <button type="button" ref={childBtn} onClick={() => setMode("child")}>
        Thêm con
      </button>
      <button type="button" ref={spouseBtn} onClick={() => setMode("spouse")}>
        Thêm vợ/chồng
      </button>
    </p>
  );
}
