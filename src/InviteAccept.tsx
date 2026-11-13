// Màn "chờ cấp quyền": nếu email đã xác minh và có lời mời PENDING còn hạn thì cho nhận lời mời (tạo users/{uid}).
import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDocFromServer } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "./firebase";
import {
  acceptInvitation,
  inviteErrorMessage,
  readOwnInvite,
} from "./invitesClient";

type Phase =
  | "loading"
  | "unverified"
  | "none"
  | "ready"
  | "hasProfile"
  | "done"
  | "netError";

export function InviteAccept({ user }: { user: User }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const msgRef = useRef<HTMLParagraphElement>(null);
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
      if (typeof r === "string") setPhase(r);
      else if (r.kind === "ready") {
        setName(r.name);
        setPhase("ready");
      } else {
        setError(inviteErrorMessage(r.cause, "list"));
        setPhase("netError");
      }
    });
    return () => {
      live = false;
    };
  }, [check, attempt]);
  useEffect(() => {
    if (error) msgRef.current?.focus();
  }, [error]);
  if (phase === "loading") return <p role="status">Đang kiểm tra lời mời…</p>;
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
        Chưa có lời mời còn hiệu lực cho {user.email}. Hãy nhờ quản trị viên mời
        bằng đúng email này.
      </p>
    );
  if (phase === "done")
    return (
      <p role="status" tabIndex={-1} ref={msgRef}>
        Đã nhận lời mời. Đang vào hệ thống…
      </p>
    );
  if (phase === "hasProfile") return null;
  return (
    <section className="invite-accept" aria-labelledby="invite-accept-title">
      <h3 id="invite-accept-title">Bạn được mời vào gia phả</h3>
      <p>
        {name ? `${name}, ` : ""}bạn được mời xem gia phả với quyền{" "}
        <b>Chỉ xem</b>.
      </p>
      {error && (
        <p role="alert" tabIndex={-1} ref={msgRef}>
          {error}
        </p>
      )}
      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await acceptInvitation(db!, {
              uid: user.uid,
              email: user.email,
              emailVerified: user.emailVerified,
            });
            setPhase("done");
          } catch (cause) {
            setError(inviteErrorMessage(cause, "accept"));
            setBusy(false);
          }
        }}
      >
        {busy ? "Đang nhận…" : "Nhận lời mời"}
      </button>
    </section>
  );
}
