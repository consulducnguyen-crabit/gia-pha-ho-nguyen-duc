// Quản trị quan hệ cha/mẹ của một người: đặt/đổi cha hoặc mẹ, đổi loại con nuôi/ruột. Chỉ quản trị viên thấy.
import { useEffect, useId, useRef, useState } from "react";
import { db } from "./firebase";
import { commitRelation } from "./editClient";
import { EditError } from "./editCore";
import { saveErrorMessage } from "./editForm";
import { AddPanel } from "./PersonAdd";
import { yearsLabel, type SnapPerson, type TreeIndex } from "./treeModel";

interface Props {
  index: TreeIndex;
  p: SnapPerson;
  uid: string;
  onSaved: (message: string, focusId: string) => void;
  onReload: () => void;
  /** Gọi khi bắt đầu một thao tác mới (xóa thông báo đã lưu của lần trước). */
  onStart: () => void;
}
const ROLE_LABEL = { FATHER: "Cha", MOTHER: "Mẹ" } as const;

function SetParentPanel({
  index,
  p,
  uid,
  onSaved,
  onReload,
  close,
}: Props & { close: () => void }) {
  const uniq = useId();
  const [role, setRole] = useState<"" | "FATHER" | "MOTHER">("");
  const [search, setSearch] = useState("");
  const [parentId, setParentId] = useState("");
  const [adoptive, setAdoptive] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const existing = role
    ? index.parents(p.id).find((x) => x.role === role)
    : undefined;
  const existingName = existing
    ? (index.snapshot.persons.get(existing.id)?.name ?? existing.id)
    : "";
  const found = index.search(search).filter((x) => x.id !== p.id);
  const idOf = (k: string) => `${uniq}-${k}`;

  async function submit() {
    const e: Record<string, string> = {};
    if (!role) e.role = "Chọn đặt cha hay mẹ.";
    if (!parentId) e.parentId = "Chọn một người trong cây.";
    if (existing && !confirm)
      e.confirm = "Hãy tích xác nhận để thay quan hệ hiện có.";
    setErrors(e);
    if (Object.keys(e).length || !role) return;
    setBusy(true);
    setSaveError(null);
    setConflict(false);
    try {
      await commitRelation(db!, {
        op: {
          type: "setParent",
          childId: p.id,
          role,
          parentId,
          adoptive,
          confirmReplace: confirm,
        },
        expectedVersion: index.snapshot.editVersion,
        actorUid: uid,
      });
      close();
      onSaved("Đã cập nhật quan hệ cha/mẹ và ghi nhật ký.", p.id);
    } catch (error) {
      setSaveError(saveErrorMessage(error));
      setConflict(
        error instanceof EditError && error.code === "VERSION_CONFLICT",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AddPanel
      title="Đặt hoặc đổi cha/mẹ"
      hint={`Đặt cha hoặc mẹ cho ${p.name}. Quan hệ cũ (nếu thay) được ẩn, không xóa hẳn, và ghi vào nhật ký. Không thể chọn con cháu làm cha/mẹ.`}
      busy={busy}
      saveError={saveError}
      conflict={conflict}
      errors={errors}
      onReload={onReload}
      onCancel={close}
      onSubmit={() => void submit()}
    >
      <fieldset className="proposal-fields">
        <legend>Đặt… (bắt buộc)</legend>
        {(["FATHER", "MOTHER"] as const).map((r) => (
          <label key={r} className="checkbox-field">
            <input
              type="radio"
              name={idOf("role")}
              checked={role === r}
              onChange={() => {
                setRole(r);
                setConfirm(false);
              }}
              aria-invalid={errors.role ? true : undefined}
              aria-describedby={errors.role ? idOf("role-err") : undefined}
            />
            {r === "FATHER" ? "Cha" : "Mẹ"}
          </label>
        ))}
        {errors.role && (
          <span id={idOf("role-err")} role="alert" className="edit-error">
            {errors.role}
          </span>
        )}
      </fieldset>
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
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          aria-invalid={errors.parentId ? true : undefined}
          aria-describedby={errors.parentId ? idOf("parentId-err") : undefined}
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
        {errors.parentId && (
          <span id={idOf("parentId-err")} role="alert" className="edit-error">
            {errors.parentId}
          </span>
        )}
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={adoptive}
          onChange={(e) => setAdoptive(e.target.checked)}
        />
        Con nuôi (vẫn tính đời theo dòng như con ruột)
      </label>
      {existing && (
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
            aria-invalid={errors.confirm ? true : undefined}
          />
          Tôi xác nhận thay {ROLE_LABEL[role as "FATHER" | "MOTHER"]} hiện có (
          {existingName}); quan hệ cũ được ẩn và ghi vào nhật ký. Chưa thể chọn
          lại {existingName} cho tới khi có chức năng khôi phục.
          {errors.confirm && (
            <span role="alert" className="edit-error">
              {errors.confirm}
            </span>
          )}
        </label>
      )}
    </AddPanel>
  );
}

export function PersonRelations(props: Props) {
  const { index, p, uid, onSaved, onReload } = props;
  const [open, setOpen] = useState(false);
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const parents = index.parents(p.id);
  // Quản lý focus: tới nút xác nhận khi mở bước xác nhận; về tiêu đề mục khi hủy/đóng.
  useEffect(() => {
    if (pendingType) confirmRef.current?.focus();
  }, [pendingType]);
  useEffect(() => {
    if (!open && !pendingType && restoreFocus) {
      headingRef.current?.focus();
      setRestoreFocus(false);
    }
  }, [open, pendingType, restoreFocus]);

  async function toggleType(parentId: string, adoptive: boolean) {
    props.onStart();
    setBusy(true);
    setError(null);
    try {
      await commitRelation(db!, {
        op: { type: "setRelationType", parentId, childId: p.id, adoptive },
        expectedVersion: index.snapshot.editVersion,
        actorUid: uid,
      });
      setPendingType(null);
      onSaved("Đã đổi loại con và ghi nhật ký.", p.id);
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (open)
    return (
      <SetParentPanel
        {...props}
        close={() => {
          setRestoreFocus(true);
          setOpen(false);
        }}
      />
    );
  return (
    <section className="edit-panel" aria-label="Quản trị quan hệ cha mẹ">
      <h2 tabIndex={-1} ref={headingRef}>
        Quan hệ cha mẹ (quản trị)
      </h2>
      {parents.length === 0 ? (
        <p className="tree-meta">Chưa có cha mẹ nào được ghi.</p>
      ) : (
        <ul className="tree-links">
          {parents.map((x) => {
            const name = index.snapshot.persons.get(x.id)?.name ?? x.id;
            return (
              <li key={`${x.id}:${x.role}`}>
                {name}{" "}
                <span className="tree-meta">
                  · {ROLE_LABEL[x.role]}, {x.adoptive ? "con nuôi" : "con ruột"}
                </span>{" "}
                {pendingType === x.id ? (
                  <>
                    <button
                      type="button"
                      className="primary"
                      ref={confirmRef}
                      disabled={busy}
                      onClick={() => void toggleType(x.id, !x.adoptive)}
                    >
                      {busy
                        ? "Đang lưu…"
                        : `Xác nhận đổi thành ${x.adoptive ? "con ruột" : "con nuôi"}`}
                    </button>{" "}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setRestoreFocus(true);
                        setPendingType(null);
                      }}
                    >
                      Hủy
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      props.onStart();
                      setPendingType(x.id);
                    }}
                  >
                    Đổi thành {x.adoptive ? "con ruột" : "con nuôi"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <div role="alert" className="notice">
          {error}{" "}
          <button type="button" className="link-button" onClick={onReload}>
            Tải lại hồ sơ
          </button>
        </div>
      )}
      <p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            props.onStart();
            setOpen(true);
          }}
        >
          Đặt hoặc đổi cha/mẹ
        </button>
      </p>
    </section>
  );
}
