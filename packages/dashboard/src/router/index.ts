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
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('@/pages/auth/GetStarted.vue'),
    meta: { public: true },
  },
  {
    path: '/register',
    redirect: '/onboarding',
  },
  {
    path: '/get-started',
    redirect: '/onboarding',
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
    path: '/verify-email-change',
    name: 'verify-email-change',
    component: () => import('@/pages/auth/VerifyEmailChange.vue'),
    meta: { public: true },
  },
  {
    path: '/checkout',
    name: 'checkout',
    component: () => import('@/pages/auth/Checkout.vue'),
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
        meta: { adminSection: 'dashboard' },
      },
      {
        path: 'nodes',
        name: 'super-nodes',
        component: () => import('@/pages/super/Nodes.vue'),
        meta: { adminSection: 'nodes' },
      },
      {
        path: 'nodes/:id',
        name: 'super-node-detail',
        component: () => import('@/pages/super/NodeDetail.vue'),
        props: true,
        meta: { adminSection: 'nodes' },
      },
      {
        path: 'accounts',
        name: 'super-accounts',
        component: () => import('@/pages/super/Accounts.vue'),
        meta: { adminSection: 'accounts' },
      },
      {
        path: 'accounts/:id',
        name: 'super-account-detail',
        component: () => import('@/pages/super/AccountDetail.vue'),
        props: true,
        meta: { adminSection: 'accounts' },
      },
      {
        path: 'users',
        name: 'super-users',
        component: () => import('@/pages/super/Users.vue'),
        meta: { adminSection: 'users' },
      },
      {
        path: 'marketplace',
        name: 'super-marketplace',
        component: () => import('@/pages/super/Marketplace.vue'),
        meta: { adminSection: 'marketplace' },
      },
      {
        path: 'events',
        name: 'super-events',
        component: () => import('@/pages/super/AuditLog.vue'),
        meta: { adminSection: 'events' },
      },
      {
        path: 'settings',
        name: 'super-settings',
        component: () => import('@/pages/super/Settings.vue'),
        meta: { adminSection: 'settings' },
      },
      {
        path: 'billing',
        name: 'super-billing',
        component: () => import('@/pages/super/Billing.vue'),
        meta: { adminSection: 'billing' },
      },
      {
        path: 'status',
        name: 'super-status',
        component: () => import('@/pages/super/Status.vue'),
        meta: { adminSection: 'status' },
      },
      {
        path: 'errors',
        name: 'super-errors',
        component: () => import('@/pages/super/Errors.vue'),
        meta: { adminSection: 'errors' },
      },
      {
        path: 'logs',
        name: 'super-logs',
        component: () => import('@/pages/super/Logs.vue'),
        meta: { adminSection: 'services' },
      },
      {
        path: 'updates',
        name: 'super-updates',
        component: () => import('@/pages/super/Updates.vue'),
        meta: { adminSection: 'updates' },
      },
      {
        path: 'email-templates',
        name: 'super-email-templates',
        component: () => import('@/pages/super/EmailTemplates.vue'),
        meta: { adminSection: 'emailTemplates' },
      },
      {
        path: 'services',
        name: 'super-services',
        component: () => import('@/pages/super/Services.vue'),
        meta: { adminSection: 'services' },
      },
      {
        path: 'storage',
        name: 'super-storage',
        component: () => import('@/pages/super/StorageSetup.vue'),
        meta: { adminSection: 'storage' },
      },
      {
        path: 'shared-domains',
        name: 'super-shared-domains',
        component: () => import('@/pages/super/SharedDomains.vue'),
        meta: { adminSection: 'sharedDomains' },
      },
      {
        path: 'resellers',
        name: 'super-resellers',
        component: () => import('@/pages/super/Resellers.vue'),
        meta: { adminSection: 'resellers' },
      },
      {
        path: 'jobs',
        name: 'super-jobs',
        component: () => import('@/pages/super/Jobs.vue'),
        meta: { adminSection: 'jobs' },
      },
      {
        path: 'status-posts',
        name: 'super-status-posts',
        component: () => import('@/pages/super/StatusPosts.vue'),
        meta: { adminSection: 'statusPosts' },
      },
      {
        path: 'jobs/:queue/:id',
        name: 'super-job-detail',
        component: () => import('@/pages/super/JobDetail.vue'),
        props: true,
        meta: { adminSection: 'jobs' },
      },
      {
        path: 'translations',
        name: 'super-translations',
        component: () => import('@/pages/super/Translations.vue'),
        meta: { superOnly: true },
      },
      {
        path: 'roles',
        name: 'super-roles',
        component: () => import('@/pages/super/Roles.vue'),
        meta: { superOnly: true },
      },
      {
        path: 'self-healing',
        name: 'super-self-healing',
        component: () => import('@/pages/super/SelfHealing.vue'),
        meta: { superOnly: true },
      },
      {
        path: 'resources',
        name: 'super-resources',
        component: () => import('@/pages/super/Resources.vue'),
        meta: { adminSection: 'nodes' },
      },
      {
        path: 'analytics',
        name: 'super-analytics',
        component: () => import('@/pages/super/PlatformAnalytics.vue'),
        meta: { adminSection: 'dashboard' },
      },
      {
        path: 'security',
        name: 'super-security',
        component: () => import('@/pages/super/Security.vue'),
        meta: { adminSection: 'events' },
      },
      {
        path: 'database',
        name: 'super-database',
        component: () => import('@/pages/super/PlatformDatabase.vue'),
        meta: { adminSection: 'database' },
      },
      {
        path: 'support',
        name: 'super-support',
        component: () => import('@/pages/super/Support.vue'),
        meta: { adminSection: 'support' },
      },
      {
        path: 'support/:id',
        name: 'super-support-detail',
        component: () => import('@/pages/super/SupportDetail.vue'),
        props: true,
        meta: { adminSection: 'support' },
      },
      {
        path: 'profile',
        name: 'super-profile',
        component: () => import('@/pages/panel/Profile.vue'),
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
        path: 'stacks/:stackId',
        name: 'panel-stack-detail',
        component: () => import('@/pages/panel/StackDetail.vue'),
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
        path: 'logs',
        name: 'panel-logs',
        component: () => import('@/pages/panel/Logs.vue'),
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
      {
        path: 'support',
        name: 'panel-support',
        component: () => import('@/pages/panel/Support.vue'),
      },
      {
        path: 'support/:id',
        name: 'panel-support-detail',
        component: () => import('@/pages/panel/SupportDetail.vue'),
        props: true,
      },
      {
        path: 'compass-test',
        name: 'panel-compass-test',
        component: () => import('@/pages/panel/CompassTest.vue'),
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

const landingRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/pages/landing/HomeView.vue'),
    meta: { public: true, landing: true },
  },
  {
    path: '/docs',
    name: 'docs',
    component: () => import('@/pages/landing/DocsView.vue'),
    meta: { public: true, landing: true },
  },
  {
    path: '/status',
    name: 'status',
    component: () => import('@/pages/landing/StatusView.vue'),
    meta: { public: true, landing: true },
  },
  {
    path: '/privacy',
    name: 'privacy',
    component: () => import('@/pages/landing/PrivacyView.vue'),
    meta: { public: true, landing: true },
  },
  {
    path: '/terms',
    name: 'terms',
    component: () => import('@/pages/landing/TermsView.vue'),
    meta: { public: true, landing: true },
  },
]

