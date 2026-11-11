// Chặn `--replace` khi đã có sửa trong app: nạp lại sẽ GHI ĐÈ các sửa đó (xem docs/IN_APP_EDIT.md).
// Hàm thuần, có test. Quyết định 2026-11-11: sau mốc editVersion > 0, prod không được --replace.

/** Mọi sự kiện nhật ký do sửa trong app tạo ra (đánh số editVersion). */
export const EDIT_EVENTS = [
  "PERSON_EDITED",
  "PERSON_ADDED",
  "SPOUSE_ADDED",
  "PARENT_CHANGED",
  "RELATION_TYPE_CHANGED",
  "PERSON_DELETED",
  "PERSON_RESTORED",
];

export interface ReplaceCheck {
  kind: "emulator" | "dev" | "prod";
  /** Số lớn nhất của editVersion trong ảnh chụp và nhật ký sửa. */
  editVersion: number;
  /** Cờ --discard-app-edits (chỉ có tác dụng ngoài prod). */
  discardAppEdits: boolean;
}

export function evaluateReplace(c: ReplaceCheck): {
  ok: boolean;
  reason?: string;
} {
  if (c.editVersion <= 0) return { ok: true };
  if (c.kind === "prod")
    return {
      ok: false,
      reason: `Production đã có ${c.editVersion} lần sửa trong app; --replace bị cấm vì sẽ ghi đè các sửa đó. Dùng khôi phục từ sao lưu hoặc sửa trong app.`,
    };
  if (!c.discardAppEdits)
    return {
      ok: false,
      reason: `Đã có ${c.editVersion} lần sửa trong app; --replace sẽ ghi đè. Thêm --discard-app-edits nếu thật sự muốn bỏ chúng (chỉ emulator/dev).`,
    };
  return { ok: true };
}
