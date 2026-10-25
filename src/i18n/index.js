import { reactive } from 'vue'

const STORAGE_KEY = 'caifeng.locale'

export const localeState = reactive({
  locale: localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh',
})

const MESSAGES = {
  en: {
    'nav.workspace': 'Workspace',
    'nav.collections': 'Collection List',
    'nav.sites': 'Sites',
    'nav.configs': 'Collection Configs',
    'nav.headers': 'Header Profiles',
    'nav.params': 'Parameter Templates',
    'nav.proxies': 'Proxies',
    'nav.storages': 'Storage',
    'nav.integrations': 'Integrations & Security',
    'nav.sessions': 'Sessions',
    'nav.captcha': 'Captcha',
    'nav.api': 'API Management',
    'nav.system': 'System',
    'nav.users': 'Users & Roles',
    'nav.audit': 'Audit Log',
    'nav.settings': 'System Settings',
    'role.admin': 'Administrator',
    'role.operator': 'Operator',
    'role.viewer': 'Viewer',
    'role.member': 'Member',
    'common.synced': 'Synced',
    'common.saving': 'Saving',
    'common.syncFailed': 'Sync failed',
    'common.logout': 'Sign out',
    'common.settings': 'System settings',
    'common.security': 'Account & security',
    'common.sessions': 'Login sessions',
    'common.about': 'About Collect Studio',
    'common.clear': 'Clear workspace',
    'common.serverWorkspace': 'Server workspace',
    'common.currentWorkspace': 'Current workspace',
    'common.workspaceName': 'Collect Studio',
    'common.connected': 'Backend connected',
    'common.lastRun': 'Last run',
    'common.quickImport': 'Quick Import',
    'common.serverSynced': 'Synced',
    'common.readonly': 'Viewer mode: you can browse the workspace but cannot modify resources, run collections, or manage integrations.',
    'common.loading': 'Loading server workspace',
    'common.loadingHint': 'Syncing collection resources and tasks from SQLite…',
    'common.loadFailed': 'Workspace failed to load',
    'common.retry': 'Retry',
    'settings.title': 'System Settings',
    'settings.eyebrow': 'PREFERENCES',
    'settings.description': 'Appearance, language and workspace preferences for your account.',
    'settings.appearance': 'Appearance',
    'settings.appearanceHint': 'Choose light, dark or follow the operating system.',
    'settings.light': 'Light',
    'settings.dark': 'Dark',
    'settings.system': 'System',
    'settings.accent': 'Accent color',
    'settings.accentHint': 'Used by navigation, buttons and highlights.',
    'settings.language': 'Language',
    'settings.languageHint': 'Switch the interface language. Changes apply immediately.',
    'settings.chinese': '简体中文',
    'settings.english': 'English',
    'settings.account': 'Account',
    'settings.role': 'Role',
    'settings.workspace': 'Workspace',
    'settings.lastSaved': 'Last saved',
    'settings.saved': 'Preferences saved',
    'settings.saveFailed': 'Could not save preferences',
    'settings.reset': 'Reset to defaults',
    'settings.density': 'Density',
    'settings.densityHint': 'Compact mode reduces list and form spacing.',
    'settings.comfortable': 'Comfortable',
    'settings.compact': 'Compact',
    'settings.lastLogin': 'Last login',
    'settings.loginTitle': 'Sign in',
    'settings.loginSubtitle': 'Use your administrator or member account',
    'settings.username': 'Username',
    'settings.password': 'Password',
    'settings.usernamePlaceholder': 'Enter username',
    'settings.passwordPlaceholder': 'Enter password',
    'settings.signIn': 'Sign in',
    'settings.loginHint': 'The first launch creates an administrator account. Check the server console or set ADMIN_PASSWORD.',
    'settings.tagline': 'Data collection & automation studio',
    'settings.point1': 'SQLite database',
    'settings.point2': 'Site sessions',
    'settings.point3': 'Captcha & API',
  },
}

