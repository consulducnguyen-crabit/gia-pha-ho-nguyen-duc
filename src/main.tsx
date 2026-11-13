import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAt,
  endAt,
} from "firebase/firestore";
import { auth, db, emulator } from "./firebase";
import { normalizeName, type Person } from "./domain";
import { latestRequest } from "./latestRequest";
import { AuditLogPage } from "./AuditLog";
import { AcceptInvitation, MembershipAdmin } from "./Membership";
import { Proposals } from "./Proposals";
import { PersonPage, ReviewQueuePage, TreePage } from "./Tree";
import { UsersPage } from "./Users";
import "./style.css";
// Tiêu đề tab (WCAG 2.4.2) đặt ngay trong phần tử của từng <Route> để luôn khớp trang thật đang render
// (kể cả route bị chặn quyền, không tồn tại, hoặc chỉ có trên emulator).
function Titled({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Gia phả`;
  }, [title]);
  return <>{children}</>;
}
function App() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);
  const firstRoute = useRef(true);
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState("loading");
  const [canManageMembership, setCanManageMembership] = useState(false);
  const [canReviewChanges, setCanReviewChanges] = useState(false);
  useEffect(() => {
    if (!auth || !db) {
      setAccess("setup");
      return;
    }
    let stop = () => {};
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      stop();
      setCanManageMembership(false);
      setCanReviewChanges(false);
      setUser(u);
      setAccess(u ? "loading" : "login");
      if (u)
        stop = onSnapshot(
          doc(db!, "users", u.uid),
          { includeMetadataChanges: true },
          (s) => {
            const confirmed =
              !s.metadata.fromCache && s.data()?.enabled === true;
            setCanReviewChanges(
              confirmed && s.data()?.canReviewChanges === true,
            );
            setCanManageMembership(
              !s.metadata.fromCache &&
                s.data()?.enabled === true &&
                s.data()?.canManageMembership === true,
            );
            setAccess(
              s.metadata.fromCache
                ? "loading"
                : s.data()?.enabled === true
                  ? "member"
                  : "pending",
            );
          },
          () => {
            setCanManageMembership(false);
            setCanReviewChanges(false);
            setAccess("error");
          },
        );
    });
    return () => {
      stop();
      unsubscribe();
    };
  }, []);
  // Đổi route trong ứng dụng: đưa focus vào vùng nội dung để bàn phím/trình đọc màn hình bắt đầu từ trang mới.
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);
  if (access !== "member")
    return <Gate key={user?.uid ?? "signed-out"} state={access} user={user} />;
  return (
    <div className="shell">
      {/* href="#main" sẽ bị HashRouter hiểu là route, nên chặn mặc định và tự chuyển focus. */}
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Bỏ qua tới nội dung chính
      </a>
      <aside>
        <a className="brand" href="#/">
          <span aria-hidden="true">❧</span>{" "}
          <span>
            Gia phả<small>GÌN GIỮ CỘI NGUỒN</small>
          </span>
        </a>
        <p className="nav-label">KHÔNG GIAN DÒNG HỌ</p>
        <nav aria-label="Điều hướng chính">
          <NavLink to="/" end>
            Tổng quan
          </NavLink>
          <NavLink to="/tree">Cây gia phả</NavLink>
          <NavLink to="/review-queue">Cần kiểm tra</NavLink>
          <NavLink to="/persons">Tra cứu thành viên</NavLink>
          {emulator && <NavLink to="/changes">Đề xuất thay đổi</NavLink>}
          {emulator && canReviewChanges && (
            <NavLink to="/review">Hộp duyệt</NavLink>
          )}
          {canManageMembership && (
            <NavLink to="/users">Quản lý tài khoản</NavLink>
          )}
          {canManageMembership && (
            <NavLink to="/audit">Nhật ký chỉnh sửa</NavLink>
          )}
          {emulator && canManageMembership && (
            <NavLink to="/accounts">Tài khoản và lời mời</NavLink>
          )}
          <NavLink to="/roadmap">Tiến độ triển khai</NavLink>
        </nav>
        <div className="aside-foot">
          Tư liệu riêng tư
          <br />
          <small>Chỉ dành cho thành viên được cấp quyền</small>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <span>
            Gia phả dòng họ <b>/ Không gian riêng tư</b>
          </span>
          <button onClick={() => void signOut(auth!)}>Đăng xuất</button>
        </header>
        <main id="main" tabIndex={-1} ref={mainRef}>
          <Routes>
            <Route
              path="/"
              element={
                <Titled title="Tổng quan">
                  <Overview />
                </Titled>
              }
            />
            <Route
              path="/tree"
              element={
                <Titled title="Cây gia phả">
                  <TreePage
                    key={user!.uid}
                    uid={user!.uid}
                    isAdmin={canManageMembership}
                  />
                </Titled>
              }
            />
            <Route
              path="/person/:id"
              element={
                <Titled title="Hồ sơ thành viên">
                  <PersonPage
                    key={user!.uid}
                    uid={user!.uid}
                    canEdit={canManageMembership}
                  />
                </Titled>
              }
            />
            <Route
              path="/review-queue"
              element={
                <Titled title="Cần kiểm tra">
                  <ReviewQueuePage key={user!.uid} uid={user!.uid} />
                </Titled>
              }
            />
            <Route
              path="/persons"
              element={
                <Titled title="Tra cứu thành viên">
                  <People />
                </Titled>
              }
            />
            <Route
              path="/roadmap"
              element={
                <Titled title="Tiến độ triển khai">
                  <Roadmap />
                </Titled>
              }
            />
            {emulator && (
              <Route
                path="/changes"
                element={
                  <Titled title="Đề xuất thay đổi">
                    <Proposals
                      key={`own:${user!.uid}`}
                      mode="OWN"
                      currentUid={user!.uid}
                    />
                  </Titled>
                }
              />
            )}
            {emulator && canReviewChanges && (
              <Route
                path="/review"
                element={
                  <Titled title="Hộp duyệt">
                    <Proposals
                      key={`review:${user!.uid}`}
                      mode="REVIEW"
                      currentUid={user!.uid}
                    />
                  </Titled>
                }
              />
            )}
            {canManageMembership && (
              <Route
                path="/users"
                element={
                  <Titled title="Quản lý tài khoản">
                    <UsersPage key={user!.uid} />
                  </Titled>
                }
              />
            )}
            {canManageMembership && (
              <Route
                path="/audit"
                element={
                  <Titled title="Nhật ký chỉnh sửa">
                    <AuditLogPage key={user!.uid} uid={user!.uid} />
                  </Titled>
                }
              />
            )}
            {emulator && canManageMembership && (
              <Route
                path="/accounts"
                element={
                  <Titled title="Tài khoản và lời mời">
                    <MembershipAdmin key={user?.uid} />
                  </Titled>
                }
              />
            )}
            <Route
              path="*"
              element={
                <Titled title="Không tìm thấy trang">
                  <h1>Không tìm thấy trang</h1>
                </Titled>
              }
            />
          </Routes>
        </main>
      </div>
    </div>
  );
}
function Gate({ state, user }: { state: string; user: User | null }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Tiêu đề tab theo trạng thái thật của màn hình cổng (khớp tiêu đề hiển thị).
  useEffect(() => {
    const t =
      state === "setup"
        ? "Sẵn sàng kết nối"
        : state === "pending"
          ? "Chờ cấp quyền"
          : state === "loading"
            ? "Đang kiểm tra quyền truy cập"
            : state === "error"
              ? "Không thể kiểm tra quyền truy cập"
              : "Đăng nhập";
    document.title = `${t} · Gia phả`;
  }, [state]);
  return (
    <div className="gate">
      <section className="story">
        <div className="eyebrow">GIA PHẢ DÒNG HỌ</div>
        <div className="tree-mark" aria-hidden="true">
          ❧
        </div>
        <h1>
          Từ cội nguồn,
          <br />
          nối những thế hệ.
        </h1>
        <p>
          Một nơi lưu giữ ký ức, kết nối người thân và trao lại câu chuyện dòng
          họ cho mai sau.
        </p>
        <small>RIÊNG TƯ · CÓ NGUỒN GỐC · ĐƯỢC GÌN GIỮ</small>
      </section>
      <main className="login">
        <div className="eyebrow">GÌN GIỮ CỘI NGUỒN</div>
        <h2>
          {state === "setup"
            ? "Sẵn sàng kết nối"
            : state === "pending"
              ? "Chờ cấp quyền"
              : "Chào mừng trở về"}
        </h2>
        {state === "setup" ? (
          <>
            <p>
              Bản nền đã sẵn sàng. Cần cấu hình Firebase để đăng nhập vào không
              gian dòng họ.
            </p>
            <div className="notice">
              Chưa kết nối dữ liệu. Hướng dẫn chạy cục bộ nằm trong README của
              dự án.
            </div>
          </>
        ) : state === "loading" ? (
          <>
            <p role="status">Đang kiểm tra quyền truy cập…</p>
            {user && (
              <button onClick={() => void signOut(auth!)}>Đăng xuất</button>
            )}
          </>
        ) : state === "pending" || state === "error" ? (
          <>
            <p>
              {state === "pending"
                ? "Tài khoản chưa được cấp quyền hoặc đã bị vô hiệu hóa. Vui lòng liên hệ người quản lý gia phả."
                : "Không thể kiểm tra quyền truy cập. Vui lòng thử đăng nhập lại."}
            </p>
            <button onClick={() => void signOut(auth!)}>
              Đăng xuất {user?.email}
            </button>
            {state === "pending" && user && emulator && (
              <AcceptInvitation key={user.uid} />
            )}
          </>
        ) : (
          <>
            <p>Đăng nhập bằng tài khoản đã được cấp quyền.</p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const data = new FormData(e.currentTarget);
                try {
                  await signInWithEmailAndPassword(
                    auth!,
                    String(data.get("email")),
                    String(data.get("password")),
                  );
                } catch {
                  setError(
                    "Không thể đăng nhập. Kiểm tra tài khoản và thử lại.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  aria-describedby={error ? "login-error" : undefined}
                  required
                />
              </label>
              <label>
                Mật khẩu
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  aria-describedby={error ? "login-error" : undefined}
                  required
                />
              </label>
              {error && (
                <p role="alert" id="login-error">
                  {error}
                </p>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "Đang đăng nhập…" : "Đăng nhập →"}
              </button>
            </form>
            <p className="login-or">
              hoặc dùng tài khoản Gmail đã được cấp quyền
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await signInWithPopup(auth!, new GoogleAuthProvider());
                } catch (cause) {
                  const code =
                    cause && typeof cause === "object" && "code" in cause
                      ? String(cause.code)
                      : "";
                  if (
                    code !== "auth/popup-closed-by-user" &&
                    code !== "auth/cancelled-popup-request"
                  )
                    setError(
                      "Không thể đăng nhập bằng Google. Cho phép cửa sổ bật lên rồi thử lại.",
                    );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Đăng nhập bằng Google
            </button>
          </>
        )}
        <div className="privacy">
          ◈ Dữ liệu gia phả chỉ mở sau khi kiểm tra quyền truy cập.
        </div>
        {emulator && (
          <div className="notice">
            Môi trường emulator · chỉ dùng dữ liệu giả
          </div>
        )}
      </main>
    </div>
  );
}
function Overview() {
  return (
    <>
      <div className="eyebrow">KÝ ỨC ĐƯỢC TIẾP NỐI</div>
      <h1>
        Người có tổ,
        <br />
        cây có nguồn.
      </h1>
      <p className="intro">
        Không gian chung để lưu giữ và tìm hiểu gia phả dòng họ.
      </p>
      <div className="hero">
        <span className="tree-mark" aria-hidden="true">
          ❧
        </span>
        <div>
          <h2>Từng hồ sơ, một câu chuyện</h2>
          <p>
            Xem cây gia phả và tra cứu hồ sơ đã được cấp quyền. Dữ liệu do quản
            trị viên quản lý; mỗi thay đổi được ghi nhật ký để kiểm tra và khôi
            phục.
          </p>
          <NavLink className="primary link" to="/persons">
            Tra cứu thành viên →
          </NavLink>
        </div>
      </div>
      <div className="cards">
        <article>
          <span>01 / TƯ LIỆU</span>
          <h3>Hồ sơ thành viên</h3>
          <p>Tìm theo tên; tải tối đa 30 hồ sơ mỗi lượt.</p>
        </article>
        <article>
          <span>02 / NGUYÊN TẮC</span>
          <h3>Cẩn trọng với nguồn gốc</h3>
          <p>Không suy đoán đời hoặc chi từ tên và giới tính.</p>
        </article>
        <article>
          <span>03 / CÂY GIA PHẢ</span>
          <h3>Cây theo dòng truyền dòng</h3>
          <p>Xem từ thủy tổ xuống, tìm theo tên, mở hồ sơ từng người.</p>
        </article>
      </div>
    </>
  );
}
function People() {
  const requests = useRef(latestRequest());
  useEffect(() => () => requests.current.invalidate(), []);
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Person | null>(null);
  // Mở hồ sơ: focus vào tiêu đề hồ sơ; đóng: trả focus về thẻ đã mở (WCAG 2.4.3).
  const detailHeading = useRef<HTMLHeadingElement | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (selected) detailHeading.current?.focus();
  }, [selected]);
  async function load(value: string) {
    const isCurrent = requests.current.start();
    setStatus("Đang tải…");
    setPeople([]);
    setSelected(null);
    try {
      const term = normalizeName(value);
      const q = term
        ? query(
            collection(db!, "memberProfiles"),
            orderBy("normalizedName"),
            startAt(term),
            endAt(term + "\uf8ff"),
            limit(30),
          )
        : query(
            collection(db!, "memberProfiles"),
            orderBy("normalizedName"),
            limit(30),
          );
      const result = await getDocsFromServer(q);
      if (!isCurrent()) return;
      setPeople(result.docs.map((d) => ({ ...d.data(), id: d.id }) as Person));
      setStatus(
        result.empty
          ? "Không tìm thấy hồ sơ."
          : "Hiển thị tối đa 30 hồ sơ. Tìm theo phần đầu tên để thu hẹp kết quả.",
      );
    } catch {
      if (!isCurrent()) return;
      setPeople([]);
      setStatus("Không thể tải hồ sơ. Quyền truy cập có thể đã thay đổi.");
    }
  }
  return (
    <>
      <div className="eyebrow">TƯ LIỆU DÒNG HỌ</div>
      <h1>Tra cứu thành viên</h1>
      <p>Tìm theo phần đầu họ tên, có thể nhập không dấu.</p>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          void load(search);
        }}
      >
        <label className="sr-only" htmlFor="search">
          Họ tên
        </label>
        <input
          id="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nhập họ tên…"
        />
        <button className="primary">Tìm kiếm</button>
      </form>
      <p role="status">
        {status || "Nhấn Tìm kiếm để tải danh sách được cấp quyền."}
      </p>
      <div className="cards">
        {people.map((p) => (
          <button
            className="person"
            key={p.id}
            onClick={(e) => {
              trigger.current = e.currentTarget;
              setSelected(p);
            }}
          >
            <span className="avatar" aria-hidden="true">
              {p.displayName.charAt(0)}
            </span>
            {/* Không dùng h3 trong button: nội dung của button chỉ được là phrasing content. */}
            <span className="person-name">{p.displayName}</span>
            <small>Xem hồ sơ →</small>
          </button>
        ))}
      </div>
      {selected && (
        <section className="detail">
          <button
            onClick={() => {
              setSelected(null);
              // Thẻ đã mở có thể không còn (danh sách tải lại): focus ô tìm kiếm thay vì rơi về body.
              (trigger.current?.isConnected
                ? trigger.current
                : document.getElementById("search")
              )?.focus();
            }}
          >
            Đóng hồ sơ
          </button>
          <h2 tabIndex={-1} ref={detailHeading}>
            {selected.displayName}
          </h2>
          <p>
            <Link className="primary link" to={`/person/${selected.id}`}>
              Xem đời, chi và quan hệ trong cây →
            </Link>
          </p>
        </section>
      )}
    </>
  );
}
function Roadmap() {
  return (
    <>
      <div className="eyebrow">BẢN NỀN 0.1</div>
      <h1>Tiến độ triển khai</h1>
      <article className="detail">
        <h2>Đã triển khai</h2>
        <p>
          Đăng nhập, kiểm tra quyền theo thời gian thực, tra cứu có giới hạn,
          cấu hình emulator và kiểm thử bảo mật.
        </p>
        <p>
          Lời mời một lần, nhận quyền và thu hồi quyền tài khoản đã có bản thử
          nghiệm trên emulator. Chưa mở trên production. Đề xuất họ tên và thêm
          quan hệ có luồng duyệt thử nghiệm; quan hệ truyền dòng cũng do một
          người duyệt (khác người đề xuất).
        </p>
        <h2>Chính sách đã được phê duyệt</h2>
        <p>
          Truyền dòng, con nuôi, số gốc, số người duyệt, cấp tài khoản, hồ sơ
          phối ngẫu và quyền riêng tư người còn sống.
        </p>
        <h2>Chưa mở</h2>
        <p>
          Sơ đồ cây đồ họa, ảnh, tài liệu, kênh góp ý của thành viên và quản trị
          tài khoản ngay trong ứng dụng.
        </p>
      </article>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
