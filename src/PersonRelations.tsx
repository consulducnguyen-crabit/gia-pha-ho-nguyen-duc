// Quản trị quan hệ cha/mẹ của một người: đặt/đổi cha hoặc mẹ, đổi loại con nuôi/ruột. Chỉ quản trị viên thấy.
import { useEffect, useId, useRef, useState } from "react";
import { db } from "./firebase";
import {
  commitRelation,
  findRemovedParent,
  findRevertCandidate,
} from "./editClient";
import { EditError } from "./editCore";
import { saveErrorMessage } from "./editForm";
import { latestRequest } from "./latestRequest";
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
  // Người được chọn từng bị GỠ khỏi cha/mẹ của người này: đề nghị khôi phục thay vì đặt lại.
  const [removedFound, setRemovedFound] = useState<{
    role: "FATHER" | "MOTHER";
    removeVersion: number;
  } | null>(null);
  const [lookup] = useState(latestRequest);
  useEffect(() => {
    setRemovedFound(null);
    if (!parentId) return;
    const isLatest = lookup.start();
    findRemovedParent(db!, p.id, parentId)
      .then((r) => {
        if (isLatest()) setRemovedFound(r);
      })
      .catch(() => {
        if (isLatest()) setRemovedFound(null);
      });
    return () => lookup.invalidate();
  }, [parentId, p.id, lookup]);

  async function restoreRemoved() {
    if (!removedFound) return;
    setBusy(true);
    setSaveError(null);
    setConflict(false);
    try {
      await commitRelation(db!, {
        op: {
          type: "restoreRemovedParent",
          childId: p.id,
          role: removedFound.role,
          parentId,
          removeVersion: removedFound.removeVersion,
        },
        expectedVersion: index.snapshot.editVersion,
        actorUid: uid,
      });
      close();
      onSaved("Đã khôi phục quan hệ cha/mẹ đã gỡ và ghi nhật ký.", p.id);
    } catch (error) {
      setSaveError(saveErrorMessage(error));
      setConflict(
        error instanceof EditError && error.code === "VERSION_CONFLICT",
      );
    } finally {
      setBusy(false);
    }
  }

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
      {removedFound && (
        <p className="edit-note">
          Người này từng được gỡ khỏi vai trò{" "}
          {ROLE_LABEL[removedFound.role].toLowerCase()} của {p.name} (lần gỡ số{" "}
          {removedFound.removeVersion}). Có thể khôi phục quan hệ đó thay vì đặt
          lại.{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => void restoreRemoved()}
          >
            Khôi phục quan hệ đã gỡ
          </button>
        </p>
      )}
      {existing && (
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
            aria-invalid={errors.confirm ? true : undefined}
          />
          Tôi xác nhận thay {ROLE_LABEL[role as "FATHER" | "MOTHER"]} hiện có (
          {existingName}); quan hệ cũ được ẩn và ghi vào nhật ký. Nếu thay nhầm,
          dùng nút “Hoàn tác lần thay” ở mục Quan hệ cha mẹ.
        </label>
      )}
      {/* Lỗi nằm ngoài nhãn flex để không bị ép thành cột hẹp ở 360px. */}
      {existing && errors.confirm && (
        <span role="alert" className="edit-error">
          {errors.confirm}
        </span>
      )}
    </AddPanel>
  );
}

