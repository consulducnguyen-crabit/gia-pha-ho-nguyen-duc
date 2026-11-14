import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, NavLink, useParams } from "react-router-dom";
import { doc, getDocFromServer } from "firebase/firestore";
import { db } from "./firebase";
import { PersonEdit } from "./PersonEdit";
import { MemberList } from "./MemberList";
import { PersonNameLink } from "./PersonNameLink";
import { PersonDelete } from "./PersonDelete";
import { PersonAdd } from "./PersonAdd";
import { PersonRelations } from "./PersonRelations";
import { PersonUnions } from "./PersonUnions";
import { branchInfo } from "./branchInfo";
import { BranchInfoBox, MergedFromLine } from "./BranchInfoView";
import {
  buildIndex,
  categoryLabel,
  FLAG_LABELS,
  FLAG_ORDER,
  parseSnapshot,
  yearsLabel,
  type SnapPerson,
  type TreeIndex,
} from "./treeModel";

type TreeState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; index: TreeIndex };

// Một lượt đọc tài liệu ảnh chụp cho mỗi phiên đăng nhập (bộ nhớ trong, không lưu ra đĩa).
const cache = new Map<string, Promise<TreeIndex | null>>();
function load(uid: string, force: boolean): Promise<TreeIndex | null> {
  if (!force) {
    const known = cache.get(uid);
    if (known) return known;
  }
  const promise = (async () => {
    const snap = await getDocFromServer(doc(db!, "treeSnapshots", "main"));
    if (!snap.exists()) return null;
    return buildIndex(parseSnapshot(snap.data()));
  })();
  cache.set(uid, promise);
  promise.catch(() => cache.delete(uid));
  return promise;
}

// Dùng chung với trang nhật ký (AuditLog.tsx): cùng một lần đọc ảnh chụp để lấy editVersion và tra tên người.
export { load as loadTreeIndex };

function useTree(uid: string): { state: TreeState; reload: () => void } {
  const [state, setState] = useState<TreeState>({ status: "loading" });
  const run = useCallback(
    (force: boolean) => {
      let live = true;
      setState({ status: "loading" });
      load(uid, force)
        .then((index) => {
          if (live)
            setState(index ? { status: "ready", index } : { status: "empty" });
        })
        .catch(() => {
          if (live)
            setState({
              status: "error",
              message:
                "Không tải được cây gia phả. Hãy kiểm tra kết nối và quyền truy cập, rồi thử lại.",
            });
        });
      return () => {
        live = false;
      };
    },
    [uid],
  );
  useEffect(() => run(false), [run]);
  return { state, reload: () => run(true) };
}

function StateNotice({
  state,
  reload,
}: {
  state: Exclude<TreeState, { status: "ready" }>;
  reload: () => void;
}) {
  if (state.status === "loading")
    return (
      <p role="status" className="notice">
        Đang tải cây gia phả…
      </p>
    );
  if (state.status === "empty")
    return (
      <p role="status" className="notice">
        Chưa có dữ liệu cây. Quản trị viên chưa nạp dữ liệu gia phả.
      </p>
    );
  return (
    <div role="alert" className="notice">
      {state.message}{" "}
      <button onClick={reload} className="link-button">
        Tải lại cây
      </button>
    </div>
  );
}

function years(p: SnapPerson) {
  const label = yearsLabel(p);
  return label ? <span className="tree-years">{label}</span> : null;
}

function PersonLink({ p }: { p: SnapPerson }) {
  return <PersonNameLink p={p} />;
}

function Badges({ index, p }: { index: TreeIndex; p: SnapPerson }) {
  const branch = p.branch
    ? index.snapshot.branches.find((b) => b.code === p.branch)
    : null;
  return (
    <span className="tree-badges">
      {p.generation !== null && (
        <span className="tree-badge">Đời {p.generation}</span>
      )}
      {branch && <span className="tree-badge">{branch.name}</span>}
      {index.isAdoptedChild(p.id) && (
        <span className="tree-badge tree-badge-adopt">Con nuôi</span>
      )}
      {p.flags.length > 0 && (
        <Link
          to="/review-queue"
          className="tree-badge tree-badge-flag"
          title={p.flags.map((f) => FLAG_LABELS[f]).join("; ")}
        >
          Cần kiểm tra
        </Link>
      )}
    </span>
  );
}

