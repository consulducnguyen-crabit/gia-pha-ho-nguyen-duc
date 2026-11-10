import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAt,
  endAt,
} from "firebase/firestore";
import { auth, db, emulator } from "./firebase";
import { normalizeName, type Person } from "./domain";
import "./style.css";
function App() {
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState("loading");
  useEffect(() => {
    if (!auth || !db) {
      setAccess("setup");
      return;
    }
    let stop = () => {};
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      stop();
      setUser(u);
      setAccess(u ? "loading" : "login");
      if (u)
        stop = onSnapshot(
          doc(db!, "users", u.uid),
          (s) => setAccess(s.data()?.enabled === true ? "member" : "pending"),
          () => setAccess("error"),
        );
    });
    return () => {
      stop();
      unsubscribe();
    };
  }, []);
  if (access !== "member") return <Gate state={access} user={user} />;
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="#/">
          ❧{" "}
          <span>
            Gia phả<small>GÌN GIỮ CỘI NGUỒN</small>
          </span>
        </a>
        <p className="nav-label">KHÔNG GIAN DÒNG HỌ</p>
        <nav>
          <NavLink to="/" end>
            ⌂ Tổng quan
          </NavLink>
          <NavLink to="/persons">♧ Tra cứu thành viên</NavLink>
          <NavLink to="/roadmap">☷ Tiến độ triển khai</NavLink>
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
        <main>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/persons" element={<People />} />
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="*" element={<h1>Không tìm thấy trang</h1>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
function Gate({ state, user }: { state: string; user: User | null }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="gate">
      <section className="story">
        <div className="eyebrow">GIA PHẢ DÒNG HỌ</div>
        <div className="tree-mark">❧</div>
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
      <section className="login">
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
          <p role="status">Đang kiểm tra quyền truy cập…</p>
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
                  required
                />
              </label>
              <label>
                Mật khẩu
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              {error && <p role="alert">{error}</p>}
              <button className="primary" disabled={busy}>
                {busy ? "Đang đăng nhập…" : "Đăng nhập →"}
              </button>
            </form>
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
      </section>
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
        <span className="tree-mark">❧</span>
        <div>
          <h2>Từng hồ sơ, một câu chuyện</h2>
          <p>
            Tra cứu hồ sơ đã được cấp quyền. Các chức năng cập nhật sẽ mở khi
            hoàn tất kiểm chứng quy trình phê duyệt.
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
          <span>03 / ĐANG CHUẨN BỊ</span>
          <h3>Cây và đề xuất</h3>
          <p>
            Chính sách đã chốt; đang chuẩn bị quy trình xác minh và phê duyệt.
          </p>
        </article>
      </div>
    </>
  );
}
function People() {
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Person | null>(null);
  async function load(value: string) {
    setStatus("Đang tải…");
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
      const result = await getDocs(q);
      setPeople(result.docs.map((d) => ({ ...d.data(), id: d.id }) as Person));
      setStatus(
        result.empty
          ? "Không tìm thấy hồ sơ."
          : "Hiển thị tối đa 30 hồ sơ. Tìm theo phần đầu tên để thu hẹp kết quả.",
      );
    } catch {
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
          <button className="person" key={p.id} onClick={() => setSelected(p)}>
            <span className="avatar">{p.displayName.charAt(0)}</span>
            <h3>{p.displayName}</h3>
            <small>Xem hồ sơ →</small>
          </button>
        ))}
      </div>
      {selected && (
        <section className="detail">
          <button onClick={() => setSelected(null)}>Đóng hồ sơ</button>
          <h2>{selected.displayName}</h2>
          <p>Mã hồ sơ: {selected.id}</p>
          <p>Phiên bản: {selected.profileVersion}</p>
          <p>Đời và chi: chờ xác minh quan hệ truyền dòng.</p>
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
        <h2>Chính sách đã được phê duyệt</h2>
        <p>
          Truyền dòng, con nuôi, số gốc, số người duyệt, cấp tài khoản, hồ sơ
          phối ngẫu và quyền riêng tư người còn sống.
        </p>
        <h2>Chưa mở</h2>
        <p>
          Cây tương tác, gửi và duyệt đề xuất, nhập Excel, ảnh, tài liệu và quản
          trị tài khoản.
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
