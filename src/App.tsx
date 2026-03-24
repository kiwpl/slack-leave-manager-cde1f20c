import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import DashboardPage from "@/pages/DashboardPage";
import SubmitRequestPage from "@/pages/SubmitRequestPage";
import MyRequestsPage from "@/pages/MyRequestsPage";
import RequestDetailPage from "@/pages/RequestDetailPage";
import EditRequestPage from "@/pages/EditRequestPage";
import ProfileSettingsPage from "@/pages/ProfileSettingsPage";
import ManagerDashboardPage from "@/pages/ManagerDashboardPage";
import AdminSettingsPage from "@/pages/AdminSettingsPage";
import UserManagementPage from "@/pages/UserManagementPage";
import PolicyEditorPage from "@/pages/PolicyEditorPage";
import AuditLogPage from "@/pages/AuditLogPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/submit-request" element={<ProtectedRoute><SubmitRequestPage /></ProtectedRoute>} />
            <Route path="/my-requests" element={<ProtectedRoute><MyRequestsPage /></ProtectedRoute>} />
            <Route path="/requests/:id" element={<ProtectedRoute><RequestDetailPage /></ProtectedRoute>} />
            <Route path="/requests/:id/edit" element={<ProtectedRoute><EditRequestPage /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><ProfileSettingsPage /></ProtectedRoute>} />
            <Route path="/manager" element={<ProtectedRoute requiredRoles={["manager", "admin", "superadmin"]}><ManagerDashboardPage /></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute requiredRoles={["admin", "superadmin"]}><AdminSettingsPage /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute requiredRoles={["admin", "superadmin"]}><UserManagementPage /></ProtectedRoute>} />
            <Route path="/admin/policy" element={<ProtectedRoute requiredRoles={["admin", "superadmin"]}><PolicyEditorPage /></ProtectedRoute>} />
            <Route path="/admin/audit-log" element={<ProtectedRoute requiredRoles={["admin", "superadmin"]}><AuditLogPage /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