const TEXT_MAP = {
  '采集列表': 'Collection List',
  '采集站点': 'Sites',
  '采集配置管理': 'Collection Configs',
  '采集Header管理': 'Header Profiles',
  '采集Header 管理': 'Header Profiles',
  '采集参数项管理': 'Parameter Templates',
  '代理管理': 'Proxies',
  '存储管理': 'Storage',
  '会话管理': 'Sessions',
  '打码管理': 'Captcha',
  '风控管理': 'Risk Control',
  '接口嗅探': 'API Sniffer',
  '网页接口嗅探': 'Web API Sniffer',
  '开始嗅探': 'Start Sniffing',
  '生成采集配置': 'Generate Config',
  '网页地址': 'Page URL',
  '新建风控方案': 'New Risk Profile',
  '风控方案': 'Risk Profiles',
  '风控类型': 'Risk Type',
  '处理方式': 'Strategy',
  '自定义风控': 'Custom Risk',
  '浏览器过盾': 'Browser Challenge',
  '手动 Cookie': 'Manual Cookie',
  '风控执行记录': 'Risk Jobs',
  '测试风控方案': 'Test Risk Profile',
  '执行风控处理': 'Resolve Challenge',
  '管理目标站点的反爬/风控处理方案。支持自定义接口、浏览器过盾和手动 Cookie，仅用于已获授权的目标站点。':
    'Manage anti-bot and risk-control strategies for authorized sites using custom APIs, browser challenge handling or manual cookies.',
  'API 管理': 'API Management',
  '账号与权限': 'Users & Roles',
  '操作审计': 'Audit Log',
  '系统设置': 'System Settings',
  '账号与安全': 'Account & Security',
  '登录会话': 'Login Sessions',
  '退出登录': 'Sign out',
  '一键解析': 'Quick Import',
  '服务端已同步': 'Synced',
  '保存中': 'Saving',
  '同步失败': 'Sync failed',
  '当前工作区': 'Current workspace',
  '采风数据工坊': 'Collect Studio Workspace',
  '服务端工作区': 'Server workspace',
  '管理员': 'Administrator',
  '操作员': 'Operator',
  '只读成员': 'Viewer',
  '数据运营': 'Operations',
  '系统管理': 'System',
  '集成与安全': 'Integrations & Security',
  '工作台': 'Workspace',
  '新建': 'New',
  '新建配置': 'New Config',
  '新建采集任务': 'New Collection Task',
  '新建站点': 'New Site',
  '新建站点会话': 'New Site Session',
  '新建账号': 'New User',
  '新建打码平台': 'New Captcha Provider',
  '新建 API 客户端': 'New API Client',
  '新建 API 任务': 'New API Job',
  '新建 Header': 'New Header',
  '新建参数': 'New Parameter',
  '新建代理': 'New Proxy',
  '新建存储': 'New Storage',
  '保存': 'Save',
  '保存修改': 'Save Changes',
  '保存新密码': 'Save Password',
  '保存会话': 'Save Session',
  '保存平台': 'Save Provider',
  '保存客户端': 'Save Client',
  '保存账号': 'Save User',
  '取消': 'Cancel',
  '删除': 'Delete',
  '编辑': 'Edit',
  '刷新': 'Refresh',
  '采集': 'Collect',
  '采集下一项': 'Collect Next',
  '日志查看': 'View Logs',
  '更多操作': 'More',
  '确认': 'Confirm',
  '关闭': 'Close',
  '复制': 'Copy',
  '复制日志': 'Copy Logs',
  '导出结果': 'Export Result',
  '下载 JSON': 'Download JSON',
  '下载 CSV': 'Download CSV',
  '重试': 'Retry',
  '全选': 'Select All',
  '清空': 'Clear',
  '返回修改': 'Back to Edit',
  '导入选中模块并创建任务': 'Import Selected & Create Task',
  '新建副本': 'Create Copy',
  '覆盖已有': 'Overwrite Existing',
  '采集任务': 'Collection Task',
  '采集配置': 'Collection Config',
  '请求头 / 参数': 'Headers / Params',
  '关联存储': 'Storage',
  '采集时间': 'Collect At',
  '状态': 'Status',
  '操作': 'Actions',
  '配置名称': 'Config Name',
  '请求方式': 'Method',
  '请求路径': 'Path',
  '响应解析': 'Parsing',
  '采集策略': 'Strategy',
  '关联任务': 'Tasks',
  '最近更新': 'Updated',
  '名称': 'Name',
  '方法': 'Method',
  '路径': 'Path',
  '类型': 'Type',
  '目标': 'Target',
  '大小': 'Size',
  '更新时间': 'Updated',
  '描述': 'Description',
  '请求头': 'Headers',
  '参数': 'Parameters',
  '值': 'Value',
  '启用': 'Enabled',
  '账号': 'Account',
  '角色': 'Role',
  '最近登录': 'Last Login',
  '创建时间': 'Created',
  '过期时间': 'Expires',
  '最近活跃': 'Last Seen',
  '设备 / 客户端': 'Device / Client',
  '平台': 'Provider',
  '创建任务接口': 'Create Endpoint',
  '轮询': 'Polling',
  '权限': 'Scopes',
  '推送 Webhook': 'Webhook',
  '限流': 'Rate Limit',
  '客户端': 'Client',
  '方向': 'Direction',
  '结果': 'Result',
  '错误': 'Error',
  '任务': 'Task',
  '时间': 'Time',
  '详情': 'Details',
  '会话': 'Session',
  '筛选结果': 'Results',
  '条记录': 'records',
  '共': 'Total',
  '条': 'records',
  '个': 'items',
  '最近操作': 'Recent Activity',
  '最多显示最近 200 条服务端审计记录': 'Shows the latest 200 server audit records.',
  '稳定': 'Stable',
  '站点名称': 'Site Name',
  '基础地址': 'Base URL',
  '页面规则': 'Page Rule',
  '连接状态': 'Connection',
  '参数项名称': 'Parameter Name',
  '存储名称': 'Storage Name',
  '存储位置': 'Location',
  '存储说明': 'Description',
  '代理名称': 'Proxy Name',
  '代理协议': 'Protocol',
  '代理主机': 'Host',
  '代理地址': 'Proxy URL',
  '端口': 'Port',
  '认证': 'Authentication',
  '用户名': 'Username',
  '密码': 'Password',
  '请求头字段': 'Header Fields',
  '启用字段': 'Enabled Fields',
  '启用参数': 'Enabled Parameters',
  '字段名': 'Key',
  '参数名': 'Parameter',
  '数据表': 'Table',
  '数据库用户名（可选）': 'DB Username (optional)',
  '数据库密码（可选）': 'DB Password (optional)',
  '查询参数': 'Query Params',
  '参数预览': 'Preview',
  '耗时': 'Duration',
  '登录时间': 'Login Time',
  '权限范围': 'Scopes',
  '客户端名称': 'Client Name',
  '会话名称': 'Session Name',
  '平台名称': 'Provider Name',
  '轮询接口': 'Poll Endpoint',
  '轮询间隔（秒）': 'Poll Interval (s)',
  '任务 ID 路径': 'Task ID Path',
  '任务 ID 参数名': 'Task ID Param',
  '成功状态值': 'Success Value',
  '结果 Token 路径': 'Result Token Path',
  '创建任务请求模板': 'Create Task Template',
  '请求头 JSON': 'Headers JSON',
  'API Key / 密钥': 'API Key / Secret',
  '每分钟请求上限': 'Requests / Minute',
  'IP 白名单（可选，每行或逗号分隔）': 'IP Allowlist (optional)',
  '初始密码': 'Initial Password',
  '当前密码': 'Current Password',
  '确认新密码': 'Confirm Password',
  '新密码': 'New Password',
  '轮换方式': 'Rotation',
  '按顺序轮换': 'Round-robin',
  '随机选择': 'Random',
  '轮换 Header 模板': 'Rotate Header Profiles',
  '计划类型': 'Schedule Type',
  '跟随下一页链接': 'Follow Next Link',
  '只采集单页': 'Single Page',
  '页码参数': 'Page Param',
  'Header 名称': 'Header Name',
  '编辑 Header': 'Edit Header',
  '编辑参数项': 'Edit Parameter',
  '编辑存储': 'Edit Storage',
  '编辑代理': 'Edit Proxy',
  '编辑会话': 'Edit Session',
  '编辑角色': 'Edit Role',
  '编辑客户端': 'Edit Client',
  '编辑配置': 'Edit Config',
  '编辑平台': 'Edit Provider',
  '编辑任务': 'Edit Task',
  '编辑站点': 'Edit Site',
  '删除 Header': 'Delete Header',
  '删除参数项': 'Delete Parameter',
  '删除存储': 'Delete Storage',
  '删除代理': 'Delete Proxy',
  '删除会话': 'Delete Session',
  '删除客户端': 'Delete Client',
  '删除配置': 'Delete Config',
  '删除平台': 'Delete Provider',
  '删除任务': 'Delete Task',
  '删除站点': 'Delete Site',
  '删除账号': 'Delete User',
  '搜索 Header 名称或字段名': 'Search header name or field',
  '搜索参数项名称或参数名': 'Search parameter name',
  '搜索存储名称或位置': 'Search storage name or location',
  '搜索代理名称、主机或协议': 'Search proxy name, host or protocol',
  '搜索配置名称、请求路径或数据路径': 'Search config name or path',
  '搜索站点名称或地址': 'Search site name or URL',
  '启用状态': 'Enabled',
  '复制存储位置': 'Copy storage location',
  '复制代理地址': 'Copy proxy URL',
  '复制地址': 'Copy URL',
  '刷新数据': 'Refresh',
  '说明这套配置的用途（可选）': 'Describe this config (optional)',
  '说明模板适用场景（可选）': 'Describe this template (optional)',
  '说明参数模板适用场景（可选）': 'Describe this parameter template (optional)',
  '说明代理出口的用途或地区（可选）': 'Describe this proxy egress (optional)',
  '说明数据用途或保留策略（可选）': 'Describe data usage or retention (optional)',
  '简单说明数据源用途（可选）': 'Describe this data source (optional)',
  '链接': 'Links',
  '图片': 'Images',
  '视频': 'Videos',
  '网页片段': 'Web Fragments',
  '纯文本': 'Plain Text',
  '响应类型': 'Response Type',
  '请求体': 'Request Body',
  '配置说明': 'Description',
  '失败重试次数': 'Retries',
  '请求超时（秒）': 'Timeout (s)',
  '并发数': 'Concurrency',
  '自动采集': 'Auto Collection',
  '开始时间': 'Start Time',
  '结束时间': 'End Time',
  '间隔时间（秒）': 'Interval (s)',
  '执行时间': 'Run At',
  '翻页方式': 'Pagination',
  '分页参数名': 'Page Param',
  '起始页': 'Start Page',
  '最大页数': 'Max Pages',
  '下一页选择器': 'Next Selector',
  '最多采集条数': 'Max Items',
  '是否采集资源': 'Collect Resources',
  'JS 动态加载': 'JS Rendering',
  '渲染等待（毫秒）': 'Render Wait (ms)',
  'XHR 地址包含（可选）': 'XHR URL Contains (optional)',
  '链接选择器': 'Link Selector',
  '链接包含（可选）': 'URL Contains (optional)',
  '链接排除（可选）': 'URL Excludes (optional)',
  '同站链接': 'Same Origin Only',
  '链接去重': 'Deduplicate',
  '站点登录态': 'Site Session',
  '采集参数': 'Parameters',
  '采集名称': 'Task Name',
  '任务备注': 'Notes',
  '响应数据路径': 'Data Path',
  '配置名称': 'Config Name',
  '正在采集': 'Collecting',
  '累计归档': 'Archived',
  '采集成功率': 'Success Rate',
  '任务总览': 'Task Overview',
  '组合站点、配置、请求头与参数，快速发起一次采集':
    'Combine sites, configs, headers and parameters to start a collection.',
  '全部': 'All',
  '全部站点': 'All Sites',
  '搜索任务、站点、配置或存储': 'Search tasks, sites, configs or storage',
  '创建第一条采集任务，把站点、配置与存储组合起来。':
    'Create your first collection task by combining a site, config and storage.',
  '暂无运行记录': 'No runs yet',
  '尚未运行': 'Not run yet',
  '刚刚': 'just now',
  '偏好已保存': 'Preferences saved',
  '登录成功': 'Signed in',
  '已退出登录': 'Signed out',
  '请输入用户名和密码': 'Enter username and password',
  '用户名或密码错误': 'Invalid username or password',
  '登录失败': 'Sign-in failed',
  '采集 Header': 'Header Profile',
  '成功': 'Success',
  '失败': 'Failed',
  '待采集': 'Ready',
  '采集中': 'Running',
  '已完成': 'Done',
  '已停用': 'Disabled',
  '正常': 'Active',
  '有效': 'Valid',
  '已过期': 'Expired',
  '当前会话': 'Current Session',
  '已吊销': 'Revoked',
  '长期有效': 'No Expiry',
  '全部配置': 'All Configs',
  '全部任务': 'All Tasks',
  '暂无数据': 'No data',
  '还没有采集任务': 'No collection tasks yet',
  '还没有成员账号': 'No users yet',
  '还没有站点会话': 'No site sessions yet',
  '还没有打码平台': 'No captcha providers yet',
  '还没有 API 客户端': 'No API clients yet',
  '前往采集列表 →': 'Go to collection list →',
  '知道了': 'Got it',
  '确认清空': 'Clear',
  '退出': 'Sign out',
  '取消 ': 'Cancel ',
  '编排采集任务，关联站点资源，一键运行并查看采集结果。工作区保存在服务端 SQLite，采集结果写入配置的存储目标。':
    'Compose collection tasks, link site resources, run them and inspect results. The workspace is stored in server-side SQLite and results are written to configured storage.',
  '管理数据源入口，维护站点地址、页面规则与连接状态。支持对真实网页做 CSS 选择器采集。':
    'Manage data sources, site URLs, page rules and connection status. Supports CSS-selector collection from real web pages.',
  '定义 API、网页片段、图片、视频采集，以及重试、超时与自动计划。配置与站点解耦，可被多个任务复用。':
    'Define API, web fragment, image and video collection, plus retries, timeouts and schedules. Configs are reusable across tasks.',
  '集中维护请求头模板，在多个采集任务之间复用。字段可单独启用或停用。':
    'Maintain reusable request-header profiles. Individual fields can be enabled or disabled.',
  '管理分页、筛选与检索参数，支持静态文本、实时时间戳与列表遍历值。参数会自动拼接到请求地址。':
    'Manage pagination, filtering and search parameters with static text, live timestamps and list iteration values.',
  '集中托管 HTTP、HTTPS 与 SOCKS5 出口配置，统一维护地址、端口与认证信息。':
    'Manage HTTP, HTTPS and SOCKS5 proxy egress profiles with addresses, ports and credentials.',
  '配置 JSON / CSV、图片 / 视频 / HTML 文件夹或数据库连接，查看归档规模并管理本地文件。':
    'Configure JSON/CSV, image/video/HTML folders or database connections, inspect archives and manage local files.',
  '管理目标网站的登录 Cookie、Bearer Token 或 Storage State。采集时由服务端注入，不返回给浏览器。':
    'Manage target-site cookies, bearer tokens or storage state. Credentials are injected server-side and never returned to the browser.',
  '接入自定义第三方打码接口，配置创建任务、轮询结果与字段路径。站点匹配规则后续接入。':
    'Connect custom captcha providers with create/poll endpoints and response paths. Site matching rules will be added later.',
  '管理第三方爬虫客户端，支持拉取任务配置和推送任务两种模式，并接收采集结果。':
    'Manage third-party crawler clients with pull and push job delivery and result callbacks.',
  '管理员可创建成员账号并分配管理员、操作员或只读角色。':
    'Administrators can create member accounts and assign administrator, operator or viewer roles.',
  '记录登录、账号、站点会话、打码平台与 API 客户端的服务端操作。':
    'Audit server-side actions for logins, users, site sessions, captcha providers and API clients.',
  '管理当前账号密码和登录会话。会话保存在服务端 SQLite，可随时吊销。':
    'Manage the current password and login sessions. Sessions are stored in server-side SQLite and can be revoked.',
}

