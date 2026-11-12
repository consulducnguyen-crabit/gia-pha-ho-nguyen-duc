// Biểu mẫu sửa hồ sơ một người — chỉ quản trị viên thấy; ghi qua commitEdit (lô nguyên tử có nhật ký).
import { useEffect, useId, useRef, useState } from "react";
import { doc, getDocFromServer } from "firebase/firestore";
import { db } from "./firebase";
import { commitEdit } from "./editClient";
import {
  buildChanges,
  normalizeNameInput,
  saveErrorMessage,
  syncDupNameFlag,
  type FormErrors,
  type FormValues,
} from "./editForm";
import { EditError, NAME_MAX, NOTE_MAX } from "./editCore";
import { DuplicateNote } from "./DuplicateNote";
import {
  FLAG_LABELS,
  FLAG_ORDER,
  sameNamePeople,
  type FlagCode,
  type SnapPerson,
  type TreeIndex,
} from "./treeModel";

type Raw = { text: string; unknown: boolean } | null;
type Phase =
  | { name: "closed" }
  | { name: "loading" }
  | { name: "failed" }
  | {
      name: "form";
      initial: FormValues;
      birthRaw: Raw;
      deathRaw: Raw;
    };

function rawDate(value: unknown): Raw {
  if (!value || typeof value !== "object") return null;
  const v = value as { originalText?: unknown; precision?: unknown };
  const text = typeof v.originalText === "string" ? v.originalText : "";
  return text ? { text, unknown: v.precision === "UNKNOWN" } : null;
}

