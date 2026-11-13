// Màn "chờ cấp quyền": khi email đã xác minh và có lời mời PENDING còn hạn thì TỰ kích hoạt lời mời (tạo users/{uid}).
// Quyền vẫn do firestore.rules quyết định (email trong token khớp khóa lời mời); giao diện chỉ gọi acceptInvitation.
import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDocFromServer } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "./firebase";
import {
  acceptInvitation,
  inviteErrorMessage,
  readOwnInvite,
} from "./invitesClient";
import { clearWelcome, setWelcome } from "./welcome";

type Phase =
  | "loading"
  | "unverified"
  | "none"
  | "activating"
  | "failed"
  | "hasProfile"
  | "done"
  | "netError";

// Trạng thái cấp module theo khóa (uid:nonce) để sống sót qua mount lại (StrictMode, Gate dựng lại):
// mỗi lời mời chỉ tự kích hoạt MỘT lần; đang kích hoạt thì không chạy lại; lỗi cuối được giữ để hiện lại và chờ "Thử lại".
const autoStarted = new Set<string>();
const inFlight = new Map<string, Promise<string | null>>();
const lastError = new Map<string, string>();

export function InviteAccept({
  user,
  onBusy,
}: {
  user: User;
  onBusy?: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const nameRef = useRef("");
  const msgRef = useRef<HTMLParagraphElement>(null);

  /** Chạy kích hoạt (một lần cho mỗi lần gọi) và trả về thông báo lỗi hoặc null nếu thành công. */
  const activate = useCallback(
    (key: string): Promise<string | null> => {
      const running = inFlight.get(key);
      if (running) return running;
      // Cờ chào mừng đặt TRƯỚC khi ghi: giao diện vào hệ thống ngay khi bản ghi cục bộ đến, trước khi lô ghi xong.
      setWelcome(user.uid, nameRef.current);
      const p = acceptInvitation(db!, {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
      }).then(
        () => {
          lastError.delete(key);
          return null;
        },
        (cause) => {
          clearWelcome();
          const message = inviteErrorMessage(cause, "accept");
          lastError.set(key, message);
          return message;
        },
      );
      inFlight.set(key, p);
      void p.then(() => inFlight.delete(key));
      return p;
    },
    [user],
  );
  const keyRef = useRef("");
  const run = useCallback(
    async (key: string, live: () => boolean) => {
      setPhase("activating");
      setError("");
      const message = await activate(key);
      if (!live()) return;
      if (message) {
        setError(message);
        setPhase("failed");
      } else setPhase("done");
    },
    [activate],
  );

  const check = useCallback(async () => {
    if (!user.emailVerified) return "unverified" as const;
    // Đã có hồ sơ users (kể cả bị vô hiệu hóa) thì không nhận được lời mời.
    try {
      const profile = await getDocFromServer(doc(db!, "users", user.uid));
      if (profile.exists()) return "hasProfile" as const;
    } catch (cause) {
      if ((cause as { code?: string }).code !== "permission-denied")
        return { kind: "net", cause } as const;
    }
    const own = await readOwnInvite(db!, user);
    if (own.error) return { kind: "net", cause: own.error } as const;
    if (own.status === "PENDING")
      return {
        kind: "ready",
        nonce: typeof own.data?.nonce === "string" ? own.data.nonce : "",
        name:
          typeof own.data?.displayName === "string" ? own.data.displayName : "",
      } as const;
    return "none" as const;
  }, [user]);

  useEffect(() => {
    let live = true;
    setPhase("loading");
    void check().then((r) => {
      if (!live) return;
      if (typeof r === "string") {
        setPhase(r);
        return;
      }
      if (r.kind === "net") {
        setError(inviteErrorMessage(r.cause, "list"));
        setPhase("netError");
        return;
      }
      nameRef.current = r.name;
      const key = `${user.uid}:${r.nonce}`;
      keyRef.current = key;
      if (inFlight.has(key)) {
        // Đang kích hoạt (mount lại giữa chừng): giữ "đang kích hoạt", không chạy lần hai.
        void run(key, () => live);
        return;
      }
      if (autoStarted.has(key)) {
        // Đã tự thử cho lời mời này: hiện lại lỗi cuối và chờ "Thử lại" (không tự thử lại).
        setError(lastError.get(key) ?? "");
        setPhase("failed");
        return;
      }
      autoStarted.add(key);
      void run(key, () => live);
    });
    return () => {
      live = false;
    };
  }, [check, run, attempt, user.uid]);
  useEffect(() => {
    if (error) msgRef.current?.focus();
  }, [error]);
  // Báo cho màn cổng biết đang xử lý (để hiện "Đang đăng nhập" thay vì màn "Chờ cấp quyền").
  useEffect(() => {
    onBusy?.(phase === "loading" || phase === "activating" || phase === "done");
  }, [phase, onBusy]);

  if (phase === "loading") return <p role="status">Đang kiểm tra lời mời…</p>;
  if (phase === "activating")
    return <p role="status">Đang kích hoạt lời mời…</p>;
  if (phase === "done")
    return (
      <p role="status" tabIndex={-1} ref={msgRef}>
        Đã kích hoạt lời mời. Đang vào hệ thống…
      </p>
    );
  if (phase === "netError")
    return (
      <div>
        <p role="alert" tabIndex={-1} ref={msgRef}>
          Không kiểm tra được lời mời (có thể do mạng hoặc máy chủ). Hãy thử
          lại; nếu vẫn lỗi, kiểm tra kết nối và đồng hồ thiết bị.
        </p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>
          Thử lại
        </button>
      </div>
    );
  if (phase === "unverified")
    return (
      <p className="notice">
        Email của tài khoản này chưa được xác minh nên chưa nhận được lời mời.
        Hãy đăng xuất rồi đăng nhập bằng liên kết gửi qua email hoặc bằng
        Google.
      </p>
    );
  if (phase === "none")
    return (
      <p className="notice">
        Bạn đang đăng nhập bằng {user.email}, nhưng không có lời mời còn hiệu
        lực cho email này. Hãy đăng xuất và đăng nhập bằng đúng email được mời,
        hoặc nhờ quản trị viên mời email này.
      </p>
    );
  if (phase === "hasProfile") return null;
  // failed: tự kích hoạt lỗi; cho thử lại thủ công (không tự thử lại vô hạn).
  return (
    <section className="invite-accept" aria-labelledby="invite-accept-title">
      <h3 id="invite-accept-title">Chưa kích hoạt được lời mời</h3>
      <p role="alert" tabIndex={-1} ref={msgRef}>
        {error || "Hãy thử lại."}
      </p>
      <button
        type="button"
        className="primary"
        onClick={() => void run(keyRef.current, () => true)}
      >
        Thử lại
      </button>
    </section>
  );
}
