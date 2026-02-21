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
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('@/pages/auth/ForgotPassword.vue'),
    meta: { public: true },
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('@/pages/auth/ResetPassword.vue'),
    meta: { public: true },
  },
  {
    path: '/two-factor',
    name: 'two-factor',
    component: () => import('@/pages/auth/TwoFactor.vue'),
    meta: { public: true },
  },
  {
    path: '/verify-email',
    name: 'verify-email',
    component: () => import('@/pages/auth/VerifyEmail.vue'),
    meta: { public: true },
  },
  {
    path: '/r/:slug',
    name: 'reseller-signup',
    component: () => import('@/pages/auth/ResellerSignup.vue'),
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
        path: 'events',
        name: 'super-events',
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
      {
        path: 'status',
        name: 'super-status',
        component: () => import('@/pages/super/Status.vue'),
      },
      {
        path: 'errors',
        name: 'super-errors',
        component: () => import('@/pages/super/Errors.vue'),
      },
      {
        path: 'updates',
        name: 'super-updates',
        component: () => import('@/pages/super/Updates.vue'),
      },
      {
        path: 'email-templates',
        name: 'super-email-templates',
        component: () => import('@/pages/super/EmailTemplates.vue'),
      },
      {
        path: 'services',
        name: 'super-services',
        component: () => import('@/pages/super/Services.vue'),
      },
      {
        path: 'storage',
        name: 'super-storage',
        component: () => import('@/pages/super/StorageSetup.vue'),
      },
      {
        path: 'shared-domains',
        name: 'super-shared-domains',
        component: () => import('@/pages/super/SharedDomains.vue'),
      },
      {
        path: 'resellers',
        name: 'super-resellers',
        component: () => import('@/pages/super/Resellers.vue'),
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
        path: 'stacks',
        name: 'panel-stacks',
        component: () => import('@/pages/panel/Stacks.vue'),
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
        path: 'deploy/gh',
        name: 'deploy-github-oneclick',
        component: () => import('@/pages/panel/DeployGitHub.vue'),
      },
      {
        path: 'marketplace',
        name: 'panel-marketplace',
        component: () => import('@/pages/panel/Marketplace.vue'),
      },
      {
        path: 'marketplace/:slug',
        name: 'panel-deploy-wizard',
        component: () => import('@/pages/panel/DeployWizard.vue'),
        props: true,
      },
      {
        path: 'domains',
        name: 'panel-domains',
        component: () => import('@/pages/panel/Domains.vue'),
      },
      {
        path: 'domains/:id',
        name: 'panel-domain-detail',
        component: () => import('@/pages/panel/DomainDetail.vue'),
        props: true,
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
        path: 'api-keys',
        name: 'ApiKeys',
        component: () => import('@/pages/panel/ApiKeys.vue'),
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
        path: 'activity',
        name: 'panel-activity',
        component: () => import('@/pages/panel/Activity.vue'),
      },
      {
        path: 'billing',
        name: 'panel-billing',
        component: () => import('@/pages/panel/Billing.vue'),
        meta: { requireOwner: true },
      },
      {
        path: 'settings',
        name: 'panel-settings',
        component: () => import('@/pages/panel/Settings.vue'),
      },
      {
        path: 'profile',
        name: 'panel-profile',
        component: () => import('@/pages/panel/Profile.vue'),
      },
      {
        path: 'reseller',
        name: 'panel-reseller',
        component: () => import('@/pages/panel/Reseller.vue'),
        meta: { requireOwner: true },
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

let appInitialized = false

router.beforeEach(async (to) => {
  const { useAuthStore } = await import('@/stores/auth')
  const authStore = useAuthStore()

  // Ensure auth is initialized (silent refresh from httpOnly cookie)
  if (!authStore.initialized) {
    await authStore.init()
  }

  const isAuthenticated = authStore.isAuthenticated

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
    appInitialized = false
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  // Load user & accounts once per page load so stores are populated
  if (!appInitialized) {
    appInitialized = true
    try {
      const { useAccountStore } = await import('@/stores/account')
      const accountStore = useAccountStore()
      await authStore.loadUser()
      if (authStore.isAuthenticated) {
        await accountStore.fetchAccounts()
      }
    } catch {
      // Cached data from localStorage is still available
    }
  }

  // Check super user access for admin routes
  if (to.matched.some((record) => record.meta.requiresSuper)) {
    if (!authStore.isSuper) {
      return { path: '/panel' }
    }
  }

  // Check owner access for billing routes (defense-in-depth; backend also enforces)
  if (to.matched.some((record) => record.meta.requireOwner)) {
    try {
      const { useRole } = await import('@/composables/useRole')
      const { canOwner } = useRole()
      if (!canOwner.value && !authStore.isSuper) {
        return { path: '/panel' }
      }
    } catch {
      // Role not yet loaded; allow navigation — backend will enforce
    }
  }
})
