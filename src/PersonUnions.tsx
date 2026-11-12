// Quản trị quan hệ vợ/chồng của một người: gỡ liên kết nhập sai. Chỉ quản trị viên thấy.
// Khôi phục liên kết đã gỡ làm ở "Thêm vợ/chồng" (SpousePanel) vì lúc đó người kia không còn trong danh sách vợ/chồng.
import { useEffect, useId, useRef, useState } from "react";
import { db } from "./firebase";
import { commitUnion } from "./editClient";
import { removalImpact } from "./editUnion";
import { saveErrorMessage } from "./editForm";
import type { SnapPerson, TreeIndex } from "./treeModel";

interface Props {
  index: TreeIndex;
  p: SnapPerson;
  uid: string;
  onSaved: (message: string, focusId: string) => void;
  onReload: () => void;
  /** Gọi khi bắt đầu một thao tác mới (xóa thông báo đã lưu của lần trước). */
  onStart: () => void;
}

export function PersonUnions(props: Props) {
  const { index, p, uid, onSaved, onReload } = props;
  const uniq = useId();
  const [askId, setAskId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [confirmError, setConfirmError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkRef = useRef<HTMLInputElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const spouses = index.spouses(p.id);
  const name = (id: string) => index.snapshot.persons.get(id)?.name ?? id;
  useEffect(() => {
    if (askId) checkRef.current?.focus();
  }, [askId]);
  useEffect(() => {
    if (!askId && restoreFocus) {
      headingRef.current?.focus();
      setRestoreFocus(false);
    }
  }, [askId, restoreFocus]);
  if (spouses.length === 0) return null;

  async function submit(spouseId: string) {
    if (!confirm) {
      setConfirmError(true);
      checkRef.current?.focus();
      return;
    }
    props.onStart();
    setBusy(true);
    setError(null);
    try {
      const result = await commitUnion(db!, {
        op: { type: "removeUnion", personId: p.id, spouseId, confirm: true },
        expectedVersion: index.snapshot.editVersion,
        actorUid: uid,
      });
      setAskId(null);
      onSaved(
        `Đã gỡ liên kết vợ/chồng giữa ${p.name} và ${name(spouseId)} (lần gỡ số ${result.nextVersion}). Để khôi phục, mở "Thêm vợ/chồng", chọn "Người đã có trong cây" rồi chọn lại đúng người này.`,
        p.id,
      );
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="edit-panel" aria-label="Quản trị quan hệ vợ chồng">
      <h2 tabIndex={-1} ref={headingRef}>
        Quan hệ vợ/chồng (quản trị)
      </h2>
      <p className="tree-meta">
        Gỡ liên kết vợ/chồng nhập nhầm. Liên kết được ẩn, không xóa hẳn, ghi vào
        nhật ký và khôi phục được; hai người vẫn còn trong cây.
      </p>
      <ul className="tree-links">
        {spouses.map((sid) => {
          const asking = askId === sid;
          const impact = asking ? removalImpact(index, p.id, sid) : null;
          return (
            <li key={sid}>
              {name(sid)}{" "}
              {!asking && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Gỡ liên kết vợ/chồng với ${name(sid)}`}
                  onClick={() => {
                    props.onStart();
                    setError(null);
                    setConfirm(false);
                    setConfirmError(false);
                    setAskId(sid);
                  }}
                >
                  Gỡ liên kết
                </button>
              )}
              {asking && impact && (
                <div className="edit-note">
                  <span id={`${uniq}-warn`}>
                    Gỡ liên kết vợ/chồng giữa {p.name} và {name(sid)}.
                    {impact.commonChildren > 0 && (
                      <span className="edit-note">
                        Hai người có {impact.commonChildren} con chung; quan hệ
                        cha/mẹ–con không bị đổi.
                      </span>
                    )}
                    {impact.orphaned.map((id) => (
                      <span className="edit-note" key={id}>
                        {name(id)} sẽ không còn nối với ai trong cây (không cha
                        mẹ, con hay vợ/chồng khác). Nếu người này nhập nhầm, có
                        thể ẩn bằng "Ẩn người này khỏi cây" ở hồ sơ của họ.
                      </span>
                    ))}
                  </span>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      ref={checkRef}
                      checked={confirm}
                      onChange={(e) => {
                        setConfirm(e.target.checked);
                        setConfirmError(false);
                      }}
                      aria-invalid={confirmError ? true : undefined}
                      aria-describedby={
                        confirmError
                          ? `${uniq}-warn ${uniq}-confirm-err`
                          : `${uniq}-warn`
                      }
                    />
                    Tôi xác nhận gỡ liên kết vợ/chồng này.
                  </label>
                  {confirmError && (
                    <span
                      id={`${uniq}-confirm-err`}
                      role="alert"
                      className="edit-error"
                    >
                      Hãy tích xác nhận để gỡ liên kết.
                    </span>
                  )}
                  <span className="edit-actions">
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() => void submit(sid)}
                    >
                      {busy ? "Đang lưu…" : "Xác nhận gỡ liên kết"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setRestoreFocus(true);
                        setAskId(null);
                      }}
                    >
                      Hủy
                    </button>
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <div role="alert" className="notice">
          {error}{" "}
          <button type="button" className="link-button" onClick={onReload}>
            Tải lại hồ sơ
          </button>
        </div>
      )}
    </section>
  );
}
