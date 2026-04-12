import { useState, useEffect } from 'react'

export default function SettingsPage() {
  const [settings, setSettings] = useState(null)
  const [detecting, setDetecting] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installLog, setInstallLog] = useState([])

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(data => {
      setSettings(data)
      // Auto-validate if python is already configured
      if (data.pythonPath) {
        runValidation()
      }
    }).catch(() => {})
  }, [])

  async function runValidation() {
    setValidating(true)
    setValidationResult(null)
    const res = await fetch('/api/settings/validate', { method: 'POST' })
    const data = await res.json()
    setValidationResult(data)
    setValidating(false)
    return data
  }

  async function detectPython() {
    setDetecting(true)
    try {
      const res = await fetch('/api/settings/detect-python', { method: 'POST' })
      const data = await res.json()
      if (data.path) {
        const updated = { ...settings, pythonPath: data.path }
        setSettings(updated)
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        })
        await runValidation()
      }
    } finally {
      setDetecting(false)
    }
  }

  async function validateSetup() {
    await runValidation()
  }

  async function saveSettings() {
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
    } finally {
      setSaving(false)
    }
  }

  async function installPackages() {
    if (!validationResult?.missingPackages?.length) return
    setInstalling(true)
    setInstallLog([])

    const packages = validationResult.missingPackages.join(',')
    const es = new EventSource(`/api/settings/install-packages?packages=${encodeURIComponent(packages)}`)

    es.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'log') {
        setInstallLog(prev => [...prev, msg.message])
      } else if (msg.type === 'complete') {
        setInstallLog(prev => [...prev, msg.message])
        setInstalling(false)
        setValidationResult(null)
        es.close()
        // Re-validate after install
        validateSetup()
      } else if (msg.type === 'error') {
        setInstallLog(prev => [...prev, `ERROR: ${msg.message}`])
        setInstalling(false)
        es.close()
      }
    }
    es.onerror = () => {
      setInstalling(false)
      es.close()
    }
  }

  if (!settings) return <p className="text-gray-500">Loading settings...</p>

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h2 className="text-xl font-semibold text-white">Settings</h2>

      {/* Python Path */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-300">Python Environment</h3>
        <div className="flex gap-3">
          <input
            type="text"
            value={settings.pythonPath || ''}
            onChange={e => setSettings(s => ({ ...s, pythonPath: e.target.value }))}
            placeholder="/usr/bin/python3"
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
          />
          <button onClick={detectPython} disabled={detecting} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded border border-gray-600">
            {detecting ? 'Detecting...' : 'Auto Detect'}
          </button>
        </div>
        <button onClick={validateSetup} disabled={validating} className="px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 text-sm rounded border border-indigo-700">
          {validating ? 'Validating...' : 'Validate Setup'}
        </button>
        {validationResult && (
          <div className={`p-3 rounded text-sm ${validationResult.success ? 'bg-green-900/30 border border-green-700 text-green-300' : 'bg-red-900/30 border border-red-700 text-red-300'}`}>
            {validationResult.message}
            {validationResult.missingPackages?.length > 0 && (
              <>
                <p className="mt-2">Missing: {validationResult.missingPackages.join(', ')}</p>
                <button
                  onClick={installPackages}
                  disabled={installing}
                  className="mt-3 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded"
                >
                  {installing ? 'Installing...' : 'Install Missing Packages'}
                </button>
              </>
            )}
          </div>
        )}
        {installLog.length > 0 && (
          <div className="bg-gray-950 border border-gray-700 rounded p-3 max-h-64 overflow-y-auto font-mono text-xs text-gray-400 space-y-0.5">
            {installLog.map((line, i) => (
              <div key={i} className={line.startsWith('ERROR') ? 'text-red-400' : line.includes('Successfully') ? 'text-green-400' : ''}>{line}</div>
            ))}
          </div>
        )}
      </section>

      {/* Output Directory */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-300">Output Directory</h3>
        <input
          type="text"
          value={settings.outputDir || ''}
          onChange={e => setSettings(s => ({ ...s, outputDir: e.target.value }))}
          placeholder="Leave blank for default (~/.ltx-web-local/videos)"
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
        />
      </section>

      {/* ElevenLabs */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-300">ElevenLabs API Key (optional, for voiceover/music)</h3>
        <input
          type="password"
          value={settings.elevenLabsApiKey || ''}
          onChange={e => setSettings(s => ({ ...s, elevenLabsApiKey: e.target.value }))}
          placeholder="Enter API key..."
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
        />
      </section>

      <button onClick={saveSettings} disabled={saving} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg">
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  )
}
