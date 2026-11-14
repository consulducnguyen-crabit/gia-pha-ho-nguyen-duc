// Danh sách thành viên theo thứ tự: tên → tên đệm → chi → đời (chỉ để hiển thị, không ghi dữ liệu).
// Ảnh chụp cây chỉ có một chuỗi họ tên nên tách ở đây: từ đầu là họ, từ cuối là tên, các từ giữa là tên đệm.
import { normalizeName } from "./domain";
import type { SnapBranch, SnapPerson } from "./treeModel";

/**
 * Danh hiệu lịch sử đứng thay cho tên, KHÔNG phải họ tên: "Cụ cao tổ" không có nghĩa là người tên "Tổ".
 * Thêm danh hiệu khác vào đây khi có quyết định (so khớp không phân biệt hoa thường và dấu).
 */
export const HISTORIC_TITLES = ["Cụ cao tổ"] as const;

const TITLE_WORDS = HISTORIC_TITLES.map((t) =>
  normalizeName(t).split(/\s+/).filter(Boolean),
);

export interface ParsedName {
  /** Có danh hiệu lịch sử đứng đầu chuỗi (đã loại khỏi các trường bên dưới). */
  title: string | null;
  family: string;
  middle: string[];
  given: string;
  /** Chỉ có danh hiệu, không có tên riêng: nhân vật lịch sử. */
  historic: boolean;
}

const collator = new Intl.Collator("vi");
export const compareVi = (a: string, b: string) => collator.compare(a, b);

export function parseName(raw: string): ParsedName {
  const words = raw.normalize("NFC").trim().split(/\s+/).filter(Boolean);
  const folded = words.map((w) => normalizeName(w));
  let title: string | null = null;
  let rest = words;
  for (let i = 0; i < TITLE_WORDS.length; i++) {
    const t = TITLE_WORDS[i];
    if (t.length && t.every((w, j) => folded[j] === w)) {
      title = HISTORIC_TITLES[i];
      rest = words.slice(t.length);
      break;
    }
  }
  if (rest.length === 0)
    return {
      title,
      family: "",
      middle: [],
      given: "",
      historic: title !== null,
    };
  if (rest.length === 1)
    return {
      title,
      family: "",
      middle: [],
      given: rest[0],
      historic: false,
    };
  return {
    title,
    family: rest[0],
    middle: rest.slice(1, -1),
    given: rest[rest.length - 1],
    historic: false,
  };
}

function compareMiddle(a: string[], b: string[]) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = compareVi(a[i], b[i]);
    if (c) return c;
  }
  return a.length - b.length; // ít từ đệm hơn xếp trước
}

const rank = (n: number | null) => (n === null ? Number.POSITIVE_INFINITY : n);
function compareNum(a: number, b: number) {
  if (a === b) return 0; // tránh Infinity - Infinity = NaN
  return a < b ? -1 : 1;
}

export interface MemberRow {
  person: SnapPerson;
  name: ParsedName;
  /** Chữ cái đầu của tên để chia nhóm; nhân vật lịch sử / chưa rõ tên có nhóm riêng. */
  group: string;
}

/** Chữ cái đầu của tên, bỏ dấu thanh nhưng giữ Ă Â Đ Ê Ô Ơ Ư (là chữ cái riêng trong tiếng Việt). */
export function initialOf(given: string) {
  const first = [...given.normalize("NFD")][0];
  if (!first) return "";
  const rest = given
    .normalize("NFD")
    .slice(first.length)
    .match(/^[̀-ͯ]*/)![0]
    .replace(/[̣̀́̃̉]/g, "");
  return (first + rest).normalize("NFC").toLocaleUpperCase("vi");
}

export const HISTORIC_GROUP = "Nhân vật lịch sử";
export const UNKNOWN_GROUP = "Chưa rõ tên";

export function sortMembers(
  persons: Iterable<SnapPerson>,
  branches: SnapBranch[],
): MemberRow[] {
  const branchOrder = new Map(branches.map((b, i) => [b.code, i]));
  const branchRank = (p: SnapPerson) =>
    p.branch === null
      ? Number.POSITIVE_INFINITY
      : (branchOrder.get(p.branch) ?? Number.POSITIVE_INFINITY);
  const rows: MemberRow[] = [...persons].map((person) => {
    const name = parseName(person.name);
    const group = name.historic
      ? HISTORIC_GROUP
      : name.given
        ? initialOf(name.given)
        : UNKNOWN_GROUP;
    return { person, name, group };
  });
  // Thứ tự nhóm: nhân vật lịch sử (đầu) → tên theo bảng chữ cái → chưa rõ tên (cuối).
  const section = (r: MemberRow) =>
    r.group === HISTORIC_GROUP ? 0 : r.group === UNKNOWN_GROUP ? 2 : 1;
  rows.sort((x, y) => {
    const s = section(x) - section(y);
    if (s) return s;
    if (section(x) === 1) {
      const byGiven = compareVi(x.name.given, y.name.given);
      if (byGiven) return byGiven;
      const byMiddle = compareMiddle(x.name.middle, y.name.middle);
      if (byMiddle) return byMiddle;
    }
    const byBranch = compareNum(branchRank(x.person), branchRank(y.person));
    if (byBranch) return byBranch;
    const byGen = compareNum(
      rank(x.person.generation),
      rank(y.person.generation),
    );
    if (byGen) return byGen;
    // Ổn định: họ rồi mã người, để thứ tự không đổi giữa các lần hiển thị.
    return (
      compareVi(x.name.family, y.name.family) ||
      (x.person.id < y.person.id ? -1 : x.person.id > y.person.id ? 1 : 0)
    );
  });
  return rows;
}
