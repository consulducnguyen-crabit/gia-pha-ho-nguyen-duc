import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db, emulator } from "./firebase";
import { AddMemberPage } from "./AddMember";
import { AuditLogPage } from "./AuditLog";
import { BrandMark } from "./BrandMark";
import { ScrollButtons } from "./ScrollButtons";
import { AdminViewContext } from "./adminView";
import { LoginForm } from "./LoginForm";
import { loginLabel, REGISTER_CONTACT } from "./phoneLogin";
import { ChangePasswordGate } from "./ChangePassword";
import { WelcomeBanner } from "./WelcomeBanner";
import { OverviewStats } from "./OverviewStatsView";
import { pruneWelcome } from "./welcome";
import { Proposals } from "./Proposals";
import { PersonPage, ReviewQueuePage, TreePage } from "./Tree";
import { UsersPage } from "./Users";
import "@fontsource-variable/source-serif-4/wght.css";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState("loading");
  const [canManageMembership, setCanManageMembership] = useState(false);
  const [canReviewChanges, setCanReviewChanges] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [profileName, setProfileName] = useState("");
  useEffect(() => {
    if (!auth || !db) {
      setAccess("setup");
      return;
    }
    let stop = () => {};
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      stop();
      pruneWelcome(u?.uid ?? null); // cờ chào mừng không được sang tài khoản khác
      setCanManageMembership(false);
      setCanReviewChanges(false);
      setMustChangePassword(false);
      setProfileName("");
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
            setMustChangePassword(
              confirmed && s.data()?.mustChangePassword === true,
            );
            setProfileName(
              typeof s.data()?.displayName === "string"
                ? (s.data()?.displayName as string)
                : "",
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
            setMustChangePassword(false);
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
  // Menu thu gọn (màn hẹp): đóng khi đổi trang hoặc bấm Esc.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  if (access === "member" && mustChangePassword && user)
    return <ChangePasswordGate key={user.uid} user={user} name={profileName} />;
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
      <header className="topbar">
        <div className="topbar-bar">
          <a className="brand" href="#/">
            <BrandMark className="brand-mark" />{" "}
            <span>
              <span className="brand-name">
                Gia phả dòng họ Nguyễn Đức{" "}
                <span className="brand-place">- Thôn Hạ</span>{" "}
                <span className="brand-place">- Phùng Xá</span>
              </span>
              <small>GÌN GIỮ CỘI NGUỒN</small>
            </span>
          </a>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="menu-chinh"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? "Đóng" : "Menu"}
          </button>
        </div>
        <div
          id="menu-chinh"
          className={menuOpen ? "topbar-menu open" : "topbar-menu"}
        >
          <nav aria-label="Điều hướng chính">
            <NavLink to="/" end>
              Tổng quan
            </NavLink>
            <NavLink to="/tree">Cây gia phả</NavLink>
            {canManageMembership && (
              <NavLink to="/review-queue">Cần kiểm tra</NavLink>
            )}
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
          </nav>
          <span className="header-user">
            <span className="header-user-email" title={loginLabel(user?.email)}>
              <span className="header-user-label">Đang đăng nhập: </span>
              {loginLabel(user?.email)}
            </span>
            <button onClick={() => void signOut(auth!)}>Đăng xuất</button>
          </span>
        </div>
      </header>
      <div className="workspace">
        <main id="main" tabIndex={-1} ref={mainRef}>
          <AdminViewContext.Provider value={canManageMembership}>
            <Routes>
              <Route
                path="/"
                element={
                  <Titled title="Tổng quan">
                    <Overview
                      isAdmin={canManageMembership}
                      uid={user!.uid}
                      email={loginLabel(user!.email)}
                    />
                  </Titled>
                }
              />
              <Route
                path="/tree/*"
                element={
                  <Titled
                    title={
                      location.pathname === "/tree/danh-sach"
                        ? "Danh sách thành viên"
                        : "Cây gia phả"
                    }
                  >
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
                  canManageMembership ? (
                    <Titled title="Cần kiểm tra">
                      <ReviewQueuePage key={user!.uid} uid={user!.uid} />
                    </Titled>
                  ) : (
                    <Navigate to="/" replace />
                  )
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
                  path="/add-member"
                  element={
                    <Titled title="Thêm thành viên">
                      <AddMemberPage key={user!.uid} uid={user!.uid} />
                    </Titled>
                  }
                />
              )}
              {canManageMembership && (
                <Route
                  path="/users"
                  element={
                    <Titled title="Quản lý tài khoản">
                      <UsersPage key={user!.uid} uid={user!.uid} />
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
              <Route
                path="*"
                element={
                  <Titled title="Không tìm thấy trang">
                    <h1>Không tìm thấy trang</h1>
                  </Titled>
                }
              />
            </Routes>
          </AdminViewContext.Provider>
        </main>
      </div>
    </div>
  );
}
function Gate({ state, user }: { state: string; user: User | null }) {
  const signingIn = state === "loading";
  // Tiêu đề tab theo trạng thái thật của màn hình cổng (khớp tiêu đề hiển thị).
  useEffect(() => {
    const t =
      state === "setup"
        ? "Sẵn sàng kết nối"
        : state === "pending"
          ? "Chờ cấp quyền"
          : state === "loading"
            ? "Đang đăng nhập"
            : state === "error"
              ? "Không thể kiểm tra quyền truy cập"
              : "Đăng nhập";
    document.title = `${t} · Gia phả`;
  }, [state]);
  return (
    <div className="gate">
      <section className="story">
        <div className="eyebrow">
          GIA PHẢ DÒNG HỌ NGUYỄN ĐỨC{" "}
          <span className="brand-place">- THÔN HẠ</span>{" "}
          <span className="brand-place">- PHÙNG XÁ</span>
        </div>
        <div className="tree-mark" aria-hidden="true">
          <BrandMark />
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
            : signingIn
              ? "Đang đăng nhập…"
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
            <p role="status">
              Đang mở không gian dòng họ, vui lòng chờ trong giây lát…
            </p>
            {user && (
              <button onClick={() => void signOut(auth!)}>Đăng xuất</button>
            )}
          </>
        ) : state === "pending" || state === "error" ? (
          <>
            <p>
              {state === "pending"
                ? `Tài khoản chưa được cấp quyền hoặc đã bị vô hiệu hóa. Vui lòng liên hệ zalo ${REGISTER_CONTACT.zalo} (${REGISTER_CONTACT.label}).`
                : "Không thể kiểm tra quyền truy cập. Vui lòng thử đăng nhập lại."}
            </p>
            <button onClick={() => void signOut(auth!)}>
              Đăng xuất {loginLabel(user?.email)}
            </button>
          </>
        ) : (
          <LoginForm />
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
function Overview({
  isAdmin,
  uid,
  email,
}: {
  isAdmin: boolean;
  uid: string;
  email: string | null;
}) {
  return (
    <>
      <WelcomeBanner uid={uid} email={email} />
      <h1 className="sr-only">Tổng quan</h1>
      <div className="hero">
        <span className="tree-mark" aria-hidden="true">
          <BrandMark />
        </span>
        <div>
          <h2>Từng hồ sơ, một câu chuyện</h2>
          <p>
            Xem cây gia phả và tra cứu hồ sơ đã được cấp quyền. Dữ liệu do quản
            trị viên quản lý; mỗi thay đổi được ghi nhật ký để kiểm tra và khôi
            phục.
          </p>
          <div className="hero-actions">
            <NavLink className="primary link" to="/tree/danh-sach">
              Xem danh sách thành viên →
            </NavLink>
            {isAdmin && (
              <NavLink className="link add-member-link" to="/add-member">
                + Thêm thành viên
              </NavLink>
            )}
          </div>
        </div>
      </div>
      {/* key=uid: đổi tài khoản thì tải lại số liệu, không giữ số của người trước. */}
      <OverviewStats key={uid} uid={uid} />
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
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
      <ScrollButtons />
    </HashRouter>
  </React.StrictMode>,
);
