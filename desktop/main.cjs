const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron')
const { spawn } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

/** Locate the datapulse project root (folder with package.json + data/ecommerce.db). */
function findProjectRoot() {
  if (process.env.CP_ROOT) return process.env.CP_ROOT
  let dir = __dirname
  for (;;) {
    const pkg = path.join(dir, 'package.json')
    const db = path.join(dir, 'data', 'ecommerce.db')
    if (fs.existsSync(pkg) && fs.existsSync(db)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

let projectRoot = null

/** Settings file lives in Electron's per-user data dir (survives rebuilds, not gitignored). */
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings() {
  try {
    // settings.json may hold the LLM API key — tighten perms even for files
    // written before the 0600 change shipped.
    try {
      fs.chmodSync(settingsPath(), 0o600)
    } catch {
      // not present yet
    }
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // A corrupt settings file must not silently wipe user data on the next
      // save — surface it so the operator notices before it is overwritten.
      console.error(`[settings] 读取失败，保存前将被覆盖: ${err.message}`)
    }
    return {}
  }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch }
  // LLM fields: empty string means "fall back to .env" — drop them so env overrides stay clean
  if (next.llm) {
    for (const [k, v] of Object.entries(next.llm)) if (!v) delete next.llm[k]
    if (Object.keys(next.llm).length === 0) delete next.llm
  }
  if (!Array.isArray(next.sources)) delete next.sources
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  // Atomic write: temp file + rename so a crash mid-write can't corrupt the JSON.
  const tmp = `${settingsPath()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
  try {
    fs.chmodSync(tmp, 0o600)
  } catch {
    // mode already applied above on POSIX
  }
  fs.renameSync(tmp, settingsPath())
  try {
    fs.chmodSync(settingsPath(), 0o600)
  } catch {
    // best-effort
  }
  return next
}

/** Built-in SQLite e-commerce demo — the initial source until the user adds their own. */
const DEFAULT_SOURCES = [{ id: 'ecommerce', name: '电商（示例）', type: 'sqlite', dbPath: 'data/ecommerce.db' }]

function withSources(settings) {
  if (Array.isArray(settings.sources)) return settings
  return { ...settings, sources: DEFAULT_SOURCES }
}

/** Remove imported-CSV db files on disk (safe against anything outside data/imported). */
function removeImportedFiles(sources) {
  if (!Array.isArray(sources)) return
  const imported = path.resolve(projectRoot ?? '', 'data', 'imported')
  for (const s of sources) {
    if (s?.type !== 'sqlite' || !s.dbPath) continue
    const abs = path.resolve(projectRoot ?? '', s.dbPath)
    if (abs.startsWith(imported + path.sep)) {
      try {
        fs.rmSync(abs, { force: true })
      } catch {
        // best-effort cleanup; a leftover file must not break the flow
      }
    }
  }
}

/** Never hand the plaintext API key to the renderer — only a masked hint
 *  (first 4 + last 4 chars). The real value lives solely in the main process. */
function maskKey(key) {
  if (!key || typeof key !== 'string') return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

function settingsView() {
  const s = withSources(loadSettings())
  if (s.llm && typeof s.llm.apiKey === 'string' && s.llm.apiKey) {
    s.llm.apiKey = maskKey(s.llm.apiKey)
  }
  return { settings: s, defaults: { llm: readEnv() } }
}

function readEnv() {
  let envBaseUrl = 'unknown'
  let envModel = 'unknown'
  try {
    const raw = fs.readFileSync(path.join(projectRoot, '.env'), 'utf8')
    const get = (k) => {
      const m = raw.match(new RegExp(`^${k}=(.+)$`, 'm'))
      return m ? m[1].trim().trim('"') : null
    }
    envBaseUrl = get('LLM_BASE_URL') || 'unknown'
    envModel = get('LLM_MODEL') || 'unknown'
  } catch {
    // keep defaults above
  }
  const llm = loadSettings().llm || {}
  return { baseUrl: llm.baseUrl || envBaseUrl, model: llm.model || envModel }
}

/** LLM env overrides (settings beat .env; dotenv never overwrites pre-set vars). */
function cliEnv() {
  const llm = loadSettings().llm || {}
  const env = { ...process.env, CI: '1' }
  if (llm.baseUrl) env.LLM_BASE_URL = llm.baseUrl
  if (llm.apiKey) env.LLM_API_KEY = llm.apiKey
  if (llm.model) env.LLM_MODEL = llm.model
  return env
}

/** Connection env for a UI source descriptor — only the matching driver's var
 *  may stay set; the child CLI loads .env and the shell may have other URLs
 *  exported, which would misroute the request. */
function sourceEnv(source) {
  const blank = { CRM_DATABASE_URL: '', MYSQL_DATABASE_URL: '', DB_PATH: '' }
  switch (source?.type) {
    case 'sqlite':
      return { ...blank, DB_PATH: source.dbPath || 'data/ecommerce.db' }
    case 'postgres':
      return { ...blank, CRM_DATABASE_URL: source.url || '' }
    case 'mysql':
      return { ...blank, MYSQL_DATABASE_URL: source.url || '' }
    default:
      return null
  }
}

/** Map a UI source descriptor onto the CLI script + connection env it needs. */
function sourceCli(source) {
  const env = sourceEnv(source)
  if (!env) return null
  const script = { sqlite: 'ask', postgres: 'crm-ask', mysql: 'mysql-ask' }[source.type]
  return { script, env }
}

/** Tighten the renderer→main trust boundary: coerce every incoming value to a
 *  bounded string and only accept well-formed source descriptors. Everything
 *  arrives through structured IPC, but one renderer bug (or a future XSS)
 *  should not be able to smuggle args into the CLI layer. */
function cleanString(v, max = 2000) {
  return typeof v === 'string' ? v.slice(0, max) : String(v ?? '').slice(0, max)
}

function isValidSource(source) {
  return (
    !!source &&
    typeof source === 'object' &&
    ['sqlite', 'postgres', 'mysql'].includes(source.type) &&
    (source.type === 'sqlite'
      ? typeof source.dbPath === 'string' && source.dbPath.length <= 2000
      : typeof source.url === 'string' && source.url.length <= 2000)
  )
}

/** Map a CLI script name onto its TS entry so we can skip the npm shim layer. */
const CLI_ENTRY = {
  ask: 'src/cli/ask.ts',
  'crm-ask': 'src/cli/crmAsk.ts',
  'mysql-ask': 'src/cli/mysqlAsk.ts',
  starters: 'src/cli/starters.ts',
  preview: 'src/cli/preview.ts',
  dashboard: 'src/cli/dashboard.ts',
  'csv-import': 'src/cli/importCsv.ts',
}

/** Pick the node binary that matches the project's .nvmrc (e.g. "24"), so the
 *  spawned CLI always runs under the same ABI as the compiled better-sqlite3 —
 *  no matter what `node` resolves to in the launching shell (nvm alias, brew,
 *  volta… can all silently point elsewhere). Falls back to PATH `node`. */
function resolveNodeBin() {
  let want = ''
  try {
    want = fs.readFileSync(path.join(projectRoot, '.nvmrc'), 'utf8').trim()
  } catch {
    /* no .nvmrc — use whatever node is on PATH */
  }
  if (want) {
    const versionsDir = path.join(os.homedir(), '.nvm', 'versions', 'node')
    try {
      const ver = want.replace(/^v/, '')
      const matches = fs
        .readdirSync(versionsDir)
        .filter((v) => v.startsWith(`v${ver}`))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      for (const v of matches) {
        const bin = path.join(versionsDir, v, 'bin', 'node')
        if (fs.existsSync(bin)) {
          // Opt-in diagnostics only — never log the absolute home path by default.
          if (process.env.CP_DEBUG_NODE) {
            console.log(`[desktop] CLI node = ${bin} (from .nvmrc ${want})`)
          }
          return bin
        }
      }
    } catch {
      /* no nvm installs — fall through to PATH */
    }
  }
  return 'node'
}

/**
 * Spawn the CLI entry under the resolved node, shell:false. User text (question,
 * history, CSV paths) travels as argv elements only — never through a shell, so
 * metacharacters cannot be interpreted as commands.
 */
function runCliArgs(script, args, extraEnv = {}) {
  const entry = CLI_ENTRY[script]
  if (!entry) throw new Error(`未知的 CLI 脚本: ${script}`)
  // The returned promise carries a .kill() so withTimeout can terminate the
  // child; node resolution is async only on Windows (static probe, no shell).
  let child = null
  const pending = (process.platform === 'win32' ? resolveSystemNode() : Promise.resolve(resolveNodeBin()))
    .then((nodeBin) => {
      child = spawn(nodeBin, ['--import', 'tsx', entry, ...args], {
        cwd: projectRoot,
        env: { ...cliEnv(), ...extraEnv },
        shell: false,
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))

      return new Promise((resolve, reject) => {
        child.on('error', (err) => reject(`启动 Node CLI 失败: ${err.message}`))
        child.on('close', (code) => {
          if (code !== 0) {
            reject(`DataPulse CLI 执行失败 (code ${code}):\n${stderr}`)
            return
          }
          try {
            // Try to parse starting at every '{' so stray braces in the payload
            // (e.g. --history '[{...}]') can never break extraction.
            let from = 0
            let matched = false
            while ((from = stdout.indexOf('{', from)) !== -1) {
              const to = stdout.lastIndexOf('}')
              if (to > from) {
                try {
                  resolve(JSON.parse(stdout.slice(from, to + 1)))
                  matched = true
                  break
                } catch {
                  // not a valid object from this '{' — try the next one
                }
              }
              from++
            }
            if (!matched) throw new Error('stdout contains no parseable JSON object')
          } catch (err) {
            reject(`解析 CLI 输出失败: ${err.message}\n原始输出:\n${stdout.slice(0, 2000)}`)
          }
        })
      })
    })
  pending.kill = () => {
    try {
      if (child) child.kill()
    } catch {
      // best-effort
    }
  }
  return pending
}

/** Resolve the system node.exe once (static probe, no user input in argv) so
 *  Windows can spawn the CLI directly without going through a shell. */
let SYSTEM_NODE = null
function resolveSystemNode() {
  if (SYSTEM_NODE) return Promise.resolve(SYSTEM_NODE)
  return new Promise((resolve) => {
    const probe = spawn('node', ['-p', 'process.execPath'], { shell: false })
    let out = ''
    probe.stdout.on('data', (d) => (out += d))
    probe.on('close', (code) => {
      const bin = code === 0 ? String(out).trim() : ''
      SYSTEM_NODE = bin || 'node'
      resolve(SYSTEM_NODE)
    })
    probe.on('error', () => {
      SYSTEM_NODE = 'node'
      resolve(SYSTEM_NODE)
    })
  })
}

/** Resolve/reject like the wrapped promise, but bail out after ms so a hung
 *  CLI child can never leave the UI on an infinite spinner — and the child is
 *  killed, not just abandoned (it may hold DB connections or an LLM request). */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try {
        if (promise && typeof promise.kill === 'function') promise.kill()
      } catch {
        // best-effort
      }
      reject(`${label} 超时 (${Math.round(ms / 1000)}s)`)
    }, ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

function createWindow() {
  const win = new BrowserWindow({
    title: 'DataPulse',
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  // Privacy option: wipe the Q/A history from localStorage when the app quits.
  win.on('close', () => {
    if (loadSettings().privacy?.clearHistoryOnQuit) {
      win.webContents
        .executeJavaScript('localStorage.removeItem("cp.history.v2"); true')
        .catch(() => {})
    }
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'))
  }
}

// Single instance: a second launch should focus the running app instead of
// racing writes to settings.json alongside the first one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
  projectRoot = findProjectRoot()
  if (!projectRoot) {
    console.error('找不到 datapulse 项目根目录（需要 package.json + data/ecommerce.db）')
    app.quit()
    return
  }

  ipcMain.handle('ask', (_e, { source, question, history } = {}) => {
    question = cleanString(question)
    if (!isValidSource(source) || !question) throw new Error('无效的数据源或问题')
    const cli = sourceCli(source)
    if (!cli) throw new Error('无效的数据源')
    const args = ['--json', question]
    const turns = Array.isArray(history)
      ? history
          .filter((t) => t && typeof t.question === 'string' && typeof t.answer === 'string')
          .slice(0, 12)
          .map((t) => ({ question: cleanString(t.question, 1000), answer: cleanString(t.answer, 3000) }))
      : []
    if (turns.length) args.push('--history', JSON.stringify(turns))
    const t0 = Date.now()
    const pending = runCliArgs(cli.script, args, cli.env)
    pending.then(
      (r) => console.log(`[ask] OK in ${Date.now() - t0}ms rows=${r?.rowCount ?? '?'}`),
      (err) => console.log(`[ask] FAIL: ${String(err).slice(0, 300)}`),
    )
    // Same guard as preview/dashboard: a hung CLI (dead model connection, slow
    // data source…) must surface a clear timeout instead of an infinite spinner.
    return withTimeout(pending, 120_000, `回答「${question.slice(0, 24)}」`)
  })
  ipcMain.handle('get-starters', (_e, { source, refresh } = {}) => {
    if (!isValidSource(source)) throw new Error('无效的数据源')
    const cli = sourceCli(source)
    if (!cli) throw new Error('无效的数据源')
    const args = ['--json']
    if (refresh) args.push('--force')
    return runCliArgs('starters', args, cli.env)
  })
  ipcMain.handle('get-table-preview', (_e, { source, table, limit } = {}) => {
    if (!isValidSource(source)) throw new Error('无效的数据源')
    const env = sourceEnv(source)
    table = cleanString(table, 200)
    if (!env || !table) throw new Error('无效的数据源')
    const args = ['--json', table]
    const n = Math.floor(Number(limit))
    if (Number.isFinite(n) && n > 0) args.push(String(Math.min(n, 200)))
    const t0 = Date.now()
    const pending = runCliArgs('preview', args, env)
    pending.then(
      (r) => console.log(`[preview] OK ${table} in ${Date.now() - t0}ms cols=${Array.isArray(r?.columns) ? r.columns.length : '?'} err=${r?.error || '-'}`),
      (err) => console.log(`[preview] FAIL ${table}: ${String(err).slice(0, 300)}`),
    )
    // Never let the UI spinner hang: surface a clear timeout instead.
    return withTimeout(pending, 15000, `读取表「${table}」`)
  })
  ipcMain.handle('get-dashboard', (_e, { source, request } = {}) => {
    if (!isValidSource(source)) throw new Error('无效的数据源')
    const env = sourceEnv(source)
    request = cleanString(request)
    if (!env || !request) throw new Error('无效的数据源')
    const args = ['--json', request]
    const t0 = Date.now()
    const pending = runCliArgs('dashboard', args, env)
    pending.then(
      (r) => console.log(`[dashboard] OK in ${Date.now() - t0}ms charts=${Array.isArray(r?.charts) ? r.charts.length : '?'}`),
      (err) => console.log(`[dashboard] FAIL: ${String(err).slice(0, 300)}`),
    )
    // Dashboard = schema introspection + an agent run + N chart specs: give it
    // a generous bound so a normal ~15s generation plus a transient LLM retry
    // never surfaces as a false "超时" error.
    return withTimeout(pending, 60_000, 'Dashboard 生成')
  })
  ipcMain.handle('get-env', () => readEnv())
  // Robust clipboard write that bypasses rendered-page focus/premission quirks.
  ipcMain.handle('clipboard-write', (_e, text) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })
  ipcMain.handle('get-settings', () => settingsView())
  ipcMain.handle('save-settings', (_e, patch) => {
    const clean = {}
    if (patch && typeof patch === 'object') {
      if (Array.isArray(patch.sources)) {
        clean.sources = patch.sources.filter((s) => !s || isValidSource(s)).slice(0, 50)
      }
      if (patch.llm && typeof patch.llm === 'object') {
        clean.llm = {}
        for (const k of ['baseUrl', 'apiKey', 'model']) {
          if (patch.llm[k] === undefined || patch.llm[k] === null) continue
          if (k === 'apiKey') {
            if (typeof patch.llm[k] === 'string') {
              // '' clears the saved key (falls back to .env); a masked echo from
              // a renderer that never edited the field means "keep the old one".
              const v = patch.llm[k]
              if (v.includes('••••')) continue
              clean.llm[k] = v.slice(0, 512)
            }
          } else if (typeof patch.llm[k] === 'string') {
            clean.llm[k] = patch.llm[k].slice(0, 2000)
          }
        }
      }
      if (patch.privacy && typeof patch.privacy === 'object') {
        clean.privacy = { clearHistoryOnQuit: !!patch.privacy.clearHistoryOnQuit }
      }
    }
    saveSettings(clean)
    return settingsView()
  })
  ipcMain.handle('remove-source', (_e, source) => {
    if (!source || typeof source !== 'object') throw new Error('无效的数据源')
    const settings = withSources(loadSettings())
    const next = settings.sources.filter((s) => s?.id !== source.id)
    removeImportedFiles([source])
    saveSettings({ sources: next })
    return settingsView()
  })
  ipcMain.handle('clear-sources', () => {
    const settings = withSources(loadSettings())
    removeImportedFiles(settings.sources)
    saveSettings({ sources: [] })
    return settingsView()
  })

  ipcMain.handle('pick-sqlite', async () => {
    const win = BrowserWindow.getFocusedWindow()
    let r = null
    try {
      r = await dialog.showOpenDialog(win, {
        title: '选择 SQLite 数据库文件',
        filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }],
        properties: ['openFile'],
      })
    } catch {
      return null
    }
    if (r.canceled || !r.filePaths[0]) return null
    return { path: r.filePaths[0] }
  })

  ipcMain.handle('pick-csv', async () => {
    const win = BrowserWindow.getFocusedWindow()
    let r = null
    try {
      r = await dialog.showOpenDialog(win, {
        title: '选择要导入的 CSV 文件',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        properties: ['openFile'],
      })
    } catch {
      return null
    }
    if (r.canceled || !r.filePaths[0]) return null
    return { path: r.filePaths[0] }
  })

  ipcMain.handle('import-csv', async (_e, { path: csvPath, table } = {}) => {
    csvPath = cleanString(csvPath, 2000)
    if (!csvPath) throw new Error('缺少 CSV 文件路径')
    if (!fs.existsSync(csvPath) || !fs.statSync(csvPath).isFile()) {
      throw new Error(`CSV 文件不存在: ${csvPath}`)
    }
    const args = ['--json', csvPath]
    if (table) args.push(cleanString(table, 200))
    return runCliArgs('csv-import', args, {})
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})