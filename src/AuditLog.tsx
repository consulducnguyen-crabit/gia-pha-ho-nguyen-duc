// Trang "Nhật ký chỉnh sửa" (chỉ quản trị viên; route #/audit chỉ có khi canManageMembership).
// Đọc auditLogs/edit-{n} theo mã (rules không cho liệt kê), từ phiên bản mới nhất xuống. Quyền thật nằm ở rules.
// Bản ghi là dữ liệu không tin cậy: mọi chuỗi đi qua auditView.describeAudit và chỉ render bằng text React.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDocFromServer } from "firebase/firestore";
import { db } from "./firebase";
import { latestRequest } from "./latestRequest";
import { loadTreeIndex } from "./Tree";
import type { TreeIndex } from "./treeModel";
import {
  AUDIT_EVENTS,
  EVENT_LABELS,
  LOAD_ALL_CAP,
  PAGE_SIZE,
  classifyRead,
  describeAudit,
  lostAccess,
  matchesFilter,
  pageVersions,
  shortUid,
  SAFE_UID,
  type AuditView,
  type PersonRef,
  type ReadOutcome,
} from "./auditView";

type TreeState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "empty" }
  | { status: "ready"; index: TreeIndex };

export function AuditLogPage({ uid }: { uid: string }) {
  const [state, setState] = useState<TreeState>({ status: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    // Luôn đọc lại từ máy chủ để editVersion là phiên bản mới nhất.
    loadTreeIndex(uid, true)
      .then((index) => {
        if (live)
          setState(index ? { status: "ready", index } : { status: "empty" });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [uid, round]);
  return (
    <>
      <h1>Nhật ký chỉnh sửa</h1>
      <p className="tree-summary">
        Mỗi lần sửa dữ liệu trong ứng dụng được ghi thành một bản nhật ký, chỉ
        thêm, không sửa hay xóa. Trang này chỉ dành cho quản trị viên. Ghi chú
        riêng không hiện nội dung; ngày sinh/mất đầy đủ chỉ nằm trong phần “Chi
        tiết”.
      </p>
      {state.status === "loading" && (
        <p role="status" className="notice">
          Đang tải nhật ký…
        </p>
      )}
      {state.status === "empty" && (
        <p role="status" className="notice">
          Chưa có dữ liệu cây, nên chưa có nhật ký chỉnh sửa.
        </p>
      )}
      {state.status === "error" && (
        <div role="alert" className="notice">
          Không tải được ảnh chụp cây để xác định phiên bản nhật ký mới nhất.
          Hãy kiểm tra kết nối và quyền truy cập.{" "}
          <button
            className="link-button"
            onClick={() => setRound((n) => n + 1)}
          >
            Thử lại
          </button>
        </div>
      )}
      {state.status === "ready" &&
        (state.index.snapshot.editVersion < 1 ? (
          <p role="status" className="notice">
            Chưa có lần chỉnh sửa nào trong ứng dụng.
          </p>
        ) : (
          <AuditTable
            key={`${round}:${state.index.snapshot.editVersion}`}
            index={state.index}
            onReload={() => setRound((n) => n + 1)}
          />
        ))}
    </>
  );
}

type Stored = Extract<ReadOutcome, { status: "ok" | "denied" | "missing" }>;
interface Loaded {
  records: Map<number, Stored>;
  /** Phiên bản kế tiếp cần tải (giảm dần); 0 = đã tải hết. */
  next: number;
  /** Phiên bản gặp lỗi mạng/tạm thời, thử lại được. */
  failed: number[];
  /** Cả loạt bị từ chối: coi như mất quyền, dừng tải. */
  denied: boolean;
  busy: boolean;
  progress: string;
}
type Actor = { label: string; revoked: boolean } | "error";

async function fetchBatch(versions: number[]): Promise<ReadOutcome[]> {
  const reads = await Promise.allSettled(
    versions.map(async (v) => {
      const snap = await getDocFromServer(doc(db!, "auditLogs", `edit-${v}`));
      return {
        exists: snap.exists(),
        data: snap.exists() ? snap.data() : null,
      };
    }),
  );
  return reads.map((r, i) => classifyRead(versions[i], r));
}

function AuditTable({
  index,
  onReload,
}: {
  index: TreeIndex;
  onReload: () => void;
}) {
  const latest = index.snapshot.editVersion;
  const [loaded, setLoaded] = useState<Loaded>({
    records: new Map(),
    next: latest,
    failed: [],
    denied: false,
    busy: false,
    progress: "",
  });
  const [event, setEvent] = useState("");
  const [needle, setNeedle] = useState("");
  const [actors, setActors] = useState<Record<string, Actor>>({});
  const requests = useRef(latestRequest());
  const alive = useRef(true);
  const asked = useRef(new Set<string>());
  useEffect(() => {
    alive.current = true;
    const run = requests.current;
    return () => {
      alive.current = false;
      run.invalidate();
    };
  }, []);

  // Tải tuần tự các nhóm phiên bản. advance=true: dịch con trỏ `next` xuống sau mỗi nhóm (xem thêm/tải toàn bộ).
  const process = useCallback(async (chunks: number[][], advance: boolean) => {
    const current = requests.current.start();
    setLoaded((p) => ({ ...p, busy: true, progress: "" }));
    const total = chunks.reduce((n, c) => n + c.length, 0);
    let done = 0;
    for (const chunk of chunks) {
      const outcomes = await fetchBatch(chunk);
      if (!current()) return;
      if (lostAccess(outcomes)) {
        setLoaded((p) => ({ ...p, denied: true, busy: false, progress: "" }));
        return;
      }
      done += chunk.length;
      setLoaded((p) => {
        const records = new Map(p.records);
        const failed = new Set(p.failed);
        for (const o of outcomes) {
          if (o.status === "failed") failed.add(o.version);
          else {
            records.set(o.version, o);
            failed.delete(o.version);
          }
        }
        return {
          ...p,
          records,
          failed: [...failed].sort((a, b) => b - a),
          next: advance ? Math.min(p.next, Math.min(...chunk) - 1) : p.next,
          progress:
            total > chunks[0].length ? `Đã tải ${done}/${total} bản…` : "",
        };
      });
      // Lỗi mạng: dừng để người dùng bấm "Thử lại", không dồn thêm yêu cầu.
      if (outcomes.some((o) => o.status === "failed")) break;
    }
    setLoaded((p) => ({ ...p, busy: false, progress: "" }));
  }, []);

  // Trang đầu tải khi mở. StrictMode (chỉ dev) chạy hiệu ứng hai lần; lượt sau hủy lượt trước nhờ latestRequest.
  useEffect(() => {
    void process([pageVersions(latest, PAGE_SIZE)], true);
  }, [latest, process]);

  const more = () => void process([pageVersions(loaded.next, PAGE_SIZE)], true);
  const all = () => {
    const chunks: number[][] = [];
    let next = loaded.next;
    let left = LOAD_ALL_CAP - loaded.records.size;
    while (next >= 1 && left > 0) {
      const chunk = pageVersions(next, Math.min(PAGE_SIZE, left));
      chunks.push(chunk);
      next -= chunk.length;
      left -= chunk.length;
    }
    if (chunks.length) void process(chunks, true);
  };
  const retry = () => {
    const chunks: number[][] = [];
    for (let i = 0; i < loaded.failed.length; i += PAGE_SIZE)
      chunks.push(loaded.failed.slice(i, i + PAGE_SIZE));
    if (chunks.length) void process(chunks, false);
  };

  const lookup = useCallback(
    (id: string) => index.snapshot.persons.get(id) ?? null,
    [index],
  );
  const rows = useMemo(
    () =>
      [...loaded.records.values()]
        .sort((a, b) => b.version - a.version)
        .map((r) => ({
          version: r.version,
          view:
            r.status === "ok" ? describeAudit(r.version, r.data, lookup) : null,
        })),
    [loaded.records, lookup],
  );
  const filtering = event !== "" || needle.trim() !== "";
  const shown = rows.filter((r) =>
    filtering ? r.view && matchesFilter(r.view, { event, text: needle }) : true,
  );

  // Tra tên người thực hiện: mỗi uid một lần (get users/{uid}, rules cho quản trị viên đọc theo mã).
  useEffect(() => {
    for (const r of rows) {
      const actor = r.view?.actorUid;
      if (!actor || asked.current.has(actor)) continue;
      asked.current.add(actor);
      void getDocFromServer(doc(db!, "users", actor)).then(
        (snap) => {
          if (!alive.current) return;
          const data = snap.exists() ? snap.data() : null;
          const name =
            typeof data?.displayName === "string" && data.displayName
              ? data.displayName
              : typeof data?.email === "string" && data.email
                ? data.email
                : "";
          setActors((a) => ({
            ...a,
            [actor]: name
              ? { label: name.slice(0, 120), revoked: data?.enabled !== true }
              : "error",
          }));
        },
        (error: unknown) => {
          // Lỗi tạm thời (mạng...) không được nhớ vĩnh viễn: bỏ khỏi `asked` để lần tải sau tra lại.
          const code =
            error && typeof error === "object" && "code" in error
              ? String((error as { code: unknown }).code)
              : "";
          if (code !== "permission-denied") asked.current.delete(actor);
          if (alive.current) setActors((a) => ({ ...a, [actor]: "error" }));
        },
      );
    }
  }, [rows]);

  const count = loaded.records.size;
  const loadAllLeft = LOAD_ALL_CAP - count;
  return (
    <>
      <div className="tree-toolbar">
        <label>
          Sự kiện
          <select
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            className="form-field"
          >
            <option value="">Tất cả sự kiện</option>
            {AUDIT_EVENTS.map((code) => (
              <option key={code} value={code}>
                {EVENT_LABELS[code]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mã hoặc tên người
          <input
            type="search"
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder="Không cần gõ dấu"
            className="form-field"
          />
        </label>
        <div className="tree-actions">
          <button onClick={onReload} disabled={loaded.busy}>
            Tải lại nhật ký
          </button>
        </div>
      </div>
      {loaded.busy ? (
        <p role="status" className="audit-status">
          {loaded.progress || "Đang tải nhật ký…"}
        </p>
      ) : (
        <p className="audit-status">
          {`Đã tải ${count}/${latest} bản (mới nhất là #${latest}). Bộ lọc chỉ áp dụng trong ${count} bản đã tải${filtering ? `; hiện ${shown.length} bản` : ""}.`}
        </p>
      )}
      {loaded.denied && (
        <p role="alert" className="notice">
          Không đọc được nhật ký: tài khoản đã mất quyền, hoặc quy tắc truy cập
          trên máy chủ chưa cho phép đọc nhật ký. Hãy tải lại trang; nếu vẫn
          lỗi, kiểm tra quy tắc Firestore đã triển khai.
        </p>
      )}
      {loaded.failed.length > 0 && (
        <div role="alert" className="notice">
          Không tải được {loaded.failed.length} bản (lỗi kết nối, chưa rõ có
          thiếu hay không): #{loaded.failed.slice(0, 10).join(", #")}
          {loaded.failed.length > 10 ? "…" : ""}.{" "}
          <button
            className="link-button"
            onClick={retry}
            disabled={loaded.busy}
          >
            Thử lại
          </button>
        </div>
      )}
      <div className="users-table-wrap">
        <table className="users-table audit-table">
          <caption className="sr-only">
            Nhật ký chỉnh sửa, mới nhất trước
          </caption>
          <thead>
            <tr>
              <th scope="col">Phiên bản</th>
              <th scope="col">Thời điểm</th>
              <th scope="col">Người thực hiện</th>
              <th scope="col">Sự kiện</th>
              <th scope="col">Người bị tác động</th>
              <th scope="col">Nội dung thay đổi</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={6}>
                  {loaded.busy
                    ? "Đang tải…"
                    : filtering
                      ? "Không có bản ghi nào khớp bộ lọc trong các bản đã tải."
                      : "Chưa tải được bản ghi nào."}
                </td>
              </tr>
            )}
            {shown.map((r) =>
              r.view ? (
                <AuditRow key={r.version} view={r.view} actors={actors} />
              ) : (
                <tr key={r.version}>
                  <th scope="row" className="audit-version">
                    #{r.version}
                  </th>
                  <td colSpan={5}>
                    Không đọc được bản ghi #{r.version} (thiếu hoặc ngoài phạm
                    vi).
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <div className="audit-more">
        {loaded.next >= 1 && !loaded.denied && (
          <>
            <button className="primary" onClick={more} disabled={loaded.busy}>
              Xem thêm {Math.min(PAGE_SIZE, loaded.next)} bản cũ hơn
            </button>
            <button onClick={all} disabled={loaded.busy || loadAllLeft < 1}>
              Tải toàn bộ (tối đa {LOAD_ALL_CAP} bản)
            </button>
            <p className="tree-meta">
              Còn {loaded.next} bản cũ hơn chưa tải. Mỗi bản là một lượt đọc
              Firestore; “Tải toàn bộ” dừng ở {LOAD_ALL_CAP} bản đã tải, nên có
              thể tốn tới {Math.max(0, Math.min(loaded.next, loadAllLeft))} lượt
              đọc.
            </p>
          </>
        )}
        {loaded.next < 1 && !loaded.busy && !loaded.denied && (
          <p className="tree-meta">Đã tải tới bản cũ nhất (#1).</p>
        )}
      </div>
    </>
  );
}

function PersonCell({ person }: { person: PersonRef }) {
  if (person.link && person.id)
    return (
      <Link to={`/person/${person.id}`} className="tree-name">
        {person.label}
      </Link>
    );
  return (
    <span>
      {person.label}
      {person.hidden && <span className="tree-meta"> (đã ẩn)</span>}
    </span>
  );
}

function AuditRow({
  view,
  actors,
}: {
  view: AuditView;
  actors: Record<string, Actor>;
}) {
  const actor = view.actorUid ? actors[view.actorUid] : undefined;
  return (
    <tr>
      <th scope="row" className="audit-version">
        #{view.version}
      </th>
      <td>{view.time || "—"}</td>
      <td>
        {!view.actorUid ? (
          "Không rõ"
        ) : actor && actor !== "error" ? (
          <>
            {actor.label}
            {actor.revoked && <span className="tree-meta"> (đã thu hồi)</span>}
          </>
        ) : (
          <span title="Chưa tra được tên tài khoản">
            {shortUid(view.actorUid)}
          </span>
        )}
      </td>
      <td>{view.eventLabel}</td>
      <td>
        <PersonCell person={view.person} />
      </td>
      <td>
        <ul className="audit-summary">
          {view.summary.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        <details className="audit-details">
          <summary>Chi tiết</summary>
          <ul className="audit-summary">
            {view.details.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
            <li>Mã bản ghi: auditLogs/edit-{view.version}</li>
            {view.person.id && <li>Mã người: {view.person.id}</li>}
            {view.actorUid && SAFE_UID.test(view.actorUid) && (
              <li>Mã tài khoản thực hiện: {view.actorUid}</li>
            )}
          </ul>
        </details>
      </td>
    </tr>
  );
}
