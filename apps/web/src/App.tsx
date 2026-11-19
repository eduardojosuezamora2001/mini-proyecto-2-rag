import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AuthProvider } from "./auth/AuthContext"
import { RequireAuth } from "./components/RequireAuth"
import { RequireRole } from "./components/RequireRole"
import { AppLayout } from "./components/AppLayout"
import { ChatPage } from "./pages/ChatPage"
import { DashboardPage } from "./pages/DashboardPage"
import { DocumentsPage } from "./pages/DocumentsPage"
import { AttendancePage } from "./pages/AttendancePage"
import { AttendanceKioskPage } from "./pages/AttendanceKioskPage"
import { LoginPage } from "./pages/LoginPage"
import "./App.css"

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/asistencia" element={<AttendanceKioskPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/chat" replace />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route
                path="/attendance"
                element={
                  <RequireRole role="colaborador">
                    <AttendancePage />
                  </RequireRole>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <RequireRole role="rrhh">
                    <DashboardPage />
                  </RequireRole>
                }
              />
              <Route
                path="/documents"
                element={
                  <RequireRole role="rrhh">
                    <DocumentsPage />
                  </RequireRole>
                }
              />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
