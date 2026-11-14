// Tab "Danh sách thành viên" của trang cây: xếp theo tên → tên đệm → chi → đời (xem memberListModel.ts).
// Chỉ đọc ảnh chụp cây đã có trong bộ nhớ; không thêm dữ liệu, không ghi gì.
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { normalizeName } from "./domain";
import { sortMembers } from "./memberListModel";
import { PersonNameLink } from "./PersonNameLink";
import type { Category, SnapPerson, Snapshot } from "./treeModel";

export function MemberList({
  snapshot,
  renderMeta,
}: {
  snapshot: Snapshot;
  /** Phần phụ sau họ tên (năm, đời, chi, nhãn), do trang cây cung cấp để dùng chung kiểu hiển thị. */
  renderMeta: (p: SnapPerson) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [category, setCategory] = useState<"" | Category>("");
  const rows = useMemo(
    () => sortMembers(snapshot.persons.values(), snapshot.branches),
    [snapshot],
  );
  const key = normalizeName(query);
  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!category || r.person.category === category) &&
          (!branch || r.person.branch === branch) &&
          (!key || r.person.normalized.includes(key)),
      ),
    [rows, key, branch, category],
  );
  const groups = useMemo(() => {
    const out: { name: string; items: typeof shown }[] = [];
    for (const r of shown) {
      const last = out[out.length - 1];
      if (last && last.name === r.group) last.items.push(r);
      else out.push({ name: r.group, items: [r] });
    }
    return out;
  }, [shown]);
  return (
    <>
      <div className="tree-toolbar">
        <label>
          Tìm theo tên
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Không cần gõ dấu"
            className="form-field"
          />
        </label>
        <label>
          Xem theo chi
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="form-field"
          >
            <option value="">Toàn họ</option>
            {snapshot.branches.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nhóm
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as "" | Category)}
            className="form-field"
          >
            <option value="">Tất cả</option>
            <option value="CLAN">Thuộc dòng họ</option>
            <option value="SPOUSE">Người kết hôn vào</option>
            <option value="EXTERNAL">Họ ngoại</option>
          </select>
        </label>
      </div>
      <p className="tree-summary" role="status">
        {shown.length === rows.length
          ? `${rows.length} thành viên`
          : `${shown.length} / ${rows.length} thành viên`}
        . Xếp theo tên, rồi tên đệm, chi và đời.
      </p>
      {groups.length === 0 ? (
        <p role="status" className="notice">
          Không tìm thấy thành viên phù hợp.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.name} className="member-group">
            <h2>{g.name}</h2>
            <ul className="member-list">
              {g.items.map((r) => (
                <li key={r.person.id}>
                  <PersonNameLink p={r.person} /> {renderMeta(r.person)}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
