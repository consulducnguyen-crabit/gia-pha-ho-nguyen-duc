// Khu "Công cụ trên máy quản trị" của #/users: lệnh gia-pha:accounts tạo theo các tài khoản đã tick ở bảng,
// mỗi dòng lệnh có nút sao chép để dán sang PowerShell chạy cho chính xác. Không gửi gì lên máy chủ.
import { useEffect, useRef, useState } from "react";
import {
  buildCommandGroups,
  PROD_PROJECT,
  type CommandGroup,
} from "./accountCommands";

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function CommandLine({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => globalThis.clearTimeout(timer.current), []);
  async function copy() {
    try {
      await globalThis.navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    globalThis.clearTimeout(timer.current);
    timer.current = globalThis.setTimeout(() => setState("idle"), 2000);
  }
  return (
    <div className="cmd-line">
      <code>{text}</code>
      <button
        type="button"
        className="cmd-copy"
        title="Sao chép lệnh"
        aria-label={`Sao chép lệnh: ${text.slice(0, 90)}`}
        onClick={() => void copy()}
      >
        {state === "copied" ? <CheckIcon /> : <CopyIcon />}
      </button>
      <span role="status" className="cmd-copy-note">
        {state === "copied"
          ? "Đã sao chép"
          : state === "failed"
            ? "Không sao chép được, hãy bôi đen và copy"
            : ""}
      </span>
    </div>
  );
}

function Group({ g, selected }: { g: CommandGroup; selected: boolean }) {
  return (
    <section className="cmd-group" aria-label={g.title}>
      <h3>{g.title}</h3>
      <p className="tree-meta">
        {g.note}
        {g.perAccount && !selected ? " Đang dùng email mẫu." : ""}
      </p>
      {g.lines.map((line) => (
        <CommandLine key={line} text={line} />
      ))}
    </section>
  );
}

export function AccountTools({ emails }: { emails: string[] }) {
  const [prod, setProd] = useState(false);
  const groups = buildCommandGroups(emails, prod);
  const selected = emails.length > 0;
  return (
    <section className="users-howto" aria-labelledby="account-tools-h">
      <h2 id="account-tools-h">Công cụ trên máy quản trị</h2>
      <p>
        Các lệnh dưới đây chạy trong PowerShell tại thư mục dự án trên máy quản
        trị (cần <b>GOOGLE_APPLICATION_CREDENTIALS</b> trỏ tới khóa để ngoài
        repo). Lệnh ghi mặc định chỉ in kế hoạch cho tới khi có <b>--apply</b>.
        Tài khoản đăng nhập bằng số điện thoại có email dạng{" "}
        <b>0914222987@gp.nguyenduc</b>.
      </p>
      <p role="status" className="cmd-selection">
        {selected
          ? `Đang tạo lệnh cho ${emails.length} tài khoản đã tick ở bảng trên.`
          : "Chưa tick tài khoản nào: lệnh dùng email mẫu. Tick tài khoản ở bảng trên để lệnh tự điền email."}
      </p>
      <label className="checkbox-field cmd-prod">
        <input
          type="checkbox"
          checked={prod}
          onChange={(e) => setProd(e.target.checked)}
        />
        Thêm cờ dữ liệu thật (production: <b>{PROD_PROJECT}</b>)
      </label>
      {groups.map((g) => (
        <Group key={g.id} g={g} selected={selected} />
      ))}
      <h3>Khi nào dùng Firebase Console</h3>
      <p>
        Console phù hợp để xem danh sách hoặc xóa tài khoản đăng nhập mồ côi (có
        trong Authentication nhưng không có hồ sơ ở đây). Console{" "}
        <b>không đặt lại được mật khẩu</b> của tài khoản số điện thoại (email
        ngầm không nhận được thư): dùng lệnh <b>reset-password</b> ở trên, hoặc
        xóa tài khoản rồi tạo lại ở khu “Tạo tài khoản”. Xóa trong Console cũng
        cần xóa hồ sơ <b>users</b> tương ứng.
      </p>
    </section>
  );
}
