// Cảnh báo (không chặn) khi họ tên trùng người khác cùng đời; chỉ hiển thị, không ghi gì.
import { Link } from "react-router-dom";
import { yearsLabel, type SnapPerson } from "./treeModel";

export function DuplicateNote({
  people,
  nameChanged,
  willFlag = false,
}: {
  people: SnapPerson[];
  nameChanged: boolean;
  /** Khi đúng, nói rõ cờ "Trùng họ tên" sẽ được tự gắn khi lưu. */
  willFlag?: boolean;
}) {
  if (!people.length) return null;
  const shown = people.slice(0, 5);
  return (
    <span className="edit-note" role="status">
      Đã có {people.length} người khác trùng họ tên và cùng đời:{" "}
      {shown.map((x, i) => (
        <span key={x.id}>
          {i > 0 && ", "}
          <Link to={`/person/${x.id}`}>
            {x.name} {yearsLabel(x)}
          </Link>
        </span>
      ))}
      {people.length > shown.length && ", …"}.{" "}
      {nameChanged || willFlag
        ? "Khi lưu, hồ sơ này được tự gắn cờ “Trùng họ tên” để phân biệt; người trùng kia không bị đổi."
        : "Hai người này có thể là một người hoặc hai người khác nhau; hãy đối chiếu tài liệu gốc."}
    </span>
  );
}
