export interface Person {
  id: string;
  displayName: string;
  normalizedName: string;
  profileVersion: number;
}
export interface Relation {
  parentId: string;
  childId: string;
  verificationStatus: string;
}
export function createsCycle(
  relations: Relation[],
  parentId: string,
  childId: string,
): boolean {
  const visited = new Set<string>();
  const pending = [childId];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === parentId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const r of relations) if (r.parentId === id) pending.push(r.childId);
  }
  return false;
}
export function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi")
    .trim();
}