export function PersonRelations(props: Props) {
  const { index, p, uid, onSaved, onReload } = props;
  const [open, setOpen] = useState(false);
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [revertAsk, setRevertAsk] = useState<{
    role: "FATHER" | "MOTHER";
    curName: string;
    parentId: string;
    oldName: string;
    changeVersion: number;
  } | null>(null);
  const [removeAsk, setRemoveAsk] = useState<{
    id: string;
    role: "FATHER" | "MOTHER";
    name: string;
    hadReplace: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const parents = index.parents(p.id);
  // Quản lý focus: tới nút xác nhận khi mở bước xác nhận; về tiêu đề mục khi hủy/đóng.
  const pending =
    pendingType ??
    (revertAsk ? `revert:${revertAsk.role}` : null) ??
    (removeAsk ? `remove:${removeAsk.role}` : null);
  useEffect(() => {
    if (pending) confirmRef.current?.focus();
  }, [pending]);
  useEffect(() => {
    if (!open && !pending && restoreFocus) {
      headingRef.current?.focus();
      setRestoreFocus(false);
    }
  }, [open, pending, restoreFocus]);

  async function startRevert(x: { id: string; role: "FATHER" | "MOTHER" }) {
    props.onStart();
    setBusy(true);
    setError(null);
    try {
      const found = await findRevertCandidate(db!, p.id, x.id, x.role);
      if (!found) {
        setError(
          `Không có lần thay ${ROLE_LABEL[x.role].toLowerCase()} nào để hoàn tác (quan hệ hiện tại không phải kết quả của một lần thay).`,
        );
        return;
      }
      setRevertAsk({
        role: x.role,
        curName: index.snapshot.persons.get(x.id)?.name ?? x.id,
        parentId: found.parentId,
        oldName:
          index.snapshot.persons.get(found.parentId)?.name ?? found.parentId,
        changeVersion: found.changeVersion,
      });
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function startRemove(x: { id: string; role: "FATHER" | "MOTHER" }) {
    props.onStart();
    setBusy(true);
    setError(null);
    try {
      // Quan hệ do một lần thay tạo ra: cha/mẹ cũ chỉ đưa lại được bằng đường vòng (xem cảnh báo).
      const earlier = await findRevertCandidate(db!, p.id, x.id, x.role);
      setRevertAsk(null);
      setPendingType(null);
      setRemoveAsk({
        id: x.id,
        role: x.role,
        name: index.snapshot.persons.get(x.id)?.name ?? x.id,
        hadReplace: earlier !== null,
      });
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirmRemove() {
    if (!removeAsk) return;
    props.onStart();
    setBusy(true);
    setError(null);
    try {
      const result = await commitRelation(db!, {
        op: {
          type: "removeParent",
          childId: p.id,
          role: removeAsk.role,
          parentId: removeAsk.id,
          confirm: true,
        },
        expectedVersion: index.snapshot.editVersion,
        actorUid: uid,
      });
      setRemoveAsk(null);
      onSaved(
        `Đã gỡ ${ROLE_LABEL[removeAsk.role].toLowerCase()} ${removeAsk.name}. Để khôi phục, mở "Đặt hoặc đổi cha/mẹ" và chọn lại đúng người này (lần gỡ số ${result.nextVersion}).`,
        p.id,
      );
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirmRevert() {
    if (!revertAsk) return;
    props.onStart();
    setBusy(true);
    setError(null);
    try {
      await commitRelation(db!, {
        op: {
          type: "revertParent",
          childId: p.id,
          role: revertAsk.role,
          parentId: revertAsk.parentId,
          changeVersion: revertAsk.changeVersion,
        },
        expectedVersion: index.snapshot.editVersion,
        actorUid: uid,
      });
      setRevertAsk(null);
      onSaved("Đã hoàn tác lần thay cha/mẹ và ghi nhật ký.", p.id);
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

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
                ) : removeAsk &&
                  removeAsk.id === x.id &&
                  removeAsk.role === x.role ? (
                  <span className="edit-note">
                    Gỡ {ROLE_LABEL[x.role].toLowerCase()} {removeAsk.name} khỏi{" "}
                    {p.name}: quan hệ được ẩn, ghi vào nhật ký và khôi phục
                    được.
                    {removeAsk.hadReplace &&
                      ` Quan hệ này có được do một lần thay trước đó; ${ROLE_LABEL[x.role].toLowerCase()} cũ chỉ đưa lại được bằng cách khôi phục quan hệ đã gỡ rồi dùng "Hoàn tác lần thay".`}
                    <span className="edit-actions">
                      <button
                        type="button"
                        className="danger"
                        ref={confirmRef}
                        disabled={busy}
                        onClick={() => void confirmRemove()}
                      >
                        {busy ? "Đang lưu…" : "Xác nhận gỡ quan hệ"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setRestoreFocus(true);
                          setRemoveAsk(null);
                        }}
                      >
                        Hủy
                      </button>
                    </span>
                  </span>
                ) : revertAsk && revertAsk.role === x.role ? (
                  <span className="edit-note">
                    Đưa {revertAsk.oldName} trở lại làm{" "}
                    {ROLE_LABEL[x.role].toLowerCase()}, thay {revertAsk.curName}
                    . Nếu loại con (nuôi/ruột) của quan hệ hiện tại đã đổi sau
                    lần thay đó, thay đổi ấy không được giữ.
                    <span className="edit-actions">
                      <button
                        type="button"
                        className="primary"
                        ref={confirmRef}
                        disabled={busy}
                        onClick={() => void confirmRevert()}
                      >
                        {busy ? "Đang lưu…" : "Xác nhận hoàn tác"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setRestoreFocus(true);
                          setRevertAsk(null);
                        }}
                      >
                        Hủy
                      </button>
                    </span>
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        props.onStart();
                        setPendingType(x.id);
                      }}
                    >
                      Đổi thành {x.adoptive ? "con ruột" : "con nuôi"}
                    </button>{" "}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void startRevert(x)}
                    >
                      Hoàn tác lần thay {ROLE_LABEL[x.role].toLowerCase()}
                    </button>{" "}
                    {x.lineage ? (
                      <span className="tree-meta">
                        Quan hệ theo dòng: chỉ thay được, không gỡ được.
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Gỡ quan hệ ${ROLE_LABEL[x.role].toLowerCase()} ${name}`}
                        onClick={() => void startRemove(x)}
                      >
                        Gỡ quan hệ
                      </button>
                    )}
                  </>
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
