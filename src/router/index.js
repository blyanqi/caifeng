import { createRouter, createWebHistory } from 'vue-router'
import CollectionListView from '../views/CollectionListView.vue'
import LoginView from '../views/LoginView.vue'
import { authState, fetchMe } from '../services/auth'
import { translateText } from '../i18n'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: LoginView,
    meta: { title: '登录', public: true },
  },
  {
    path: '/',
    redirect: '/collections',
  },
  {
    path: '/collections',
    name: 'collections',
    component: CollectionListView,
    meta: {
      title: '采集列表',
      eyebrow: 'COLLECTION LIST',
      description: '编排采集任务，关联站点资源，一键运行并查看采集结果。',
    },
  },
  {
    path: '/sites',
    name: 'sites',
    component: () => import('../views/SitesView.vue'),
    meta: {
      title: '采集站点',
      eyebrow: 'DATA SOURCES',
      description: '管理数据源入口，维护站点地址、连接状态与关联任务。',
    },
  },
  {
    path: '/configs',
    name: 'configs',
    component: () => import('../views/ConfigsView.vue'),
    meta: {
      title: '采集配置管理',
      eyebrow: 'REQUEST SCHEMAS',
      description: '定义请求路径、请求方式与响应解析规则。',
    },
  },
  {
    path: '/headers',
    name: 'headers',
    component: () => import('../views/HeadersView.vue'),
    meta: {
      title: '采集Header管理',
      eyebrow: 'HEADER PROFILES',
      description: '集中维护请求头模板，在多个采集任务之间复用。',
    },
  },
  {
    path: '/params',
    name: 'params',
    component: () => import('../views/ParamsView.vue'),
    meta: {
      title: '采集参数项管理',
      eyebrow: 'QUERY PARAMETERS',
      description: '管理分页、筛选与检索参数，让每次请求更精准。',
    },
  },
  {
    path: '/proxies',
    name: 'proxies',
    component: () => import('../views/ProxiesView.vue'),
    meta: {
      title: '代理管理',
      eyebrow: 'PROXY POOL',
      description: '集中托管 HTTP、HTTPS 与 SOCKS5 出口配置，为后续采集路由做准备。',
    },
  },
  {
    path: '/storages',
    name: 'storages',
    component: () => import('../views/StoragesView.vue'),
    meta: {
      title: '存储管理',
      eyebrow: 'DESTINATIONS',
      description: '为采集结果选择 JSON、CSV 或数据库存储目标。',
    },
  },
  {
    path: '/sessions',
    name: 'sessions',
    component: () => import('../views/SiteSessionsView.vue'),
    meta: {
      title: '会话管理',
      requiresAuth: true,
    },
  },
  {
    path: '/risk',
    name: 'risk',
    component: () => import('../views/RiskManagementView.vue'),
    meta: {
      title: '风控管理',
      requiresAuth: true,
    },
  },
  {
    path: '/captcha',
    name: 'captcha',
    component: () => import('../views/CaptchaView.vue'),
    meta: {
      title: '打码管理',
      requiresAuth: true,
    },
  },
  {
    path: '/api-management',
    name: 'api-management',
    component: () => import('../views/ApiManagementView.vue'),
    meta: {
      title: 'API 管理',
      requiresAuth: true,
    },
  },
  {
    path: '/users',
    name: 'users',
    component: () => import('../views/UsersView.vue'),
    meta: {
      title: '账号与权限',
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: '/audit',
    name: 'audit',
    component: () => import('../views/AuditView.vue'),
    meta: {
      title: '操作审计',
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SystemSettingsView.vue'),
    meta: {
      title: '系统设置',
      requiresAuth: true,
    },
  },
  {
    path: '/security',
    name: 'security',
    component: () => import('../views/SecurityView.vue'),
    meta: {
      title: '账号与安全',
      requiresAuth: true,
    },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/collections',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

router.beforeEach(async (to) => {
  if (to.meta.public) {
    if (to.path === '/login' && authState.user) return '/collections'
    return true
  }
  if (!authState.checked) await fetchMe()
  if (!authState.user) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (to.meta.requiresAdmin && authState.user.role !== 'admin') {
    return '/collections'
  }
  return true
})

router.afterEach((to) => {
  document.title = `${translateText(to.meta.title || '工作台')} · Collect Studio`
})

export default router