const ATTRIBUTE_MAP = {
  ...TEXT_MAP,
}

let observer = null
const textOriginals = new Map()
const attrOriginals = new Map()
let translating = false

const TEXT_PATTERNS = [
  [/^共\s*(\d+)\s*条记录$/, (m) => `${m[1]} records`],
  [/^筛选结果\s*(\d+)\s*条$/, (m) => `${m[1]} results`],
  [/^近 7 天新增 · (\d+) 个站点已接入$/, (m) => `${m[1]} sites added in 7 days`],
  [/^(\d+) 个任务待采集$/, (m) => `${m[1]} tasks ready`],
  [/^来自 (\d+) 个关联存储$/, (m) => `From ${m[1]} storage targets`],
  [/^基于最近 (\d+) 次运行$/, (m) => `Based on the last ${m[1]} runs`],
  [/^(\d+) 个任务$/, (m) => `${m[1]} tasks`],
  [/^(\d+) 条$/, (m) => `${m[1]} records`],
  [/^(\d+) 个$/, (m) => `${m[1]}`],
  [/^已选 (\d+) 项$/, (m) => `${m[1]} selected`],
  [/^共 (\d+) 条$/, (m) => `${m[1]} records`],
  [/^第 (\d+) \/ (\d+) 页$/, (m) => `Page ${m[1]} / ${m[2]}`],
  [/^(\d+) 条记录$/, (m) => `${m[1]} records`],
]

