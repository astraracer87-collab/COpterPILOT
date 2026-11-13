import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Drones from "./pages/Drones";
import Logbook from "./pages/Logbook";
import LiveTraffic from "./pages/LiveTraffic";
import Settings from "./pages/Settings";
import MapPage from "./pages/MapPage";
import WeatherPage from "./pages/WeatherPage";
import Planning from "./pages/Planning";
import PlanningWizard from "./pages/PlanningWizard";
import Flights from "./pages/Flights";
import Flight from "./pages/Flight";
import Profile from "./pages/Profile";
import DroneHistory from "./pages/DroneHistory";
import Briefings from "./pages/Briefings";
import BriefingDetail from "./pages/BriefingDetail";
import LogbookDetail from "./pages/LogbookDetail";
import Glossary from "./pages/Glossary";
import Resources from "./pages/Resources";
import Admin from "./pages/Admin";
import AdminUserDetail from "./pages/AdminUserDetail";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute from "./components/AdminRoute";

export default function App() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Lädt …
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/karte" element={<MapPage />} />
        <Route path="/wetter" element={<WeatherPage />} />
        <Route path="/drohnen" element={<Drones />} />
        <Route path="/drohnen/:droneId/historie" element={<DroneHistory />} />
        <Route path="/flugplanung" element={<Planning />} />
        <Route path="/flugplanung/:id" element={<PlanningWizard />} />
        <Route path="/briefings" element={<Briefings />} />
        <Route path="/briefings/:id" element={<BriefingDetail />} />
        <Route path="/logbuch" element={<Logbook />} />
        <Route path="/logbuch/:id" element={<LogbookDetail />} />
        <Route path="/verkehrsradar" element={<LiveTraffic />} />
        <Route path="/fluege" element={<Flights />} />
        <Route path="/flug/:id" element={<Flight />} />
        <Route path="/profil" element={<Profile />} />
        <Route path="/glossar" element={<Glossary />} />
        <Route path="/ressourcen" element={<Resources />} />
        <Route path="/einstellungen" element={<Settings />} />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <Admin />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/users/:id"
          element={
            <AdminRoute>
              <AdminUserDetail />
            </AdminRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
