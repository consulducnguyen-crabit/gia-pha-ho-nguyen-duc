import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type { BranchInfo, ClippedText } from "./branchInfo";

// Chuỗi luôn render bằng text React (tự thoát ký tự); chuỗi dài được cắt kèm nút xem đầy đủ.
function Clipped({ text }: { text: ClippedText }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className="branch-text">{open ? text.full : text.short}</span>
      {text.truncated && (
        <>
          {" "}
          <button
            type="button"
            className="link-button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Thu gọn" : "Xem đầy đủ"}
          </button>
        </>
      )}
    </>
  );
}

/** Một dòng trên hồ sơ người, ngay dưới nhãn chi. */
export function MergedFromLine({ info }: { info: BranchInfo }) {
  if (!info.mergedFrom) return null;
  return (
    <p className="tree-meta branch-merged">
      Chi này có nguồn gốc hợp nhất từ: <Clipped text={info.mergedFrom} />
    </p>
  );
}

/** Khối thông tin chi khi chọn chi ở bộ lọc cây. */
export function BranchInfoBox({ info }: { info: BranchInfo }) {
  const headingId = useId();
  return (
    <section className="branch-info" aria-labelledby={headingId}>
      <h2 id={headingId}>{info.name}</h2>
      <dl>
        <dt>Thủy tổ chi</dt>
        <dd>
          {info.founder ? (
            <Link to={`/person/${info.founder.id}`}>{info.founder.name}</Link>
          ) : (
            "Chưa ghi nhận"
          )}
        </dd>
        {info.mergedFrom && (
          <>
            <dt>Nguồn gốc hợp nhất</dt>
            <dd>
              <Clipped text={info.mergedFrom} />
            </dd>
          </>
        )}
        {info.note && (
          <>
            <dt>Ghi chú quản trị (chi)</dt>
            <dd>
              <Clipped text={info.note} />
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