function translateCore(text) {
  const value = String(text ?? '').trim()
  if (!value) return value
  if (TEXT_MAP[value]) return TEXT_MAP[value]
  for (const [pattern, render] of TEXT_PATTERNS) {
    const match = value.match(pattern)
    if (match) return render(match)
  }
  return value
}

function preserve(text) {
  const leading = text.match(/^\s*/)?.[0] || ''
  const trailing = text.match(/\s*$/)?.[0] || ''
  const core = text.trim()
  if (!core) return text
  const translated = translateCore(core)
  return translated === core ? text : `${leading}${translated}${trailing}`
}

function shouldSkip(node) {
  const element = node.nodeType === 1 ? node : node.parentElement
  if (!element) return true
  if (element.closest('script, style, code, pre, textarea, .code-text, .entity-name, .request-url, .api-json-view, [data-no-i18n]')) {
    return true
  }
  return false
}

function translateTextNode(node) {
  if (translating || !node?.nodeValue || shouldSkip(node)) return
  const text = node.nodeValue
  const core = text.trim()
  if (!core) return
  const translated = preserve(text)
  if (translated === text) return
  if (!textOriginals.has(node)) textOriginals.set(node, text)
  translating = true
  node.nodeValue = translated
  translating = false
}

function translateAttributes(element) {
  if (translating || shouldSkip(element)) return
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    const value = element.getAttribute(attr)
    if (!value || !ATTRIBUTE_MAP[value.trim()]) continue
    const key = `${attr}:${value}`
    if (!attrOriginals.has(element)) attrOriginals.set(element, new Map())
    const map = attrOriginals.get(element)
    if (!map.has(attr)) map.set(attr, value)
    translating = true
    element.setAttribute(attr, ATTRIBUTE_MAP[value.trim()])
    translating = false
  }
}

