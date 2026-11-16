import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  query,
} from "firebase/firestore";
import { db } from "./firebase";
import { AccountTools } from "./AccountTools";
import { CreateAccountSection } from "./CreateAccount";
import {
  listGmailGrants,
  revokeGmailGrant,
  type PendingGrant,
} from "./gmailGrant";
import { emailToPhone } from "./phoneLogin";
import { formatVnTime } from "./auditView";
import {
  accountErrorMessage,
  AccountError,
  ledgerShapeOk,
  updateAccount,
  validateAccountName,
  type AccountPatch,
  type Ledger,
} from "./accountsClient";

interface Row {
  id: string;
  displayName: string;
  email: string;
  enabled: boolean;
  admin: boolean;
  reviewer: boolean;
  approvedAt: string;
}

const LEDGER_HELP =
  "Sổ quản trị chưa được khởi tạo hoặc đang lệch; chạy gia-pha:accounts registry --rebuild.";

function roleLabel(r: Row) {
  return (
    [r.admin ? "Quản trị" : "Chỉ xem", r.reviewer && "Duyệt thay đổi"]
      .filter(Boolean)
      .join(", ") || "Chỉ xem"
  );
}

export function UsersPage({ uid }: { uid: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [grants, setGrants] = useState<PendingGrant[]>([]);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const allBox = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [done, setDone] = useState("");
  const doneRef = useRef<HTMLParagraphElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const load = useCallback(async () => {
    setRows(null);
    setError("");
    try {
      const snap = await getDocsFromServer(
        query(collection(db!, "users"), limit(500)),
      );
      // Sổ quản trị không đọc được/không hợp lệ => coi như thiếu (nút sửa bị khóa, có cảnh báo).
      const ledgerData = await getDocFromServer(
        doc(db!, "accessControl", "admins"),
      )
        .then((s) => (s.exists() ? s.data() : null))
        .catch(() => null);
      setLedger(ledgerShapeOk(ledgerData) ? ledgerData : null);
      setGrants(await listGmailGrants(db!).catch(() => []));
      setRows(
        snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              displayName:
                typeof data.displayName === "string" ? data.displayName : "",
              email: typeof data.email === "string" ? data.email : "",
              enabled: data.enabled === true,
              admin: data.enabled === true && data.canManageMembership === true,
              reviewer: data.canReviewChanges === true,
              approvedAt: formatVnTime(data.approvedAt),
            };
          })
          // Tài khoản đang cấp quyền trước, tài khoản bị vô hiệu hóa dồn xuống cuối để dễ nhìn; mỗi nhóm theo tên.
          .sort(
            (a, b) =>
              Number(b.enabled) - Number(a.enabled) ||
              (a.displayName || a.email).localeCompare(
                b.displayName || b.email,
                "vi",
              ),
          ),
      );
    } catch {
      setError(
        "Không tải được danh sách tài khoản. Chỉ quản trị viên được xem; hãy kiểm tra quyền và thử lại.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  // Bỏ tick của tài khoản không còn trong danh sách (sau khi tải lại).
  useEffect(() => {
    if (!rows) return;
    const ids = new Set(rows.map((r) => r.id));
    setPicked((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);
  const pickedRows = (rows ?? []).filter((r) => picked.has(r.id));
  const allPicked =
    !!rows && rows.length > 0 && pickedRows.length === rows.length;
  useEffect(() => {
    if (allBox.current)
      allBox.current.indeterminate = pickedRows.length > 0 && !allPicked;
  }, [pickedRows.length, allPicked]);
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const ledgerReady = !!ledger && ledger.adminUids.includes(uid);
  // Lệch nhẹ: có người là quản trị viên hiệu lực nhưng không có trong sổ, hoặc ngược lại.
  const drift =
    ledgerReady &&
    !!ledger &&
    !!rows &&
    (rows.some(
      (r) => r.enabled && r.admin && !ledger.adminUids.includes(r.id),
    ) ||
      ledger.adminUids.some((u) => {
        const r = rows.find((x) => x.id === u);
        return !r || !(r.enabled && r.admin);
      }));
  const editRow = rows?.find((r) => r.id === editing) ?? null;
  return (
    <>
      <h1>Quản lý tài khoản</h1>
      {done && (
        <p role="status" className="notice" tabIndex={-1} ref={doneRef}>
          {done}
        </p>
      )}
      {error && (
        <div role="alert" className="notice">
          {error}{" "}
          <button onClick={() => void load()} className="link-button">
            Tải lại
          </button>
        </div>
      )}
      {rows && !ledgerReady && (
        <div role="alert" className="notice">
          {LEDGER_HELP} Trong lúc này các nút sửa bị khóa.
        </div>
      )}
      {drift && (
        <div role="alert" className="notice">
          Sổ quản trị đang lệch với danh sách tài khoản; nếu việc sửa quyền bị
          từ chối, chạy gia-pha:accounts registry --rebuild.
        </div>
      )}
      {!error && rows === null && (
        <p role="status" className="notice">
          Đang tải danh sách tài khoản…
        </p>
      )}
      {rows && (
        <div className="users-table-wrap">
          <table className="users-table users-table-accounts">
            <caption className="sr-only">
              Danh sách tài khoản đã được cấp hoặc vô hiệu hóa quyền; tài khoản
              vô hiệu hóa xếp cuối
            </caption>
            <thead>
              <tr>
                <th scope="col" className="users-check">
                  <input
                    ref={allBox}
                    type="checkbox"
                    checked={allPicked}
                    disabled={rows.length === 0}
                    aria-label="Chọn hoặc bỏ chọn tất cả tài khoản"
                    onChange={() =>
                      setPicked(
                        allPicked ? new Set() : new Set(rows.map((r) => r.id)),
                      )
                    }
                  />
                </th>
                <th scope="col">Họ tên</th>
                <th scope="col">Số điện thoại / Email</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Vai trò</th>
                <th scope="col">Cấp quyền lúc</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7}>Chưa có tài khoản nào được cấp quyền.</td>
                </tr>
              )}
              {rows.map((r) => {
                const self = r.id === uid;
                const label = r.displayName || r.email || r.id;
                return (
                  <tr
                    key={r.id}
                    className={r.enabled ? undefined : "users-row-off"}
                  >
                    <td className="users-check">
                      <input
                        type="checkbox"
                        checked={picked.has(r.id)}
                        aria-label={`Chọn tài khoản ${label}`}
                        onChange={() => toggle(r.id)}
                      />
                    </td>
                    <td>{r.displayName || "—"}</td>
                    <td>{emailToPhone(r.email) ?? (r.email || "—")}</td>
                    <td>{r.enabled ? "Đang cấp quyền" : "Đã vô hiệu hóa"}</td>
                    <td>{roleLabel(r)}</td>
                    <td>{r.approvedAt || "—"}</td>
                    <td>
                      <button
                        type="button"
                        ref={(el) => {
                          editButtons.current.set(r.id, el);
                        }}
                        aria-label={`Sửa tài khoản ${label}`}
                        disabled={self || !ledgerReady}
                        onClick={() => {
                          setDone("");
                          setEditing(r.id);
                        }}
                      >
                        Sửa
                      </button>
                      {self && (
                        <span className="users-self-note">
                          Không tự đổi quyền của chính mình
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editRow && ledgerReady && (
        <AccountPanel
          key={editRow.id}
          row={editRow}
          uid={uid}
          onCancel={() => {
            setEditing(null);
            // Trả focus về nút "Sửa" của dòng vừa đóng.
            editButtons.current.get(editRow.id)?.focus();
          }}
          onConflict={(message) => {
            setEditing(null);
            setDone(message);
            void load();
          }}
          onDone={(message) => {
            setEditing(null);
            setDone(message);
            void load();
          }}
        />
      )}
      {grants.length > 0 && (
        <section className="users-grants" aria-labelledby="grants-h">
          <h2 id="grants-h">Gmail đã ghi sẵn quyền, chờ đăng nhập lần đầu</h2>
          <ul>
            {grants.map((g) => (
              <li key={g.email}>
                {g.displayName ? `${g.displayName} · ` : ""}
                {g.email}{" "}
                {revoking === g.email ? (
                  <span role="group" aria-label={`Xác nhận thu hồi ${g.email}`}>
                    Thu hồi quyền của {g.email}?{" "}
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        setDone("");
                        setRevoking(null);
                        void revokeGmailGrant(db!, g.email)
                          .then(() => {
                            setDone(`Đã thu hồi quyền ghi sẵn cho ${g.email}.`);
                            return load();
                          })
                          .catch(() =>
                            setError("Không thu hồi được. Thử lại sau."),
                          );
                      }}
                    >
                      Xác nhận thu hồi
                    </button>{" "}
                    <button type="button" onClick={() => setRevoking(null)}>
                      Không thu hồi
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Thu hồi quyền ghi sẵn cho ${g.email}`}
                    onClick={() => setRevoking(g.email)}
                  >
                    Thu hồi
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <CreateAccountSection
        enabled={ledgerReady}
        uid={uid}
        existingEmails={
          new Set(
            [...(rows ?? []).map((r) => r.email), ...grants.map((g) => g.email)]
              .map((e) => e.toLowerCase())
              .filter(Boolean),
          )
        }
        onCreated={() => void load()}
      />
      <AccountTools emails={pickedRows.map((r) => r.email).filter(Boolean)} />
    </>
  );
}

function AccountPanel(props: {
  row: Row;
  uid: string;
  onCancel: () => void;
  onDone: (message: string) => void;
  onConflict: (message: string) => void;
}) {
  const { row, uid } = props;
  const uniq = useId();
  const [name, setName] = useState(row.displayName);
  const [admin, setAdmin] = useState(row.admin);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const errRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    headRef.current?.focus();
    headRef.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  useEffect(() => {
    if (err) errRef.current?.focus();
  }, [err]);
  const label = row.displayName || row.email || row.id;

  async function run(patch: AccountPatch, success: string) {
    setBusy(true);
    setErr("");
    try {
      await updateAccount(db!, uid, row.id, patch);
      props.onDone(success);
    } catch (error) {
      if (error instanceof AccountError && error.code === "CONFLICT") {
        props.onConflict(error.message);
        return;
      }
      setErr(accountErrorMessage(error));
      setBusy(false);
    }
  }
  return (
    <section className="edit-panel users-panel" aria-labelledby={`${uniq}-h`}>
      <h2 id={`${uniq}-h`} tabIndex={-1} ref={headRef}>
        Sửa tài khoản: {label}
      </h2>
      <p className="tree-meta">
        {row.email || "Chưa có email"} ·{" "}
        {row.enabled ? "Đang cấp quyền" : "Đã vô hiệu hóa"}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const patch: AccountPatch = {};
          setNameErr("");
          if (name.trim() !== row.displayName.trim()) {
            // Kiểm tên bằng đúng cách đếm ký tự của rules (code point), lỗi hiện gần ô nhập.
            try {
              patch.displayName = validateAccountName(name);
            } catch (error) {
              setNameErr((error as Error).message);
              return;
            }
          }
          if (row.enabled && admin !== row.admin) patch.admin = admin;
          void run(patch, `Đã lưu thay đổi cho ${label}.`);
        }}
      >
        <label>
          Tên hiển thị
          <input
            className="form-field"
            value={name}
            disabled={busy}
            aria-invalid={nameErr ? true : undefined}
            aria-describedby={nameErr ? `${uniq}-name-err` : undefined}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {nameErr && (
          <span id={`${uniq}-name-err`} role="alert" className="edit-error">
            {nameErr}
          </span>
        )}
        <fieldset className="proposal-fields" disabled={!row.enabled || busy}>
          <legend>Quyền</legend>
          <label className="checkbox-field">
            <input
              type="radio"
              name={`${uniq}-role`}
              checked={!admin}
              onChange={() => setAdmin(false)}
            />
            Chỉ xem
          </label>
          <label className="checkbox-field">
            <input
              type="radio"
              name={`${uniq}-role`}
              checked={admin}
              onChange={() => setAdmin(true)}
            />
            Quản trị
          </label>
          {!row.enabled && (
            <span className="tree-meta">
              Tài khoản đã vô hiệu hóa; bật lại trước khi đổi quyền.
            </span>
          )}
        </fieldset>
        {err && (
          <p
            role="alert"
            className="notice edit-form-error"
            tabIndex={-1}
            ref={errRef}
          >
            {err}
          </p>
        )}
        <div className="edit-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu thay đổi"}
          </button>
          <button type="button" disabled={busy} onClick={props.onCancel}>
            Hủy
          </button>
        </div>
      </form>
      <div className="users-danger-zone">
        <h3>{row.enabled ? "Vô hiệu hóa tài khoản" : "Bật lại tài khoản"}</h3>
        {row.enabled && !confirmOff && (
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => setConfirmOff(true)}
          >
            Vô hiệu hóa
          </button>
        )}
        {row.enabled && confirmOff && (
          <div role="group" aria-label="Xác nhận vô hiệu hóa">
            <p>
              Người này <b>mất quyền truy cập ngay</b> (không xem được dữ liệu
              gia phả){row.admin ? ", đồng thời mất quyền Quản trị" : ""}. Có
              thể bật lại sau. Muốn xóa hẳn tài khoản (không hoàn tác) hãy dùng
              lệnh gia-pha:accounts delete sau khi đã vô hiệu hóa.
            </p>
            <div className="edit-actions">
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() =>
                  void run({ enabled: false }, `Đã vô hiệu hóa ${label}.`)
                }
              >
                Xác nhận vô hiệu hóa
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmOff(false)}
              >
                Không vô hiệu hóa
              </button>
            </div>
          </div>
        )}
        {!row.enabled && (
          <>
            <p>
              Bật lại cho người này xem dữ liệu gia phả với quyền Chỉ xem. Muốn
              cấp quyền Quản trị, đổi sau khi bật lại.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run({ enabled: true }, `Đã bật lại ${label}.`)
              }
            >
              Bật lại
            </button>
          </>
        )}
      </div>
    </section>
  );
}
