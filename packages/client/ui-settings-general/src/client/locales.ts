/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'about.version': '版本',
  'about.commit': '提交 {commit}',
  'about.build': '构建 {build}',
  'about.schema': 'Schema {schema}',
  'diagnostics.nav': '诊断',
  'diagnostics.identity': '构建身份',
  'diagnostics.version': '版本',
  'diagnostics.commit': '提交',
  'diagnostics.build': '构建哈希',
  'diagnostics.schema': 'Schema 版本',
  'diagnostics.assembly': '能力装配',
  'diagnostics.assembly.summary': '{seams} 个装配缝 · {occupants} 个装配项',
  'diagnostics.seam': '装配缝',
  'diagnostics.kind': '类型',
  'diagnostics.scope': '作用域',
  'diagnostics.maturity': '成熟度',
  'diagnostics.occupants': '装配项',
  'diagnostics.empty': '无数据',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'about.version': 'Version',
  'about.commit': 'Commit {commit}',
  'about.build': 'Build {build}',
  'about.schema': 'Schema {schema}',
  'diagnostics.nav': 'Diagnostics',
  'diagnostics.identity': 'Build identity',
  'diagnostics.version': 'Version',
  'diagnostics.commit': 'Commit',
  'diagnostics.build': 'Build hash',
  'diagnostics.schema': 'Schema version',
  'diagnostics.assembly': 'Capability assembly',
  'diagnostics.assembly.summary': '{seams} seams · {occupants} occupants',
  'diagnostics.seam': 'Seam',
  'diagnostics.kind': 'Kind',
  'diagnostics.scope': 'Scope',
  'diagnostics.maturity': 'Maturity',
  'diagnostics.occupants': 'Occupants',
  'diagnostics.empty': 'No data',
} satisfies Record<SettingsKey, string>
