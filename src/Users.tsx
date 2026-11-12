import { useCallback, useEffect, useState } from "react";
import {
  collection,
  getDocsFromServer,
  limit,
  query,
} from "firebase/firestore";
import { db } from "./firebase";
import { formatVnTime } from "./auditView";

interface Row {
  id: string;
  displayName: string;
  email: string;
  enabled: boolean;
  admin: boolean;
  reviewer: boolean;
  approvedAt: string;
}

export function UsersPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setRows(null);
    setError("");
    try {
      const snap = await getDocsFromServer(
        query(collection(db!, "users"), limit(500)),
      );
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
              admin: data.canManageMembership === true,
              reviewer: data.canReviewChanges === true,
              approvedAt: formatVnTime(data.approvedAt),
            };
          })
          .sort((a, b) =>
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
  return (
    <>
      <h1>Quản lý tài khoản</h1>
      <p className="tree-summary">
        Danh sách tài khoản đã được cấp hoặc thu hồi quyền. Việc cấp, thu hồi
        quyền và tạo tài khoản thực hiện bằng công cụ quản trị trên máy của quản
        trị viên, không làm trên trang này.
      </p>
      {error && (
        <div role="alert" className="notice">
          {error}{" "}
          <button onClick={() => void load()} className="link-button">
            Tải lại
          </button>
        </div>
      )}
      {!error && rows === null && (
        <p role="status" className="notice">
          Đang tải danh sách tài khoản…
        </p>
      )}
      {rows && (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th scope="col">Họ tên</th>
                <th scope="col">Email</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Vai trò</th>
                <th scope="col">Cấp quyền lúc</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5}>Chưa có tài khoản nào được cấp quyền.</td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.displayName || "—"}</td>
                  <td>{r.email || "—"}</td>
                  <td>{r.enabled ? "Đang được cấp quyền" : "Đã thu hồi"}</td>
                  <td>
                    {[r.admin && "Quản trị", r.reviewer && "Duyệt thay đổi"]
                      .filter(Boolean)
                      .join(", ") || "Thành viên"}
                  </td>
                  <td>{r.approvedAt || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="users-howto">
        <h2>Cách cấp và thu hồi quyền</h2>
        <p>
          Chạy trong thư mục dự án trên máy quản trị (thêm <b>--apply</b> để
          thực hiện; không có thì chỉ chạy thử):
        </p>
        <p>
          Thành viên có Gmail (đăng nhập bằng Google, nhập đúng email Google):
        </p>
        <code>
          npm run gia-pha:accounts -- grant --email ten@gmail.com --name "Họ
          tên" --apply
        </code>
        <p>Thành viên không có Gmail (tạo tài khoản có mật khẩu):</p>
        <code>
          npm run gia-pha:accounts -- create --email ten@example.com --name "Họ
          tên" --apply
        </code>
        <p>
          Thu hồi quyền, đặt lại mật khẩu, xem danh sách đầy đủ kể cả tài khoản
          chờ duyệt:
        </p>
        <code>
          npm run gia-pha:accounts -- revoke --email ten@gmail.com --apply
        </code>
        <code>
          npm run gia-pha:accounts -- reset-password --email ten@example.com
          --apply
        </code>
        <code>npm run gia-pha:accounts -- list</code>
      </section>
    </>
  );
}
