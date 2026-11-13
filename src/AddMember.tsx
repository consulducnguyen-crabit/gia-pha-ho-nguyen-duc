// Lối vào "Thêm thành viên" (chỉ quản trị viên). Người mới luôn gắn với một người đã có (con hoặc vợ/chồng),
// vì không suy đoán quan hệ phả hệ. Trang này chỉ giúp chọn người gốc rồi mở đúng biểu mẫu sẵn có trên hồ sơ;
// việc ghi vẫn đi qua biểu mẫu thêm con / thêm vợ chồng (có kiểm tra và nhật ký).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadTreeIndex } from "./Tree";
import { yearsLabel, type TreeIndex } from "./treeModel";

const MAX_RESULTS = 30;

export function AddMemberPage({ uid }: { uid: string }) {
  const [index, setIndex] = useState<TreeIndex | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [query, setQuery] = useState("");
  useEffect(() => {
    let live = true;
    loadTreeIndex(uid, false)
      .then((i) => {
        if (!live) return;
        setIndex(i);
        setStatus("ready");
      })
      .catch(() => live && setStatus("error"));
    return () => {
      live = false;
    };
  }, [uid]);
  const results = useMemo(
    () =>
      index && query.trim() ? index.search(query).slice(0, MAX_RESULTS) : [],
    [index, query],
  );
  return (
    <>
      <p className="tree-back">
        <Link to="/tree">← Cây gia phả</Link>
      </p>
      <h1>Thêm thành viên</h1>
      <p className="tree-summary">
        Thành viên mới được gắn với một người đã có trong cây: là con hoặc là
        vợ/chồng của người đó. Tìm người gốc rồi chọn quan hệ; biểu mẫu thêm sẽ
        mở sẵn trên hồ sơ của họ. Mọi lần lưu đều được ghi nhật ký.
      </p>
      {status === "loading" && <p role="status">Đang tải cây gia phả…</p>}
      {status === "error" && (
        <p role="alert" className="notice">
          Không tải được cây gia phả. Hãy kiểm tra kết nối rồi thử lại.
        </p>
      )}
      {status === "ready" && !index && (
        <p role="status" className="notice">
          Chưa có dữ liệu cây gia phả.
        </p>
      )}
      {index && (
        <>
          <label className="add-member-search">
            Tìm người đã có trong cây
            <input
              type="search"
              className="form-field"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Không cần gõ dấu"
              autoFocus
            />
          </label>
          {query.trim() && results.length === 0 && (
            <p role="status" className="tree-meta">
              Không tìm thấy người phù hợp.
            </p>
          )}
          <ul className="add-member-list">
            {results.map((p) => (
              <li key={p.id}>
                <span className="add-member-name">
                  <b>{p.name}</b>{" "}
                  <span className="tree-meta">
                    {yearsLabel(p)}
                    {p.generation !== null && ` · Đời ${p.generation}`}
                  </span>
                </span>
                <span className="edit-actions">
                  <Link
                    className="link-button"
                    to={`/person/${p.id}?add=child`}
                  >
                    Thêm con
                  </Link>
                  <Link
                    className="link-button"
                    to={`/person/${p.id}?add=spouse`}
                  >
                    Thêm vợ/chồng
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