export function PersonEdit({
  index,
  p,
  uid,
  onSaved,
  onReload,
}: {
  index: TreeIndex;
  p: SnapPerson;
  uid: string;
  onSaved: (message: string) => void;
  onReload: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ name: "closed" });
  const [values, setValues] = useState<FormValues | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failMessage, setFailMessage] = useState("");
  const [restoreFocus, setRestoreFocus] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const openBtnRef = useRef<HTMLButtonElement | null>(null);
  const uniq = useId();
  // Quản lý focus: vào tiêu đề khi mở form, về nút khi hủy, tới trường/thông báo lỗi khi lỗi.
  useEffect(() => {
    if (phase.name === "form") titleRef.current?.focus();
    if (phase.name === "closed" && restoreFocus) {
      openBtnRef.current?.focus();
      setRestoreFocus(false);
    }
  }, [phase.name, restoreFocus]);
  useEffect(() => {
    if (!Object.keys(errors).length && !saveError) return;
    rootRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"], .edit-form-error')
      ?.focus();
  }, [errors, saveError]);
  const field = (k: string) => `${uniq}-${k}`;

  async function open() {
    setPhase({ name: "loading" });
    setErrors({});
    setSaveError(null);
    setConflict(false);
    try {
      const [person, priv] = await Promise.all([
        getDocFromServer(doc(db!, "persons", p.id)),
        getDocFromServer(doc(db!, "personPrivate", p.id)),
      ]);
      if (!person.exists()) throw new Error("missing");
      const d = person.data();
      const initial: FormValues = {
        name: normalizeNameInput(p.name),
        birthYear: p.birthYear === null ? "" : String(p.birthYear),
        deathYear: p.deathYear === null ? "" : String(p.deathYear),
        sex: d.sex === "M" || d.sex === "F" ? d.sex : "",
        branch: p.branch ?? "",
        note: typeof priv.data()?.note === "string" ? priv.data()!.note : "",
        flags: p.flags,
        replaceRawDate: false,
      };
      setValues(initial);
      setPhase({
        name: "form",
        initial,
        birthRaw: rawDate(d.birth),
        deathRaw: rawDate(d.death),
      });
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      setFailMessage(
        code === "permission-denied"
          ? "Không có quyền mở biểu mẫu sửa (chỉ quản trị viên được sửa)."
          : "Không tải được dữ liệu để sửa. Hãy kiểm tra kết nối rồi thử lại.",
      );
      setPhase({ name: "failed" });
    }
  }

  if (phase.name === "closed")
    return (
      <p>
        <button type="button" ref={openBtnRef} onClick={() => void open()}>
          Sửa hồ sơ
        </button>
      </p>
    );
  if (phase.name === "loading")
    return (
      <p role="status" className="notice">
        Đang mở biểu mẫu sửa…
      </p>
    );
  if (phase.name === "failed" || !values)
    return (
      <div role="alert" className="notice">
        {failMessage}{" "}
        <button
          type="button"
          className="link-button"
          onClick={() => void open()}
        >
          Thử lại
        </button>
      </div>
    );

  const { initial, birthRaw, deathRaw } = phase;
  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) =>
    setValues({ ...values, [k]: v });
  const duplicates = sameNamePeople(
    index.snapshot.persons.values(),
    values.name,
    p.generation,
    p.id,
  );
  const rawNeedsConfirm =
    (birthRaw?.unknown && values.birthYear.trim() !== initial.birthYear) ||
    (deathRaw?.unknown && values.deathYear.trim() !== initial.deathYear);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!values || busy) return;
    setSaveError(null);
    setConflict(false);
    const result = buildChanges(
      initial,
      syncDupNameFlag(
        initial.name,
        {
          ...values,
          replaceRawDate: Boolean(rawNeedsConfirm) && values.replaceRawDate,
        },
        duplicates.length,
      ),
    );
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }
    if (rawNeedsConfirm && !values.replaceRawDate) {
      setErrors({
        replaceRawDate:
          "Hãy tích xác nhận để thay văn bản ngày gốc bằng năm mới.",
      });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await commitEdit(db!, {
        op: { type: "updatePerson", personId: p.id, changes: result.changes },
        expectedVersion: index.snapshot.editVersion,
        actorUid: uid,
      });
      setPhase({ name: "closed" });
      onSaved("Đã lưu thay đổi và ghi nhật ký.");
    } catch (error) {
      setSaveError(saveErrorMessage(error));
      setConflict(
        error instanceof EditError && error.code === "VERSION_CONFLICT",
      );
    } finally {
      setBusy(false);
    }
  }

  const err = (k: keyof FormValues) =>
    errors[k] ? (
      <span id={field(`${k}-err`)} role="alert" className="edit-error">
        {errors[k]}
      </span>
    ) : null;
  const aria = (k: keyof FormValues) => ({
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": errors[k] ? field(`${k}-err`) : undefined,
  });

  return (
    <section
      className="edit-panel"
      aria-labelledby={field("title")}
      ref={rootRef}
    >
      <h2 id={field("title")} tabIndex={-1} ref={titleRef}>
        Sửa hồ sơ
      </h2>
      <p className="tree-meta">
        Chỉ quản trị viên thấy biểu mẫu này. Mọi lần lưu đều được ghi nhật ký.
        Quan hệ cha mẹ, con, vợ chồng chưa sửa được ở đây.
      </p>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <fieldset disabled={busy} className="proposal-fields">
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
            <DuplicateNote
              people={duplicates}
              nameChanged={normalizeNameInput(values.name) !== initial.name}
            />
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
            {birthRaw && (
              <span className="tree-meta">
                Ngày gốc trong tài liệu: {birthRaw.text}
                {birthRaw.unknown
                  ? " (không rõ/mâu thuẫn)"
                  : " (giữ tháng/ngày)"}
              </span>
            )}
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
            {deathRaw && (
              <span className="tree-meta">
                Ngày gốc trong tài liệu: {deathRaw.text}
                {deathRaw.unknown
                  ? " (không rõ/mâu thuẫn)"
                  : " (giữ tháng/ngày)"}
              </span>
            )}
            {err("deathYear")}
          </label>
          {rawNeedsConfirm && (
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={values.replaceRawDate}
                onChange={(e) => set("replaceRawDate", e.target.checked)}
                {...aria("replaceRawDate")}
              />
              Tôi xác nhận thay văn bản ngày gốc (không rõ/mâu thuẫn) bằng năm
              mới; giá trị cũ vẫn lưu trong nhật ký.
              {err("replaceRawDate")}
            </label>
          )}
          <label>
            Giới tính
            <select
              className="form-field"
              value={values.sex}
              onChange={(e) => set("sex", e.target.value as FormValues["sex"])}
            >
              <option value="">Chưa rõ</option>
              <option value="M">Nam</option>
              <option value="F">Nữ</option>
            </select>
          </label>
          <label>
            Chi
            <select
              className="form-field"
              value={values.branch}
              onChange={(e) => set("branch", e.target.value)}
            >
              <option value="">Không thuộc chi nào</option>
              {values.branch &&
                !index.snapshot.branches.some(
                  (b) => b.code === values.branch,
                ) && (
                  <option value={values.branch}>
                    (mã chi không còn tồn tại: {values.branch})
                  </option>
                )}
              {index.snapshot.branches.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
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
          <fieldset className="proposal-fields">
            <legend>Cần kiểm tra (bỏ tích = đã xác minh)</legend>
            {FLAG_ORDER.map((c: FlagCode) => (
              <label key={c} className="checkbox-field">
                <input
                  type="checkbox"
                  checked={values.flags.includes(c)}
                  onChange={(e) =>
                    set(
                      "flags",
                      e.target.checked
                        ? [...values.flags, c]
                        : values.flags.filter((x) => x !== c),
                    )
                  }
                />
                {FLAG_LABELS[c]}
              </label>
            ))}
          </fieldset>
        </fieldset>
        {saveError && (
          <div role="alert" className="notice edit-form-error" tabIndex={-1}>
            {saveError}{" "}
            {conflict && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setPhase({ name: "closed" });
                  onReload();
                }}
              >
                Tải lại hồ sơ (bỏ nội dung đang nhập)
              </button>
            )}
          </div>
        )}
        {errors.form && (
          <p role="alert" className="edit-error edit-form-error" tabIndex={-1}>
            {errors.form}
          </p>
        )}
        <div className="edit-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu thay đổi"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setErrors({});
              setSaveError(null);
              setRestoreFocus(true);
              setPhase({ name: "closed" });
            }}
          >
            Hủy
          </button>
        </div>
      </form>
    </section>
  );
}
