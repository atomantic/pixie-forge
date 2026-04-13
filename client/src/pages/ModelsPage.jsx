import { useState, useEffect } from 'react'

export default function ModelsPage() {
  const [data, setData] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { loadModels() }, [])

  function loadModels() {
    fetch('/api/models').then(r => r.json()).then(setData).catch(() => {})
  }

  async function deleteModel(dirName) {
    setDeleting(dirName)
    await fetch(`/api/models/hf/${dirName}`, { method: 'DELETE' })
    setConfirmDelete(null)
    setDeleting(null)
    loadModels()
  }

  async function deleteLora(filename) {
    setDeleting(filename)
    await fetch(`/api/models/lora/${filename}`, { method: 'DELETE' })
    setConfirmDelete(null)
    setDeleting(null)
    loadModels()
  }

  if (!data) return <p className="text-gray-500">Loading models...</p>

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Model Manager</h2>
        <button onClick={loadModels} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded border border-gray-600">
          Refresh
        </button>
      </div>

      {/* Disk Usage Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Models', value: data.diskUsage.models, color: 'text-indigo-400' },
          { label: 'LoRAs', value: data.diskUsage.loras, color: 'text-purple-400' },
          { label: 'Images', value: data.diskUsage.images, color: 'text-green-400' },
          { label: 'Total', value: data.diskUsage.total, color: 'text-white' },
        ].map(item => (
          <div key={item.label} className="bg-gray-900 border border-gray-700 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-1">{item.label}</div>
            <div className={`text-lg font-semibold ${item.color}`}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* HuggingFace Models */}
      <section>
        <h3 className="text-sm font-medium text-gray-300 mb-3">Cached Models ({data.models.length})</h3>
        <div className="space-y-2">
          {data.models.map(model => (
            <div key={model.id} className="bg-gray-900 border border-gray-700 rounded-lg p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-200 truncate">{model.repo}</span>
                  {model.label && (
                    <span className="text-xs px-2 py-0.5 bg-indigo-600/20 text-indigo-300 rounded border border-indigo-700 whitespace-nowrap">
                      {model.label}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-sm text-gray-400 whitespace-nowrap">{model.sizeHuman}</span>
              {confirmDelete === model.id ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => deleteModel(model.id)}
                    disabled={deleting === model.id}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white text-xs font-medium rounded"
                  >
                    {deleting === model.id ? 'Deleting...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(model.id)}
                  className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs rounded border border-red-700"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
          {data.models.length === 0 && (
            <p className="text-gray-500 text-sm">No cached models found.</p>
          )}
        </div>
      </section>

      {/* LoRA Files */}
      <section>
        <h3 className="text-sm font-medium text-gray-300 mb-3">LoRA Files ({data.loras.length})</h3>
        <p className="text-xs text-gray-500 mb-3">Drop .safetensors files into ~/.pixie-forge/loras/ to add more.</p>
        <div className="space-y-2">
          {data.loras.map(lora => (
            <div key={lora.filename} className="bg-gray-900 border border-gray-700 rounded-lg p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-200">{lora.name}</span>
              </div>
              <span className="text-sm text-gray-400 whitespace-nowrap">{lora.sizeHuman}</span>
              {confirmDelete === lora.filename ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => deleteLora(lora.filename)}
                    disabled={deleting === lora.filename}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white text-xs font-medium rounded"
                  >
                    {deleting === lora.filename ? 'Deleting...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(lora.filename)}
                  className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs rounded border border-red-700"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
          {data.loras.length === 0 && (
            <p className="text-gray-500 text-sm">No LoRA files found.</p>
          )}
        </div>
      </section>

      <p className="text-xs text-gray-600">
        Deleted models will re-download automatically the next time they are used for generation.
      </p>
    </div>
  )
}