function Node({
  index,
  id,
  expanded,
  toggle,
  showExternal,
}: {
  index: TreeIndex;
  id: string;
  expanded: Set<string>;
  toggle: (id: string) => void;
  showExternal: boolean;
}) {
  const p = index.snapshot.persons.get(id)!;
  const kids = index.lineageChildren(id);
  const spouses = index.spouses(id);
  const external = showExternal
    ? index.children(id).filter((c) => !kids.includes(c))
    : [];
  const open = expanded.has(id);
  const hasMore = kids.length > 0 || external.length > 0;
  return (
    <li className="tree-node">
      <div className="tree-row">
        {hasMore ? (
          <button
            className="tree-toggle"
            aria-expanded={open}
            aria-label={`${open ? "Thu gọn" : "Mở"} con cháu của ${p.name}`}
            onClick={() => toggle(id)}
          >
            <span aria-hidden="true">{open ? "−" : "+"}</span>
          </button>
        ) : (
          <span className="tree-toggle tree-leaf" aria-hidden="true" />
        )}
        <div className="tree-body">
          <div>
            <PersonLink p={p} /> {years(p)} <Badges index={index} p={p} />
          </div>
          {spouses.length > 0 && (
            <div className="tree-meta">
              Vợ/chồng:{" "}
              {spouses.map((sid, i) => {
                const s = index.snapshot.persons.get(sid)!;
                return (
                  <span key={sid}>
                    {i > 0 && ", "}
                    <PersonLink p={s} />
                  </span>
                );
              })}
            </div>
          )}
          {kids.length > 0 && !open && (
            <div className="tree-meta">
              {index.descendantCount(id)} người trong nhánh
            </div>
          )}
        </div>
      </div>
      {open && hasMore && (
        <ul className="tree-list">
          {kids.map((kid) => (
            <Node
              key={kid}
              index={index}
              id={kid}
              expanded={expanded}
              toggle={toggle}
              showExternal={showExternal}
            />
          ))}
          {external.map((cid) => {
            const c = index.snapshot.persons.get(cid)!;
            return (
              <li key={cid} className="tree-node tree-external">
                <div className="tree-row">
                  <span className="tree-toggle tree-leaf" aria-hidden="true" />
                  <div className="tree-body">
                    <PersonLink p={c} /> {years(c)}{" "}
                    <span className="tree-badge">Họ ngoại</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function initialExpanded(index: TreeIndex, from: string, levels: number) {
  const out = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (depth >= levels) return;
    const kids = index.lineageChildren(id);
    if (kids.length) out.add(id);
    for (const kid of kids) walk(kid, depth + 1);
  };
  walk(from, 0);
  return out;
}

export function TreePage({
  uid,
  isAdmin = false,
}: {
  uid: string;
  isAdmin?: boolean;
}) {
  const { state, reload } = useTree(uid);
  const { "*": sub = "" } = useParams();
  if (sub !== "" && sub !== "danh-sach") return <Navigate to="/tree" replace />;
  if (state.status !== "ready")
    return (
      <>
        <h1>Cây gia phả</h1>
        <StateNotice state={state} reload={reload} />
      </>
    );
  return (
    <TreeView
      key={state.index.snapshot.dataVersion}
      index={state.index}
      isAdmin={isAdmin}
      view={sub === "danh-sach" ? "list" : "tree"}
    />
  );
}

// Hai chế độ xem của trang cây, mỗi chế độ một đường dẫn riêng (liên kết, nút Quay lại).
function ViewTabs() {
  return (
    <div className="tree-tabs" role="group" aria-label="Chế độ xem">
      <NavLink to="/tree" end>
        Sơ đồ cây
      </NavLink>
      <NavLink to="/tree/danh-sach">Danh sách thành viên</NavLink>
    </div>
  );
}

function TreeView({
  index,
  isAdmin,
  view,
}: {
  index: TreeIndex;
  isAdmin: boolean;
  view: "tree" | "list";
}) {
  const [branch, setBranch] = useState("");
  const [query, setQuery] = useState("");
  const [showExternal, setShowExternal] = useState(false);
  const start = useMemo(() => {
    const b = index.snapshot.branches.find((x) => x.code === branch);
    return b?.founderId ?? index.root;
  }, [index, branch]);
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    start ? initialExpanded(index, start, 3) : new Set(),
  );
  useEffect(() => {
    setExpanded(start ? initialExpanded(index, start, 3) : new Set());
  }, [index, start]);
  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const results = useMemo(() => index.search(query), [index, query]);
  const selectedBranch = useMemo(
    () => branchInfo(index.snapshot, branch, { isAdmin }),
    [index, branch, isAdmin],
  );
  const clanCount = useMemo(
    () =>
      [...index.snapshot.persons.values()].filter((p) => p.category === "CLAN")
        .length,
    [index],
  );
  const maxGeneration = useMemo(
    () =>
      Math.max(
        0,
        ...[...index.snapshot.persons.values()].map((p) => p.generation ?? 0),
      ),
    [index],
  );
  const expandAll = () => {
    if (!start) return;
    const all = new Set<string>();
    const walk = (id: string) => {
      if (index.lineageChildren(id).length || showExternal) all.add(id);
      for (const kid of index.lineageChildren(id)) walk(kid);
    };
    walk(start);
    setExpanded(all);
  };
  if (view === "list")
    return (
      <>
        <h1>Danh sách thành viên</h1>
        <ViewTabs />
        <MemberList
          snapshot={index.snapshot}
          renderMeta={(p) => (
            <>
              {years(p)} <Badges index={index} p={p} />{" "}
              <span className="tree-meta">{categoryLabel(p.category)}</span>
            </>
          )}
        />
      </>
    );
  return (
    <>
      <h1>Cây gia phả</h1>
      <ViewTabs />
      {isAdmin && (
        <p className="tree-add-member">
          <Link className="primary link" to="/add-member">
            + Thêm thành viên
          </Link>
        </p>
      )}
      <p className="tree-summary">
        {clanCount} thành viên thuộc dòng họ, {maxGeneration} đời. Bấm tên để
        xem hồ sơ.
      </p>
      <div className="tree-toolbar">
        <label>
          Tìm theo tên
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Không cần gõ dấu"
            className="form-field"
          />
        </label>
        <label>
          Xem theo chi
          <select
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            className="form-field"
          >
            <option value="">Toàn họ</option>
            {index.snapshot.branches.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="tree-check">
          <input
            type="checkbox"
            checked={showExternal}
            onChange={(event) => setShowExternal(event.target.checked)}
            className="checkbox-field"
          />
          Hiện con của con gái (họ ngoại)
        </label>
        <div className="tree-actions">
          <button onClick={expandAll}>Mở rộng tất cả</button>
          <button onClick={() => setExpanded(new Set())}>Thu gọn tất cả</button>
        </div>
      </div>
      {selectedBranch && (
        <BranchInfoBox key={selectedBranch.code} info={selectedBranch} />
      )}
      {query.trim() && (
        <section aria-label="Kết quả tìm kiếm" className="tree-results">
          <h2>
            {results.length
              ? `${results.length} kết quả${results.length === 50 ? " (hiện 50 đầu tiên)" : ""}`
              : "Không tìm thấy thành viên phù hợp"}
          </h2>
          <ul>
            {results.map((p) => (
              <li key={p.id}>
                <PersonLink p={p} /> {years(p)} <Badges index={index} p={p} />{" "}
                <span className="tree-meta">{categoryLabel(p.category)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {start ? (
        <ul className="tree-list tree-root" aria-label="Cây gia phả">
          <Node
            index={index}
            id={start}
            expanded={expanded}
            toggle={toggle}
            showExternal={showExternal}
          />
        </ul>
      ) : (
        <p role="status" className="notice">
          Chưa xác định được thủy tổ để dựng cây.
        </p>
      )}
    </>
  );
}

function Relatives({
  title,
  index,
  ids,
  adoptiveOf,
}: {
  title: string;
  index: TreeIndex;
  ids: string[];
  adoptiveOf?: string;
}) {
  if (!ids.length) return null;
  return (
    <section>
      <h2>{title}</h2>
      <ul className="tree-links">
        {ids.map((rid) => {
          const p = index.snapshot.persons.get(rid)!;
          const adoptive = adoptiveOf
            ? index.parents(rid).some((x) => x.id === adoptiveOf && x.adoptive)
            : false;
          return (
            <li key={rid}>
              <PersonLink p={p} /> {years(p)}
              {adoptive && (
                <span className="tree-badge tree-badge-adopt">Con nuôi</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function PersonPage({
  uid,
  canEdit = false,
}: {
  uid: string;
  canEdit?: boolean;
}) {
  const { id = "" } = useParams();
  const { state, reload } = useTree(uid);
  const [saved, setSaved] = useState<{ id: string; message: string } | null>(
    null,
  );
  const savedRef = useRef<HTMLParagraphElement | null>(null);
  const ready = state.status === "ready";
  // Đưa focus tới thông báo đã lưu (vừa công bố cho trình đọc màn hình, vừa không mất focus).
  useEffect(() => {
    if (ready && saved?.id === id) savedRef.current?.focus();
  }, [ready, saved, id]);
  if (state.status !== "ready")
    return (
      <>
        <h1>Hồ sơ thành viên</h1>
        <StateNotice state={state} reload={reload} />
      </>
    );
  const index = state.index;
  const p = index.snapshot.persons.get(id);
  if (!p)
    return (
      <>
        <h1>Hồ sơ thành viên</h1>
        <p role="alert" className="notice">
          Không tìm thấy thành viên này.{" "}
          <Link to="/tree">Quay lại cây gia phả</Link>
        </p>
      </>
    );
  const profileBranch = branchInfo(index.snapshot, p.branch, {
    isAdmin: false,
  });
  const path = p.category === "CLAN" ? index.lineagePath(id) : [];
  const parents = index.parents(id);
  const siblings = index.siblings(id);
  const childIds = index.children(id);
  const sameName = p.flags.includes("DUP_NAME")
    ? [...index.snapshot.persons.values()].filter(
        (o) =>
          o.id !== id &&
          o.name === p.name &&
          o.generation !== null &&
          o.generation === p.generation,
      )
    : [];
  return (
    <>
      <p className="tree-back">
        <Link to="/tree">← Cây gia phả</Link>
      </p>
      <h1>{p.name}</h1>
      {saved?.id === id && (
        <p role="status" className="notice" tabIndex={-1} ref={savedRef}>
          {saved.message}
        </p>
      )}
      <div className="profile">
        <div className="profile-actions">
          {canEdit && (
            <PersonEdit
              key={`${id}:${index.snapshot.editVersion}`}
              index={index}
              p={p}
              uid={uid}
              onReload={() => {
                setSaved(null);
                reload();
              }}
              onSaved={(message) => {
                setSaved({ id, message });
                reload();
              }}
            />
          )}
          {canEdit && (
            <PersonAdd
              key={`add:${id}:${index.snapshot.editVersion}`}
              index={index}
              p={p}
              uid={uid}
              onReload={() => {
                setSaved(null);
                reload();
              }}
              onSaved={(message, focusId) => {
                setSaved({ id: focusId, message });
                reload();
              }}
            />
          )}
          {canEdit && (
            <PersonRelations
              key={`rel:${id}:${index.snapshot.editVersion}`}
              onStart={() => setSaved(null)}
              index={index}
              p={p}
              uid={uid}
              onReload={() => {
                setSaved(null);
                reload();
              }}
              onSaved={(message, focusId) => {
                setSaved({ id: focusId, message });
                reload();
              }}
            />
          )}
          {canEdit && (
            <PersonUnions
              key={`uni:${id}:${index.snapshot.editVersion}`}
              onStart={() => setSaved(null)}
              index={index}
              p={p}
              uid={uid}
              onReload={() => {
                setSaved(null);
                reload();
              }}
              onSaved={(message, focusId) => {
                setSaved({ id: focusId, message });
                reload();
              }}
            />
          )}
          {canEdit && (
            <PersonDelete
              key={`del:${id}:${index.snapshot.editVersion}`}
              onStart={() => setSaved(null)}
              index={index}
              p={p}
              uid={uid}
              onReload={() => {
                setSaved(null);
                reload();
              }}
              onSaved={(message, focusId) => {
                setSaved({ id: focusId, message });
                reload();
              }}
            />
          )}
        </div>
        <div className="profile-main">
          <p className="tree-profile-meta">
            {years(p)} <Badges index={index} p={p} />{" "}
            <span className="tree-meta">{categoryLabel(p.category)}</span>
          </p>
          {profileBranch && <MergedFromLine info={profileBranch} />}
          {p.flags.length > 0 && (
            <section className="tree-flag-box">
              <h2>Cần kiểm tra</h2>
              <ul>
                {p.flags.map((f) => (
                  <li key={f}>{FLAG_LABELS[f]}</li>
                ))}
              </ul>
              {p.flags.includes("DUP_NAME") && sameName.length > 0 && (
                <>
                  <p className="tree-meta">Người trùng họ tên, cùng đời:</p>
                  <ul className="tree-links">
                    {sameName.map((o) => (
                      <li key={o.id}>
                        <PersonLink p={o} /> {years(o)}
                        {o.branch && (
                          <span className="tree-meta">
                            {" "}
                            ·{" "}
                            {index.snapshot.branches.find(
                              (b) => b.code === o.branch,
                            )?.name ?? o.branch}
                          </span>
                        )}
                        {index.spouses(o.id).length > 0 && (
                          <span className="tree-meta">
                            {" "}
                            · Vợ/chồng:{" "}
                            {index
                              .spouses(o.id)
                              .map((s) => index.snapshot.persons.get(s)?.name)
                              .join(", ")}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="tree-meta">
                Thông tin này đang được đối chiếu với tài liệu gốc. Nếu bạn biết
                rõ, hãy báo cho quản trị viên gia phả.
              </p>
            </section>
          )}
          {path.length > 1 && (
            <section>
              <h2>Dòng tổ tiên</h2>
              <ol className="tree-path">
                {path.map((pid) => {
                  const a = index.snapshot.persons.get(pid)!;
                  return (
                    <li key={pid}>
                      {pid === id ? <b>{a.name}</b> : <PersonLink p={a} />}
                      {a.generation !== null && (
                        <span className="tree-meta"> · Đời {a.generation}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
          <Relatives
            title="Cha mẹ"
            index={index}
            ids={parents.map((x) => x.id)}
          />
          <Relatives title="Vợ/chồng" index={index} ids={index.spouses(id)} />
          <Relatives title="Con" index={index} ids={childIds} adoptiveOf={id} />
          <Relatives title="Anh chị em" index={index} ids={siblings} />
          {p.birthYear === null && p.deathYear === null && (
            <p className="tree-meta">
              Chưa có năm sinh hoặc năm mất trong gia phả.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

export function ReviewQueuePage({ uid }: { uid: string }) {
  const { state, reload } = useTree(uid);
  if (state.status !== "ready")
    return (
      <>
        <h1>Cần kiểm tra</h1>
        <StateNotice state={state} reload={reload} />
      </>
    );
  const index = state.index;
  const everyone = [...index.snapshot.persons.values()];
  const flagged = everyone.filter((p) => p.flags.length > 0);
  return (
    <>
      <h1>Cần kiểm tra</h1>
      <p className="tree-summary">
        Tài liệu gia phả gốc được biên soạn qua nhiều giai đoạn nên còn một số
        chỗ chưa chắc chắn. {flagged.length} người đang được gắn nhãn để đối
        chiếu; họ vẫn có mặt trong cây. Nếu bạn biết rõ, hãy báo cho quản trị
        viên.
      </p>
      {flagged.length === 0 && (
        <p role="status" className="notice">
          Hiện không có mục nào cần kiểm tra.
        </p>
      )}
      {FLAG_ORDER.map((code) => {
        const people = flagged.filter((p) => p.flags.includes(code));
        if (!people.length) return null;
        return (
          <section key={code} aria-label={FLAG_LABELS[code]}>
            <h2>
              {FLAG_LABELS[code]}{" "}
              <span className="tree-meta">({people.length})</span>
            </h2>
            <ul className="tree-links">
              {people.map((p) => (
                <li key={p.id}>
                  <PersonLink p={p} /> {years(p)} <Badges index={index} p={p} />{" "}
                  <span className="tree-meta">{categoryLabel(p.category)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
