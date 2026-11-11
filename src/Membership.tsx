import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { emulator, membershipFunctions } from "./firebase";

async function call<Request, Response>(name: string, data: Request) {
  if (!emulator || !membershipFunctions)
    throw new Error("Chức năng chỉ có trong emulator.");
  return (
    await httpsCallable<Request, Response>(membershipFunctions, name)(data)
  ).data;
}
function message(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : "";
  if (code === "functions/permission-denied")
    return "Không thể thực hiện. Kiểm tra quyền tài khoản và email đã xác minh.";
  if (code === "functions/unauthenticated") return "Vui lòng đăng nhập lại.";
  if (code === "functions/failed-precondition")
    return "Yêu cầu chưa hợp lệ. Lời mời có thể đã hết hạn, đã dùng hoặc quyền tài khoản đã thay đổi.";
  if (code === "functions/already-exists")
    return "Tài khoản đã được cấp quyền.";
  if (code === "functions/not-found") return "Không tìm thấy lời mời.";
  if (code === "functions/invalid-argument")
    return "Kiểm tra thông tin đã nhập và thử lại.";
  return "Không thể hoàn tất yêu cầu. Kiểm tra kết nối và thử lại.";
}
function useTask() {
  const live = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await task();
    } catch (error) {
      if (live.current) setError(message(error));
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return { busy, error, status, run, live, setStatus };
}

export function AcceptInvitation() {
  const [token, setToken] = useState("");
  const task = useTask();
  if (!emulator) return null;
  return (
    <section className="notice">
      <h3>Nhận lời mời</h3>
      <p>
        Dùng mã lời mời dành cho tài khoản đang đăng nhập. Email của tài khoản
        cần được xác minh trước khi nhận quyền.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const submitted = token.trim();
          void task.run(async () => {
            await call<{ token: string }, { accepted: boolean }>(
              "acceptInvitation",
              { token: submitted },
            );
            if (task.live.current) {
              setToken("");
              task.setStatus("Đã nhận lời mời. Đang kiểm tra quyền truy cập…");
            }
          });
        }}
      >
        <label>
          Mã lời mời
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
            disabled={task.busy}
          />
        </label>
        <button className="primary" disabled={task.busy}>
          {task.busy ? "Đang xác nhận…" : "Nhận lời mời"}
        </button>
      </form>
      {task.error && <p role="alert">{task.error}</p>}
      {task.status && <p role="status">{task.status}</p>}
    </section>
  );
}

export function MembershipAdmin() {
  const [email, setEmail] = useState("");
  const [invitationId, setInvitationId] = useState("");
  const [targetUid, setTargetUid] = useState("");
  const [issued, setIssued] = useState<{
    invitationId: string;
    token: string;
  } | null>(null);
  const disableRequest = useRef<{
    targetUid: string;
    requestId: string;
  } | null>(null);
  const task = useTask();
  if (!emulator) return null;
  return (
    <>
      <div className="eyebrow">QUẢN LÝ QUYỀN TRUY CẬP</div>
      <h1>Tài khoản và lời mời</h1>
      <div className="notice">
        Bản thử nghiệm cục bộ, chỉ dùng tài khoản giả. Chỉ cấp quyền thành viên;
        chưa mở quản trị production.
      </div>
      {task.error && <p role="alert">{task.error}</p>}
      {task.status && <p role="status">{task.status}</p>}
      <section className="detail">
        <h2>Tạo lời mời</h2>
        <p>
          Nhập email của tài khoản đăng nhập đã có sẵn. Lời mời dùng một lần, có
          hiệu lực 48 giờ trong bản thử nghiệm.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setIssued(null);
            const submitted = email.trim();
            void task.run(async () => {
              const result = await call<
                { email: string },
                { invitationId: string; token: string }
              >("createInvitation", { email: submitted });
              if (task.live.current) {
                setIssued(result);
                task.setStatus("Đã tạo lời mời. Chưa gửi email.");
              }
            });
          }}
        >
          <label>
            Email người được mời
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={task.busy}
              autoComplete="off"
            />
          </label>
          <p>
            <button className="primary" disabled={task.busy}>
              Tạo lời mời
            </button>
          </p>
        </form>
        {issued && (
          <div className="notice">
            <p>
              Mã nhận quyền chỉ hiển thị tại đây trong phiên này. Giữ kín mã và
              không đưa vào URL hoặc nhật ký.
            </p>
            <label>
              Mã nhận quyền
              <input
                readOnly
                value={issued.token}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              Mã quản lý lời mời
              <input
                readOnly
                value={issued.invitationId}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <p>
              <button onClick={() => setIssued(null)}>Ẩn mã lời mời</button>
            </p>
          </div>
        )}
      </section>
      <section className="detail">
        <h2>Thu hồi lời mời</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const submitted = invitationId.trim();
            if (
              task.busy ||
              !window.confirm(
                `Thu hồi lời mời ${submitted}? Người nhận sẽ không còn dùng được mã này.`,
              )
            )
              return;
            void task.run(async () => {
              const result = await call<
                { invitationId: string },
                { changed: boolean }
              >("revokeInvitation", { invitationId: submitted });
              if (task.live.current) {
                if (issued?.invitationId === submitted) setIssued(null);
                task.setStatus(
                  result.changed
                    ? "Đã thu hồi lời mời."
                    : "Lời mời không còn ở trạng thái chờ nhận.",
                );
              }
            });
          }}
        >
          <label>
            Mã lời mời cần thu hồi
            <input
              value={invitationId}
              onChange={(event) => setInvitationId(event.target.value)}
              required
              disabled={task.busy}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p>
            <button className="danger" disabled={task.busy}>
              Thu hồi lời mời
            </button>
          </p>
        </form>
      </section>
      <section className="detail">
        <h2>Thu hồi quyền thành viên</h2>
        <p>
          Tài khoản sẽ không còn được đọc dữ liệu gia phả. Thao tác cũng vô hiệu
          hóa lời mời cũ của tài khoản đó.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const submitted = targetUid.trim();
            if (
              task.busy ||
              !window.confirm(
                `Thu hồi quyền thành viên của tài khoản ${submitted}? Tài khoản sẽ không đọc được dữ liệu gia phả; các lời mời cũ sẽ mất hiệu lực.`,
              )
            )
              return;
            if (disableRequest.current?.targetUid !== submitted)
              disableRequest.current = {
                targetUid: submitted,
                requestId: crypto.randomUUID(),
              };
            const request = disableRequest.current;
            void task.run(async () => {
              const result = await call<
                { targetUid: string; requestId: string },
                { changed: boolean }
              >("disableMembership", request);
              if (task.live.current) {
                disableRequest.current = null;
                task.setStatus(
                  result.changed
                    ? "Đã thu hồi quyền thành viên."
                    : "Yêu cầu trước đã được xử lý; quyền hiện tại có thể đã thay đổi. Gửi yêu cầu mới nếu cần thu hồi lại.",
                );
              }
            });
          }}
        >
          <label>
            UID tài khoản cần thu hồi
            <input
              value={targetUid}
              onChange={(event) => setTargetUid(event.target.value)}
              required
              disabled={task.busy}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p>
            <button className="danger" disabled={task.busy}>
              Thu hồi quyền thành viên
            </button>
          </p>
        </form>
      </section>
    </>
  );
}
