// Thống kê trang Tổng quan, trình bày như các trang sổ gia phả: tiêu đề mục, đường kẻ, bảng số liệu.
// Mỗi biểu đồ là <figure> có <figcaption> và <table> thật làm bản thay thế; hình SVG tự vẽ chỉ để nhìn (aria-hidden).
// Dữ liệu lấy từ ảnh chụp cây dùng chung (loadTreeIndex) và là dữ liệu "lúc tải", không tự cập nhật.
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { loadTreeIndex } from "./Tree";
import {
  MAX_LIFESPAN,
  MISSING_PAGE_SIZE,
  computeOverviewStats,
  vnYear,
  type AgeBand,
  type AgeExtreme,
  type MissingGroup,
  type OverviewStats,
  type PersonRef,
} from "./overviewStats";
import { yearsLabel } from "./treeModel";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "empty" }
  | { status: "ready"; stats: OverviewStats; loadedAt: Date };

const nf = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
const pct = (n: number, total: number) =>
  total > 0 ? `${nf.format((n / total) * 100)}%` : "0%";
const loadedLabel = (d: Date) =>
  d.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "short",
  });

export function OverviewStats({ uid }: { uid: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const run = useCallback(
    (force: boolean) => {
      let live = true;
      setState({ status: "loading" });
      loadTreeIndex(uid, force)
        .then((index) => {
          if (!live) return;
          if (!index) return setState({ status: "empty" });
          const now = new Date();
          setState({
            status: "ready",
            loadedAt: now,
            stats: computeOverviewStats(index.snapshot, {
              currentYear: vnYear(now),
            }),
          });
        })
        .catch(() => live && setState({ status: "error" }));
      return () => {
        live = false;
      };
    },
    [uid],
  );
  useEffect(() => run(false), [run]);
  // Nút "Tải lại dữ liệu" bị thay bằng dòng "Đang tải": đưa focus về tiêu đề khối để không mất vị trí.
  const heading = useRef<HTMLHeadingElement | null>(null);
  const reload = () => {
    heading.current?.focus();
    run(true);
  };

  return (
    <div className="stats">
      <h2 tabIndex={-1} ref={heading}>
        Số liệu gia phả
      </h2>
      {state.status === "loading" && (
        <p role="status" className="stats-note">
          Đang tải số liệu…
        </p>
      )}
      {state.status === "empty" && (
        <p role="status" className="notice">
          Chưa có dữ liệu cây. Quản trị viên chưa nạp dữ liệu gia phả.
        </p>
      )}
      {state.status === "error" && (
        <div role="alert" className="notice">
          Không tải được số liệu. Hãy kiểm tra kết nối và quyền truy cập, rồi
          thử lại.{" "}
          <button type="button" onClick={reload}>
            Tải lại dữ liệu
          </button>
        </div>
      )}
      {state.status === "ready" && (
        <>
          <p className="stats-note">
            Theo dữ liệu lúc tải ({loadedLabel(state.loadedAt)}, giờ Việt Nam).
            Tuổi tính theo năm dương trên giao diện: năm{" "}
            {state.stats.currentYear} trừ năm sinh, nên có thể lệch một tuổi.{" "}
            <button type="button" onClick={reload}>
              Tải lại dữ liệu
            </button>
          </p>
          <StatsBody stats={state.stats} />
        </>
      )}
    </div>
  );
}

function StatsBody({ stats }: { stats: OverviewStats }) {
  const { totals, sex, ages } = stats;
  return (
    <>
      <div className="stats-grid">
        <section aria-labelledby="stats-members">
          <h3 id="stats-members">Thành viên</h3>
          <p className="stats-total">
            <b>{nf.format(totals.all)}</b> người trong cây
          </p>
          <dl className="stats-facts">
            <Fact label="Thuộc dòng họ">{nf.format(totals.clan)}</Fact>
            <Fact label="Kết hôn vào">{nf.format(totals.spouse)}</Fact>
            <Fact label="Họ ngoại">{nf.format(totals.external)}</Fact>
          </dl>
        </section>
        <SexFigure sex={sex} />
      </div>

      <section aria-labelledby="stats-ages">
        <h3 id="stats-ages">Tuổi</h3>
        <div className="stats-grid">
          <div>
            <dl className="stats-facts">
              <Fact label="Tuổi thọ cao nhất (cả đang sống và đã mất)">
                <Extreme value={ages.oldest} />
              </Fact>
              <Fact label="Cao tuổi nhất trong số người đang sống">
                <Extreme value={ages.oldestLiving} />
              </Fact>
              <Fact label="Ít tuổi nhất (người đang sống)">
                <Extreme value={ages.youngestLiving} />
              </Fact>
              <Fact label="Tuổi trung bình người đang sống">
                {ages.averageLiving === null
                  ? "Chưa đủ dữ liệu"
                  : `${nf.format(ages.averageLiving)} tuổi, trên ${nf.format(ages.averageLivingN)} người`}
              </Fact>
            </dl>
            <p className="stats-note">
              Đang sống: {nf.format(ages.living)} · Đã mất:{" "}
              {nf.format(ages.deceased)}
              {(ages.deceasedNoBirth > 0 || ages.deceasedNoDeathYear > 0) &&
                ` (trong đó ${[
                  ages.deceasedNoBirth > 0 &&
                    `${nf.format(ages.deceasedNoBirth)} người chưa có năm sinh`,
                  ages.deceasedNoDeathYear > 0 &&
                    `${nf.format(ages.deceasedNoDeathYear)} người chưa rõ năm mất`,
                ]
                  .filter(Boolean)
                  .join(", ")})`}{" "}
              · Chưa đủ dữ liệu tính tuổi: {nf.format(ages.unknown)} · Dữ liệu
              năm cần kiểm tra: {nf.format(ages.invalid)} (bốn nhóm này cộng
              bằng tổng số người; thọ trên {MAX_LIFESPAN} tuổi cũng xếp vào nhóm
              cần kiểm tra). Coi là đang sống khi không có năm mất, không đánh
              dấu “Đã mất”, có năm sinh và không quá {stats.livingMaxAge} tuổi.
            </p>
          </div>
          <Pyramid bands={stats.livingAgeBands} unsynced={sex.allUnsynced} />
        </div>
      </section>

      <section aria-labelledby="stats-where">
        <h3 id="stats-where">Theo chi và theo đời</h3>
        <div className="stats-grid">
          <BarFigure
            title="Số người theo chi"
            firstHead="Chi"
            rows={stats.byBranch.map((r) => ({
              key: `${r.kind}:${r.key}`,
              label: r.label,
              count: r.count,
            }))}
          />
          <BarFigure
            title="Số người thuộc dòng họ theo đời"
            firstHead="Đời"
            rows={stats.byGeneration.map((r) => ({
              key: String(r.generation),
              label:
                r.generation === null ? "Chưa rõ đời" : `Đời ${r.generation}`,
              count: r.count,
            }))}
          />
        </div>
      </section>

      <MissingSection stats={stats} />
    </>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="stats-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function PersonLink({ p }: { p: PersonRef }) {
  return <Link to={`/person/${p.id}`}>{p.name.trim() || "(chưa có tên)"}</Link>;
}

function Extreme({ value }: { value: AgeExtreme | null }) {
  if (!value) return <>Chưa đủ dữ liệu</>;
  return (
    <>
      <b className="stats-age">{value.age} tuổi</b>{" "}
      <span className="stats-names">
        {value.people.map((p, i) => (
          <span key={p.id}>
            {i > 0 && ", "}
            <PersonLink p={p} />
          </span>
        ))}
      </span>
    </>
  );
}

/* ---------- Giới tính: vòng + bảng ---------- */
function SexFigure({ sex }: { sex: OverviewStats["sex"] }) {
  const captionId = useId();
  if (sex.allUnsynced)
    return (
      <section aria-labelledby={captionId}>
        <h3 id={captionId}>Giới tính</h3>
        <p className="stats-note">
          Chưa đồng bộ giới tính: ảnh chụp cây hiện chưa có dữ liệu giới tính
          nên chưa thống kê được.
        </p>
      </section>
    );
  const other = sex.unknown;
  const total = sex.male + sex.female + other + sex.unsynced;
  const rows = [
    { key: "m", label: "Nam", n: sex.male },
    { key: "f", label: "Nữ", n: sex.female },
    { key: "u", label: "Chưa rõ", n: other },
    ...(sex.unsynced > 0
      ? [{ key: "s", label: "Chưa đồng bộ", n: sex.unsynced }]
      : []),
  ];
  return (
    <figure className="stats-figure">
      <figcaption id={captionId}>Giới tính</figcaption>
      <div className="stats-sex">
        <Donut rows={rows} total={total} />
        <table aria-labelledby={captionId}>
          <thead>
            <tr>
              <th scope="col">Giới tính</th>
              <th scope="col" className="num">
                Số người
              </th>
              <th scope="col" className="num">
                Tỷ lệ
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  <span
                    className={`stats-swatch stats-swatch-${r.key}`}
                    aria-hidden="true"
                  />
                  {r.label}
                </th>
                <td className="num">{nf.format(r.n)}</td>
                <td className="num">{pct(r.n, total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function Donut({
  rows,
  total,
}: {
  rows: Array<{ key: string; n: number }>;
  total: number;
}) {
  const r = 40;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg
      className="stats-donut"
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id="stats-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" className="stats-hatch-bg" />
          <rect width="2.5" height="6" className="stats-hatch-line" />
        </pattern>
        <pattern
          id="stats-dots"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <rect width="6" height="6" className="stats-hatch-bg" />
          <circle cx="3" cy="3" r="1.4" className="stats-dots-dot" />
        </pattern>
      </defs>
      <g transform="rotate(-90 60 60)">
        {total > 0 &&
          rows.map((x) => {
            if (x.n === 0) return null;
            const len = (x.n / total) * c;
            const el = (
              <circle
                key={x.key}
                cx="60"
                cy="60"
                r={r}
                fill="none"
                strokeWidth="20"
                className={`stats-seg stats-seg-${x.key}`}
                strokeDasharray={`${Math.max(len - 1, 0)} ${c}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
      </g>
      <text x="60" y="66" textAnchor="middle" className="stats-donut-total">
        {nf.format(total)}
      </text>
    </svg>
  );
}

/* ---------- Tháp tuổi người đang sống ---------- */
function Pyramid({ bands, unsynced }: { bands: AgeBand[]; unsynced: boolean }) {
  const captionId = useId();
  // Tháp hai phía (nam | nữ) chỉ khi có ít nhất một người đã biết giới tính; ngược lại một cột tổng.
  const split = !unsynced && bands.some((b) => b.male + b.female > 0);
  const rows = [...bands].reverse(); // già ở trên, trẻ ở dưới như tháp dân số
  const max = Math.max(
    1,
    ...rows.map((b) => (split ? Math.max(b.male, b.female) : b.total)),
  );
  const W = 360;
  const H = 24;
  const mid = W / 2;
  const room = split ? 128 : 260;
  return (
    <figure className="stats-figure">
      <figcaption id={captionId}>
        Người đang sống theo nhóm 10 tuổi{split ? " và giới tính" : ""}
      </figcaption>
      <svg
        className="stats-pyramid"
        viewBox={`0 0 ${W} ${rows.length * H + (split ? 22 : 0)}`}
        aria-hidden="true"
        focusable="false"
      >
        {split && (
          <>
            <text x={mid - 24} y="14" textAnchor="end" className="stats-axis">
              Nam
            </text>
            <text x={mid + 24} y="14" className="stats-axis">
              Nữ
            </text>
          </>
        )}
        {rows.map((b, i) => {
          const y = i * H + (split ? 22 : 0);
          const len = (n: number) => (n / max) * room;
          return split ? (
            <g key={b.label}>
              <text
                x={mid}
                y={y + 16}
                textAnchor="middle"
                className="stats-axis"
              >
                {b.label}
              </text>
              {b.male > 0 && (
                <>
                  <rect
                    className="stats-seg-m"
                    x={mid - 24 - len(b.male)}
                    y={y + 3}
                    width={len(b.male)}
                    height={H - 8}
                  />
                  <text
                    x={mid - 24 - len(b.male) - 4}
                    y={y + 16}
                    textAnchor="end"
                    className="stats-count"
                  >
                    {b.male}
                  </text>
                </>
              )}
              {b.female > 0 && (
                <>
                  <rect
                    className="stats-seg-f"
                    x={mid + 24}
                    y={y + 3}
                    width={len(b.female)}
                    height={H - 8}
                  />
                  <text
                    x={mid + 24 + len(b.female) + 4}
                    y={y + 16}
                    className="stats-count"
                  >
                    {b.female}
                  </text>
                </>
              )}
            </g>
          ) : (
            <g key={b.label}>
              <text x="0" y={y + 16} className="stats-axis">
                {b.label}
              </text>
              {b.total > 0 && (
                <>
                  <rect
                    className="stats-seg-m"
                    x={52}
                    y={y + 3}
                    width={len(b.total)}
                    height={H - 8}
                  />
                  <text
                    x={52 + len(b.total) + 4}
                    y={y + 16}
                    className="stats-count"
                  >
                    {b.total}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {/* Bản thay thế cho công nghệ hỗ trợ; hình bên trên là hình minh họa của bảng này. */}
      <div className="sr-only">
        <table aria-labelledby={captionId}>
          <thead>
            <tr>
              <th scope="col">Nhóm tuổi</th>
              <th scope="col">Nam</th>
              <th scope="col">Nữ</th>
              <th scope="col">Chưa rõ hoặc chưa đồng bộ giới tính</th>
              <th scope="col">Tổng</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b.label}>
                <th scope="row">{b.label} tuổi</th>
                <td>{b.male}</td>
                <td>{b.female}</td>
                <td>{b.other}</td>
                <td>{b.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {split && (
        <p className="stats-note">
          Người chưa rõ giới tính không nằm trong hai cột Nam/Nữ.
        </p>
      )}
    </figure>
  );
}

/* ---------- Thanh ngang trong bảng: theo chi, theo đời ---------- */
function BarFigure({
  title,
  firstHead,
  rows,
}: {
  title: string;
  firstHead: string;
  rows: Array<{ key: string; label: string; count: number }>;
}) {
  const captionId = useId();
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <figure className="stats-figure">
      <figcaption id={captionId}>{title}</figcaption>
      {rows.length === 0 ? (
        <p className="stats-note">Chưa có dữ liệu.</p>
      ) : (
        <table aria-labelledby={captionId} className="stats-bars">
          <thead>
            <tr>
              <th scope="col">{firstHead}</th>
              <th scope="col">So sánh</th>
              <th scope="col" className="num">
                Số người
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td className="stats-bar-cell">
                  <span
                    className="stats-bar"
                    aria-hidden="true"
                    style={{ width: `${(r.count / max) * 100}%` }}
                  />
                </td>
                <td className="num">{nf.format(r.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}

/* ---------- Hồ sơ còn thiếu thông tin ---------- */
function MissingSection({ stats }: { stats: OverviewStats }) {
  const { missing, sex } = stats;
  const groups = useMemo(
    () => missing.groups.filter((g) => g.people.length > 0),
    [missing.groups],
  );
  return (
    <section aria-labelledby="stats-missing" className="stats-missing">
      <h3 id="stats-missing">Hồ sơ còn thiếu thông tin</h3>
      <p className="stats-note">
        Kiểm theo họ tên, giới tính, năm sinh; người thuộc dòng họ kiểm thêm đời
        và chi. Đời nhỏ hơn đời nhỏ nhất của mọi người khai chi (thủy tổ và các
        đời trên) chưa thuộc chi nào nên không tính là thiếu chi. Năm mất và ghi
        chú không bắt buộc. <b>{nf.format(missing.people)} người</b> thiếu ít
        nhất một mục.
        {sex.allUnsynced
          ? " Chưa kiểm giới tính vì ảnh chụp cây chưa đồng bộ giới tính."
          : sex.unsynced > 0
            ? ` ${nf.format(sex.unsynced)} người chưa đồng bộ giới tính nên chưa kiểm mục này.`
            : ""}
      </p>
      {groups.length === 0 && (
        <p role="status">Không có hồ sơ nào thiếu mục bắt buộc.</p>
      )}
      {groups.map((g) => (
        <MissingList key={g.field} group={g} summaryPrefix="Thiếu " />
      ))}
      {missing.conflicts.length > 0 && (
        <MissingList
          group={{
            field: "birthConflict",
            label: "Năm sinh mâu thuẫn (cần xác minh, không phải thiếu)",
            people: missing.conflicts,
          }}
          summaryPrefix=""
        />
      )}
    </section>
  );
}

function MissingList({
  group,
  summaryPrefix,
}: {
  group: MissingGroup;
  summaryPrefix: string;
}) {
  const [shown, setShown] = useState(MISSING_PAGE_SIZE);
  const rest = group.people.length - shown;
  const list = useRef<HTMLUListElement | null>(null);
  // Sau "Xem thêm": focus vào người đầu tiên vừa hiện để người dùng bàn phím đọc tiếp từ đó.
  const focusFrom = useRef<number | null>(null);
  useEffect(() => {
    if (focusFrom.current === null) return;
    list.current?.querySelectorAll("a")[focusFrom.current]?.focus();
    focusFrom.current = null;
  }, [shown]);
  return (
    <details className="stats-details">
      <summary>
        <span>
          {summaryPrefix}
          {summaryPrefix ? group.label.toLowerCase() : group.label}
        </span>
        <b className="num">{nf.format(group.people.length)} người</b>
      </summary>
      <ul className="stats-people" ref={list}>
        {group.people.slice(0, shown).map((p) => (
          <li key={p.id}>
            <PersonLink p={p} />{" "}
            <span className="tree-meta">
              {[
                p.generation === null ? null : `Đời ${p.generation}`,
                yearsLabel(p),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <button
          type="button"
          onClick={() => {
            focusFrom.current = shown;
            setShown(shown + MISSING_PAGE_SIZE);
          }}
        >
          Xem thêm ({nf.format(Math.min(rest, MISSING_PAGE_SIZE))} trong{" "}
          {nf.format(rest)} người còn lại)
        </button>
      )}
    </details>
  );
}
