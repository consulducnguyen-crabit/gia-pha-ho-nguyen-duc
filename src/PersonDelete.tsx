// Ẩn người khỏi cây (xóa mềm) và khôi phục — chỉ quản trị viên thấy; ghi qua commitDelete (lô nguyên tử có nhật ký).
import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "./firebase";
import { commitDelete } from "./editClient";
import { MAX_UNIONS } from "./editDelete";
import { EditError } from "./editCore";
import { saveErrorMessage } from "./editForm";
import { AddPanel } from "./PersonAdd";
import type { SnapPerson, TreeIndex } from "./treeModel";

interface Props {
  index: TreeIndex;
  p: SnapPerson;
  uid: string;
  onSaved: (message: string, focusId: string) => void;
  onReload: () => void;
  onStart: () => void;
}

function usePanel(
  props: Props,
  run: () => Promise<{ message: string; focusId: string; go?: string }>,
  close: () => void,
) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const navigate = useNavigate();
  async function submit() {
    setBusy(true);
    setSaveError(null);
    setConflict(false);
    try {
      const r = await run();
      close();
      props.onSaved(r.message, r.focusId);
      if (r.go) navigate(r.go);
    } catch (error) {
      setSaveError(saveErrorMessage(error));
      setConflict(
        error instanceof EditError && error.code === "VERSION_CONFLICT",
      );
    } finally {
      setBusy(false);
    }
  }
  return { busy, saveError, conflict, submit };
}

function HidePanel(props: Props & { close: () => void }) {
  const { index, p, uid, close } = props;
  const uniq = useId();
  const [confirm, setConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const children = index.children(p.id).length;
  const spouseNames = index
    .spouses(p.id)
    .map((id) => index.snapshot.persons.get(id)?.name ?? id);
  const panel = usePanel(
    props,
    async () => {
      const result = await commitDelete(db!, {
        op: { type: "deletePerson", personId: p.id, confirm: true },
        expectedVersion: index.snapshot.editVersion,
        actorUid: uid,
      });
      // Sau khi ẩn, chuyển tới cha/mẹ hoặc vợ/chồng để người dùng không ở trang người đã biến mất.
      const next =
        index.parents(p.id)[0]?.id ?? index.spouses(p.id)[0] ?? index.root;
      return {
        message: `Đã ẩn ${p.name} khỏi cây. Để khôi phục, nhập mã ${p.id} và số ${result.nextVersion} ở mục "Khôi phục người đã ẩn".`,
        focusId: next ?? "",
        go: next ? `/person/${next}` : "/tree",
      };
    },
    close,
  );
  return (
    <AddPanel
      title="Ẩn người này khỏi cây"
      hint="Không xóa hẳn: người này được ẩn khỏi cây và khỏi thành viên, nhật ký giữ đủ dữ liệu để khôi phục. Chỉ ẩn được người không còn con, không phải người sáng lập chi."
      busy={panel.busy}
      saveError={panel.saveError}
      conflict={panel.conflict}
      errors={errors}
      onReload={props.onReload}
      onCancel={close}
      onSubmit={() => {
        if (children > 0) {
          setErrors({
            confirm: `Người này còn ${children} con; hãy đổi cha/mẹ của các con trước.`,
          });
          return;
        }
        if (spouseNames.length > MAX_UNIONS) {
          setErrors({
            confirm: `Người này có ${spouseNames.length} vợ/chồng; chỉ ẩn được tối đa ${MAX_UNIONS}.`,
          });
          return;
        }
        if (!confirm) {
          setErrors({ confirm: "Hãy tích xác nhận để ẩn người này." });
          return;
        }
        setErrors({});
        void panel.submit();
      }}
    >
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={confirm}
          onChange={(e) => setConfirm(e.target.checked)}
          aria-invalid={errors.confirm ? true : undefined}
          aria-describedby={errors.confirm ? `${uniq}-err` : undefined}
        />
        Tôi xác nhận ẩn {p.name} (cùng quan hệ cha/mẹ và vợ/chồng của người này)
        khỏi cây.
        {spouseNames.length > 1 && (
          <span className="edit-note">
            Sẽ ẩn {spouseNames.length} quan hệ vợ/chồng với:{" "}
            {spouseNames.join(", ")}. Khôi phục sẽ đưa lại đủ.
          </span>
        )}
        {errors.confirm && (
          <span id={`${uniq}-err`} role="alert" className="edit-error">
            {errors.confirm}
          </span>
        )}
      </label>
    </AddPanel>
  );
}

function RestorePanel(props: Props & { close: () => void }) {
  const { index, uid, close } = props;
  const uniq = useId();
  const [text, setText] = useState("");
  const [pid, setPid] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const version = /^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : 0;
  const panel = usePanel(
    props,
    async () => {
      const personId = pid.trim();
      const result = await commitDelete(db!, {
        op: { type: "restorePerson", personId, deleteVersion: version },
        expectedVersion: index.snapshot.editVersion,
        actorUid: uid,
      });
      return {
        message: "Đã khôi phục người đã ẩn và ghi nhật ký.",
        focusId: result.focusId ?? personId,
        go: `/person/${personId}`,
      };
    },
    close,
  );
  return (
    <AddPanel
      title="Khôi phục người đã ẩn"
      hint="Nhập mã người (dạng p-… hoặc mã trong dữ liệu) và số ghi trong thông báo khi ẩn (số phiên bản nhật ký). Cha/mẹ và vợ/chồng của người đó phải đang có trong cây."
      busy={panel.busy}
      saveError={panel.saveError}
      conflict={panel.conflict}
      errors={errors}
      onReload={props.onReload}
      onCancel={close}
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(pid.trim()))
          e.pid = "Nhập mã người hợp lệ.";
        if (!version) e.version = "Nhập số phiên bản là số nguyên dương.";
        setErrors(e);
        if (Object.keys(e).length) return;
        void panel.submit();
      }}
    >
      <label>
        Mã người cần khôi phục
        <input
          className="form-field"
          value={pid}
          onChange={(e) => setPid(e.target.value.trim())}
          aria-invalid={errors.pid ? true : undefined}
          aria-describedby={errors.pid ? `${uniq}-pid` : undefined}
        />
        {errors.pid && (
          <span id={`${uniq}-pid`} role="alert" className="edit-error">
            {errors.pid}
          </span>
        )}
      </label>
      <label>
        Số phiên bản nhật ký của lần ẩn
        <input
          className="form-field"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={errors.version ? true : undefined}
          aria-describedby={errors.version ? `${uniq}-ver` : undefined}
        />
        {errors.version && (
          <span id={`${uniq}-ver`} role="alert" className="edit-error">
            {errors.version}
          </span>
        )}
      </label>
    </AddPanel>
  );
}

export function PersonDelete(props: Props) {
  const [mode, setMode] = useState<"hide" | "restore" | null>(null);
  const close = () => setMode(null);
  if (mode === "hide") return <HidePanel {...props} close={close} />;
  if (mode === "restore") return <RestorePanel {...props} close={close} />;
  return (
    <p className="edit-actions">
      <button
        type="button"
        onClick={() => {
          props.onStart();
          setMode("hide");
        }}
      >
        Ẩn người này khỏi cây
      </button>
      <button
        type="button"
        onClick={() => {
          props.onStart();
          setMode("restore");
        }}
      >
        Khôi phục người đã ẩn
      </button>
    </p>
  );
}
