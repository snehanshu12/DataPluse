import type { AskResult, ChatTurn, CsvImportResult, DashboardSpec, EnvInfo, Settings, SettingsView, SourceDef, StarterResult, TablePreview } from './types'

declare global {
  interface Window {
    electronAPI: {
      ask: (source: SourceDef, question: string, opts?: { history?: ChatTurn[] }) => Promise<AskResult>
      getStarters: (source: SourceDef, refresh?: boolean) => Promise<StarterResult>
      getTablePreview: (source: SourceDef, table: string, limit?: number) => Promise<TablePreview>
      getDashboard: (source: SourceDef, request: string) => Promise<DashboardSpec>
      getEnv: () => Promise<EnvInfo>
      getSettings: () => Promise<SettingsView>
      saveSettings: (patch: Settings) => Promise<SettingsView>
      removeSource: (source: SourceDef) => Promise<SettingsView>
      clearSources: () => Promise<SettingsView>
      pickSqlite: () => Promise<{ path: string } | null>
      pickCsv: () => Promise<{ path: string } | null>
      importCsv: (arg: { path: string; table?: string }) => Promise<CsvImportResult>
      writeClipboard: (text: string) => Promise<boolean>
    }
  }
}

export {}