function translateTree(root) {
  if (localeState.locale !== 'en' || !root) return
  if (root.nodeType === 3) {
    translateTextNode(root)
    return
  }
  if (root.nodeType !== 1) return
  translateAttributes(root)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    translateTextNode(node)
    node = walker.nextNode()
  }
  root.querySelectorAll?.('[placeholder], [title], [aria-label]').forEach(translateAttributes)
}

function restoreTranslations() {
  translating = true
  for (const [node, text] of textOriginals) {
    if (node.isConnected) node.nodeValue = text
  }
  for (const [element, attrs] of attrOriginals) {
    if (!element.isConnected) continue
    for (const [attr, value] of attrs) element.setAttribute(attr, value)
  }
  translating = false
  textOriginals.clear()
  attrOriginals.clear()
}

export function translateText(text) {
  if (localeState.locale !== 'en') return text
  const raw = String(text ?? '')
  return translateCore(raw)
}

export function t(key, fallback = '') {
  if (localeState.locale === 'zh') return fallback || key
  return MESSAGES.en[key] || fallback || key
}

export function setLocale(locale) {
  const next = locale === 'en' ? 'en' : 'zh'
  if (localeState.locale === next) return
  localeState.locale = next
  localStorage.setItem(STORAGE_KEY, next)
  try {
    const raw = localStorage.getItem('caifeng.preferences.v1')
    const cached = raw ? JSON.parse(raw) : {}
    localStorage.setItem(
      'caifeng.preferences.v1',
      JSON.stringify({ ...cached, language: next }),
    )
  } catch {
    // ignore cache update failures
  }
  document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN'
  if (next === 'en') translateTree(document.body)
  else restoreTranslations()
}

export function installDomTranslator() {
  if (observer) return
  if (localeState.locale === 'en') translateTree(document.body)
  observer = new MutationObserver((mutations) => {
    if (localeState.locale !== 'en') return
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') translateTextNode(mutation.target)
      if (mutation.type === 'attributes' && mutation.target.nodeType === 1) {
        translateAttributes(mutation.target)
      }
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1 || node.nodeType === 3) translateTree(node)
      })
    }
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'title', 'aria-label'],
  })
}

export function uninstallDomTranslator() {
  observer?.disconnect()
  observer = null
  restoreTranslations()
}