const routes: RouteRecordRaw[] = [
  ...landingRoutes,
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
  scrollBehavior(to, _from, savedPosition) {
    if (to.hash) {
      return { el: to.hash, behavior: 'smooth' }
    }
    if (savedPosition) return savedPosition
    return { top: 0 }
  },
})

// Handle chunk load failures during rolling deployments.
// When the dashboard is updated, old JS chunks are replaced with new ones.
// If a browser has the old index.html cached or hits a stale replica,
// dynamic imports will 404. Detect this and force a reload (once).
router.onError((error, to) => {
  const chunkFailure =
    error.message.includes('Failed to fetch dynamically imported module') ||
    error.message.includes('Loading chunk') ||
    error.message.includes('Loading CSS chunk')

  if (chunkFailure) {
    const reloadKey = 'fleet_chunk_reload'
    const lastReload = sessionStorage.getItem(reloadKey)
    // Prevent infinite reload loops — only retry once per path
    if (lastReload !== to.fullPath) {
      sessionStorage.setItem(reloadKey, to.fullPath)
      window.location.assign(to.fullPath)
    }
  }
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

  // Check if platform needs first-run setup (skip for setup routes themselves).
  // CRITICAL: Never redirect authenticated users to /setup. A valid JWT proves
  // users exist — redirecting could expose the setup wizard to production users
  // during transient API/DB issues (e.g. container restarts during updates).
  if (!to.path.startsWith('/setup') && !isAuthenticated) {
    const setupDone = localStorage.getItem('fleet_setup_done')
    if (!setupDone) {
      try {
        const res = await fetch('/api/v1/setup/status')
        if (res.ok) {
          const data = await res.json()
          if (data?.needsSetup === true) {
            localStorage.removeItem('fleet_setup_done')
            return { path: '/setup' }
          }
          localStorage.setItem('fleet_setup_done', 'true')
        }
        // Non-200 responses (500, 502, etc.) are ignored — never redirect on errors
      } catch {
        // API not available, continue normally
      }
    }
  }

  // Redirect away from /setup if setup is already done
  if (to.path.startsWith('/setup')) {
    try {
      const res = await fetch('/api/v1/setup/status')
      if (res.ok) {
        const data = await res.json()
        if (data?.needsSetup !== true) {
          localStorage.setItem('fleet_setup_done', 'true')
          return { path: isAuthenticated ? '/panel' : '/login' }
        }
      }
    } catch {
      // API not available — let them through, the page itself will handle it
    }
  }

  // Allow public routes
  if (to.meta.public) {
    if (isAuthenticated && to.name === 'login') {
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

  // Check admin access for admin routes (super users + role-based admins)
  if (to.matched.some((record) => record.meta.requiresSuper)) {
    if (!authStore.isSuper && !authStore.user?.adminRoleId) {
      return { path: '/panel' }
    }

    // Super-only routes (roles, translations, self-healing)
    const superOnlyRoute = to.matched.find((r) => r.meta.superOnly)
    if (superOnlyRoute && !authStore.isSuper) {
      return { path: '/admin' }
    }

    // Section-level permission check for role-based admins
    const adminSection = to.meta.adminSection as string | undefined
    if (adminSection && !authStore.isSuper) {
      const { useAdminPermissions } = await import('@/composables/useAdminPermissions')
      const adminPerms = useAdminPermissions()
      if (!adminPerms.permissions.value) {
        await adminPerms.fetch()
      }
      if (!adminPerms.can(adminSection as any, 'read')) {
        return { path: '/admin' }
      }
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
