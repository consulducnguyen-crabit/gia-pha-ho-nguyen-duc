// Cho các thành phần sâu (nhãn "Cần kiểm tra" trên cây/danh sách) biết người xem có phải quản trị viên không.
// Chỉ ẩn/hiện giao diện; quyền đọc dữ liệu vẫn do firestore.rules quyết định.
import { createContext, useContext } from "react";

export const AdminViewContext = createContext(false);
export const useAdminView = () => useContext(AdminViewContext);
