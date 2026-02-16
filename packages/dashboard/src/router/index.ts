import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router'

const authRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/auth/Login.vue'),
    meta: { public: true },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/pages/auth/Register.vue'),
    meta: { public: true },
  },
  {
    path: '/auth/callback',
    name: 'oauth-callback',
    component: () => import('@/pages/auth/OAuth.vue'),
    meta: { public: true },
  },
]

const superRoutes: RouteRecordRaw[] = [
  {
    path: '/admin',
    component: () => import('@/layouts/SuperLayout.vue'),
    meta: { requiresSuper: true },
    children: [
      {
        path: '',
        name: 'super-dashboard',
        component: () => import('@/pages/super/Dashboard.vue'),
      },
      {
        path: 'nodes',
        name: 'super-nodes',
        component: () => import('@/pages/super/Nodes.vue'),
      },
      {
        path: 'accounts',
        name: 'super-accounts',
        component: () => import('@/pages/super/Accounts.vue'),
      },
      {
        path: 'users',
        name: 'super-users',
        component: () => import('@/pages/super/Users.vue'),
      },
      {
        path: 'marketplace',
        name: 'super-marketplace',
        component: () => import('@/pages/super/Marketplace.vue'),
      },
      {
        path: 'audit-log',
        name: 'super-audit-log',
        component: () => import('@/pages/super/AuditLog.vue'),
      },
      {
        path: 'settings',
        name: 'super-settings',
        component: () => import('@/pages/super/Settings.vue'),
      },
      {
        path: 'billing',
        name: 'super-billing',
        component: () => import('@/pages/super/Billing.vue'),
      },
    ],
  },
]

const panelRoutes: RouteRecordRaw[] = [
  {
    path: '/panel',
    component: () => import('@/layouts/PanelLayout.vue'),
    children: [
      {
        path: '',
        name: 'panel-dashboard',
        component: () => import('@/pages/panel/Dashboard.vue'),
      },
      {
        path: 'services',
        name: 'panel-services',
        component: () => import('@/pages/panel/Services.vue'),
      },
      {
        path: 'services/:id',
        name: 'panel-service-detail',
        component: () => import('@/pages/panel/ServiceDetail.vue'),
        props: true,
      },
      {
        path: 'deploy',
        name: 'panel-deploy',
        component: () => import('@/pages/panel/Deploy.vue'),
      },
      {
        path: 'marketplace',
        name: 'panel-marketplace',
        component: () => import('@/pages/panel/Marketplace.vue'),
      },
      {
        path: 'domains',
        name: 'panel-domains',
        component: () => import('@/pages/panel/Domains.vue'),
      },
      {
        path: 'terminal',
        name: 'panel-terminal',
        component: () => import('@/pages/panel/Terminal.vue'),
      },
      {
        path: 'storage',
        name: 'panel-storage',
        component: () => import('@/pages/panel/Storage.vue'),
      },
      {
        path: 'backups',
        name: 'panel-backups',
        component: () => import('@/pages/panel/Backups.vue'),
      },
      {
        path: 'ssh',
        name: 'panel-ssh',
        component: () => import('@/pages/panel/SSH.vue'),
      },
      {
        path: 'sub-accounts',
        name: 'panel-sub-accounts',
        component: () => import('@/pages/panel/SubAccounts.vue'),
      },
      {
        path: 'users',
        name: 'panel-users',
        component: () => import('@/pages/panel/Users.vue'),
      },
      {
        path: 'billing',
        name: 'panel-billing',
        component: () => import('@/pages/panel/Billing.vue'),
      },
      {
        path: 'settings',
        name: 'panel-settings',
        component: () => import('@/pages/panel/Settings.vue'),
      },
    ],
  },
]

const setupRoutes: RouteRecordRaw[] = [
  {
    path: '/setup',
    name: 'setup',
    component: () => import('@/pages/setup/Wizard.vue'),
    meta: { public: true },
  },
  {
    path: '/setup/node',
    name: 'setup-node',
    component: () => import('@/pages/setup/NodeWizard.vue'),
    meta: { public: true },
  },
]

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/panel',
  },
  ...authRoutes,
  ...superRoutes,
  ...panelRoutes,
  ...setupRoutes,
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/pages/NotFound.vue'),
    meta: { public: true },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const token = localStorage.getItem('fleet_token')
  const isAuthenticated = !!token

  // Check if platform needs first-run setup (skip for setup routes themselves)
  if (!to.path.startsWith('/setup')) {
    const setupDone = localStorage.getItem('fleet_setup_done')
    if (!setupDone) {
      try {
        const res = await fetch('/api/v1/setup/status')
        const { needsSetup } = await res.json()
        if (needsSetup) return { path: '/setup' }
        localStorage.setItem('fleet_setup_done', 'true')
      } catch {
        // API not available, continue normally
      }
    }
  }

  // Allow public routes
  if (to.meta.public) {
    if (isAuthenticated && (to.name === 'login' || to.name === 'register')) {
      return { path: '/panel' }
    }
    return
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  // Check super user access for admin routes
  if (to.matched.some((record) => record.meta.requiresSuper)) {
    try {
      const userJson = localStorage.getItem('fleet_user')
      const user = userJson ? JSON.parse(userJson) : null
      if (!user?.isSuper) {
        return { path: '/panel' }
      }
    } catch {
      return { path: '/panel' }
    }
  }
})
