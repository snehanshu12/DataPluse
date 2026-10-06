const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  ask: (source, question, opts = {}) =>
    ipcRenderer.invoke('ask', { source, question, history: opts.history }),
  getStarters: (source, refresh = false) =>
    ipcRenderer.invoke('get-starters', { source, refresh }),
  getTablePreview: (source, table, limit) =>
    ipcRenderer.invoke('get-table-preview', { source, table, limit }),
  getDashboard: (source, request) => ipcRenderer.invoke('get-dashboard', { source, request }),
  getEnv: () => ipcRenderer.invoke('get-env'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  removeSource: (source) => ipcRenderer.invoke('remove-source', source),
  clearSources: () => ipcRenderer.invoke('clear-sources'),
  pickSqlite: () => ipcRenderer.invoke('pick-sqlite'),
  pickCsv: () => ipcRenderer.invoke('pick-csv'),
  importCsv: ({ path, table }) => ipcRenderer.invoke('import-csv', { path, table }),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard-write', text),
})