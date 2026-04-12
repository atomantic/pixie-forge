import { useState, useEffect } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import GeneratePage from './pages/GeneratePage'
import ImaginePage from './pages/ImaginePage'
import HistoryPage from './pages/HistoryPage'
import ModelsPage from './pages/ModelsPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {})
  }, [])

  const navLink = (to, label) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-indigo-600 text-white'
            : 'text-gray-400 hover:text-white hover:bg-gray-800'
        }`
      }
    >
      {label}
    </NavLink>
  )

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-800 px-6 py-3 flex items-center gap-6">
        <h1 className="text-lg font-semibold text-white mr-4">Pixie Forge</h1>
        <nav className="flex gap-2">
          {navLink('/imagine', 'Imagine')}
          {navLink('/generate', 'Video')}
          {navLink('/history', 'History')}
          {navLink('/models', 'Models')}
          {navLink('/settings', 'Settings')}
        </nav>
        {status?.python && (
          <span className="ml-auto text-xs text-gray-500">
            Python: {status.python}
          </span>
        )}
      </header>
      <main className="flex-1 p-6">
        <Routes>
          <Route path="/" element={<Navigate to="/imagine" replace />} />
          <Route path="/imagine" element={<ImaginePage />} />
          <Route path="/generate" element={<GeneratePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
