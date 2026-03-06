<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RouterView, RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'
import { useAuth } from '@/composables/useAuth'
import { useApi } from '@/composables/useApi'
import {
  LayoutDashboard,
  Server,
  Users,
  Store,
  Shield,
  ShieldCheck,
  UserCircle,
  Settings,
  CreditCard,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  ScrollText,
  ChevronDown,
  Search,
  Activity,
  Bug,
  Languages,
  Download,
  Mail,
  Layers,
  HardDrive,
  Globe,
  Handshake,
  ArrowUpCircle,
  ListFilter,
  PanelLeftClose,
  PanelLeftOpen,
  Megaphone,
  LifeBuoy,
  Bot,
  FileText,
  Database,
} from 'lucide-vue-next'
import NotificationBell from '@/components/NotificationBell.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import SidebarTooltip from '@/components/SidebarTooltip.vue'
import { useCommandPalette } from '@/composables/useCommandPalette'
import { useBranding } from '@/composables/useBranding'
import { useSidebarCollapse } from '@/composables/useSidebarCollapse'
import { versionInfo, updateVersion } from '@/composables/useVersionInfo'
import { useAdminPermissions, type AdminSection } from '@/composables/useAdminPermissions'

const commandPalette = useCommandPalette()
const { brandTitle, logoSrc } = useBranding()
const api = useApi()
const adminPerms = useAdminPermissions()

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const isMac = typeof globalThis.navigator !== 'undefined' && globalThis.navigator.platform?.includes('Mac')
const { theme, toggle } = useTheme()
const { user, logout } = useAuth()

const sidebarOpen = ref(false)
const userMenuOpen = ref(false)
const { collapsed, toggle: toggleCollapse } = useSidebarCollapse()

onMounted(async () => {
  // Fetch admin permissions (for nav filtering)
  adminPerms.fetch()

  // Load custom locales for language selector
  try {
    const stored = localStorage.getItem('fleet_custom_locales')
    if (stored) customLocales.value = JSON.parse(stored)
  } catch { /* ignore */ }

  try {
    const notif = await api.get<any>('/updates/notification')
    updateVersion(
      notif.current ?? '',
      notif.latest?.tag ?? null,
      notif.available ?? false,
    )
  } catch {
    // Non-critical — version display is best-effort
  }
})

interface NavItem {
  nameKey: string
  path: string
  icon: any
  section?: AdminSection
  superOnly?: boolean
}

interface NavGroup {
  labelKey: string
  items: NavItem[]
}

const allNavGroups: NavGroup[] = [
  {
    labelKey: 'nav.group.overview',
    items: [
      { nameKey: 'nav.dashboard', path: '/admin', icon: LayoutDashboard, section: 'dashboard' },
      { nameKey: 'nav.nodes', path: '/admin/nodes', icon: Server, section: 'nodes' },
      { nameKey: 'nav.status', path: '/admin/status', icon: Activity, section: 'status' },
      { nameKey: 'nav.statusPosts', path: '/admin/status-posts', icon: Megaphone, section: 'statusPosts' },
    ],
  },
  {
    labelKey: 'nav.group.customers',
    items: [
      { nameKey: 'nav.accounts', path: '/admin/accounts', icon: Users, section: 'accounts' },
      { nameKey: 'nav.users', path: '/admin/users', icon: Users, section: 'users' },
      { nameKey: 'nav.support', path: '/admin/support', icon: LifeBuoy, section: 'support' },
    ],
  },
  {
    labelKey: 'nav.group.platform',
    items: [
      { nameKey: 'nav.services', path: '/admin/services', icon: Layers, section: 'services' },
      { nameKey: 'nav.storage', path: '/admin/storage', icon: HardDrive, section: 'storage' },
      { nameKey: 'nav.marketplace', path: '/admin/marketplace', icon: Store, section: 'marketplace' },
      { nameKey: 'nav.sharedDomains', path: '/admin/shared-domains', icon: Globe, section: 'sharedDomains' },
    ],
  },
  {
    labelKey: 'nav.group.monitoring',
    items: [
      { nameKey: 'nav.events', path: '/admin/events', icon: ScrollText, section: 'events' },
      { nameKey: 'nav.errors', path: '/admin/errors', icon: Bug, section: 'errors' },
      { nameKey: 'nav.logs', path: '/admin/logs', icon: FileText, section: 'services' },
      { nameKey: 'nav.jobs', path: '/admin/jobs', icon: ListFilter, section: 'jobs' },
    ],
  },
  {
    labelKey: 'nav.group.business',
    items: [
      { nameKey: 'nav.billing', path: '/admin/billing', icon: CreditCard, section: 'billing' },
      { nameKey: 'nav.resellers', path: '/admin/resellers', icon: Handshake, section: 'resellers' },
    ],
  },
  {
    labelKey: 'nav.group.system',
    items: [
      { nameKey: 'nav.roles', path: '/admin/roles', icon: ShieldCheck, superOnly: true },
      { nameKey: 'nav.emailTemplates', path: '/admin/email-templates', icon: Mail, section: 'emailTemplates' },
      { nameKey: 'nav.translations', path: '/admin/translations', icon: Languages, superOnly: true },
      { nameKey: 'nav.settings', path: '/admin/settings', icon: Settings, section: 'settings' },
      { nameKey: 'nav.selfHealing', path: '/admin/self-healing', icon: Bot, superOnly: true },
      { nameKey: 'nav.database', path: '/admin/database', icon: Database, section: 'database' },
      { nameKey: 'nav.updates', path: '/admin/updates', icon: Download, section: 'updates' },
    ],
  },
]

const navGroups = computed(() => {
  return allNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.superOnly) return user.value?.isSuper
        if (!item.section) return true
        return adminPerms.can(item.section)
      }),
    }))
    .filter((group) => group.items.length > 0)
})

function isActive(path: string) {
  if (path === '/admin') {
    return route.path === '/admin'
  }
  return route.path === path || route.path.startsWith(path + '/')
}

async function handleLogout() {
  userMenuOpen.value = false
  await logout()
}

function goToPanel() {
  router.push('/panel')
}

const customLocales = ref<{ code: string; name: string }[]>([])
const localeOpen = ref(false)

const locales = [
  { code: 'en', label: 'English', flagSvg: '<svg width="100%" height="100%" viewBox="0 0 60 30" preserveAspectRatio="none"><rect width="60" height="30" fill="#012169"/><path d="m0 0 60 30M60 0 0 30" stroke="#fff" stroke-width="6"/><path d="m0 0 60 30M60 0 0 30" stroke="#C8102E" stroke-width="2"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></svg>' },
  { code: 'nb', label: 'Norsk', flagSvg: '<svg width="100%" height="100%" viewBox="0 0 22 16" preserveAspectRatio="none"><rect width="22" height="16" fill="#BA0C2F"/><path d="M8 0v16M0 8h22" stroke="#fff" stroke-width="4"/><path d="M8 0v16M0 8h22" stroke="#002868" stroke-width="2"/></svg>' },
  { code: 'de', label: 'Deutsch', flagSvg: '<svg width="100%" height="100%" viewBox="0 0 5 3" preserveAspectRatio="none"><rect width="5" height="1" fill="#000"/><rect y="1" width="5" height="1" fill="#D00"/><rect y="2" width="5" height="1" fill="#FFCE00"/></svg>' },
  { code: 'zh', label: '中文', flagSvg: '<svg width="100%" height="100%" viewBox="0 0 30 20" preserveAspectRatio="none"><rect width="30" height="20" fill="#DE2910"/><polygon fill="#FFDE00" points="5,1 6,3.5 8.5,3.5 6.5,5.2 7.3,7.7 5,6 2.7,7.7 3.5,5.2 1.5,3.5 4,3.5"/></svg>' },
]

const allLocales = computed(() => {
  const base = [...locales]
  for (const cl of customLocales.value) {
    if (!base.find(l => l.code === cl.code)) {
      base.push({ code: cl.code, label: cl.name, flagSvg: '' })
    }
  }
  return base
})

const currentLocale = computed(() => allLocales.value.find(l => l.code === locale.value) || locales[0]!)

function changeLocale(newLocale: string) {
  locale.value = newLocale
  localStorage.setItem('fleet_locale', newLocale)
  localeOpen.value = false
}
</script>

<template>
  <div class="min-h-screen bg-gray-100 dark:bg-gray-900">
    <!-- Mobile sidebar overlay -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-black/50 lg:hidden"
      @click="sidebarOpen = false"
    />

    <!-- Sidebar -->
    <aside
      :class="[
        'fixed inset-y-0 left-0 z-50 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-all duration-200 lg:translate-x-0 flex flex-col overflow-hidden',
        collapsed ? 'w-16' : 'w-64',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      ]"
    >
      <div :class="['flex items-center justify-center h-16 border-b border-gray-200 dark:border-gray-700 shrink-0', collapsed ? 'px-2' : 'px-6']">
        <RouterLink to="/" :class="['flex items-center', collapsed ? 'justify-center' : 'gap-2']">
          <img v-if="logoSrc()" :src="logoSrc()!" :alt="brandTitle" :class="['h-8 object-contain', collapsed ? 'w-8' : 'w-auto max-w-[140px]']" />
          <svg v-else class="w-8 h-8 shrink-0" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="nav-g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#0ea5e9"/><stop offset="100%" stop-color="#0369a1"/></linearGradient></defs>
            <rect width="64" height="64" rx="14" fill="url(#nav-g)"/>
            <text x="32" y="44" font-family="system-ui,-apple-system,sans-serif" font-weight="700" font-size="36" fill="#fff" text-anchor="middle">F</text>
          </svg>
          <span v-if="!collapsed" class="text-xl font-medium text-gray-900 dark:text-white truncate">{{ brandTitle }}</span>
        </RouterLink>
      </div>

      <!-- Power Admin banner -->
      <div :class="['py-2 text-white shrink-0 sidebar-banner-shimmer', collapsed ? 'px-2' : 'px-[30px]']">
        <div :class="['flex items-center gap-1.5', collapsed && 'justify-center']" style="text-shadow: 0 1px 3px rgba(0,0,0,0.35);">
          <Shield
            :class="['w-3.5 h-3.5 shrink-0', collapsed && 'cursor-pointer hover:text-white/80']"
            @click="collapsed && toggleCollapse()"
          />
          <span v-if="!collapsed" class="text-xs font-semibold tracking-wide uppercase">{{ $t('nav.admin') }}</span>
          <button
            v-if="!collapsed"
            @click="toggleCollapse"
            class="hidden lg:flex ml-auto p-1 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            style="text-shadow: none;"
          >
            <PanelLeftClose class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <nav :class="['mt-2 pb-4 overflow-y-auto flex-1', collapsed ? 'px-2 scrollbar-hide' : 'px-3']">
        <template v-for="(group, gi) in navGroups" :key="group.labelKey">
          <!-- Group header -->
          <div v-if="!collapsed" :class="['px-3 pt-4 pb-1', gi === 0 && 'pt-2']">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{{ $t(group.labelKey) }}</span>
          </div>
          <div v-else-if="gi > 0" class="my-2 mx-1 border-t border-gray-200 dark:border-gray-700" />

          <div class="space-y-0.5">
            <template v-for="item in group.items" :key="item.path">
              <SidebarTooltip :label="$t(item.nameKey)" :show="collapsed">
                <RouterLink
                  :to="item.path"
                  :class="[
                    'flex items-center rounded-lg text-sm font-medium transition-all duration-150 border-l-[3px]',
                    collapsed
                      ? 'justify-center p-2.5 border-l-transparent'
                      : 'gap-3 px-3 py-2',
                    isActive(item.path)
                      ? collapsed
                        ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                        : 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border-l-primary-500'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border-l-transparent',
                  ]"
                  @click="sidebarOpen = false"
                >
                  <component :is="item.icon" class="w-5 h-5 shrink-0" />
                  <span v-if="!collapsed">{{ $t(item.nameKey) }}</span>
                </RouterLink>
              </SidebarTooltip>
            </template>
          </div>
        </template>
      </nav>

      <!-- Version badge -->
      <div v-if="versionInfo" :class="['border-t border-gray-200 dark:border-gray-700 shrink-0', collapsed ? 'px-1.5 py-2' : 'px-4 py-2']">
        <SidebarTooltip :label="versionInfo.updateAvailable ? `${versionInfo.latest} available` : versionInfo.current" :show="collapsed">
          <RouterLink
            to="/admin/updates"
            :class="[
              'flex items-center text-xs transition-colors rounded-md',
              collapsed ? 'justify-center p-1.5' : 'gap-2 px-2 py-1.5 -mx-1',
              versionInfo.updateAvailable
                ? 'text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700',
            ]"
          >
            <ArrowUpCircle v-if="versionInfo.updateAvailable" class="w-3.5 h-3.5 shrink-0" />
            <template v-if="collapsed">
              <span v-if="!versionInfo.updateAvailable" class="font-mono text-[10px] leading-tight truncate">{{ versionInfo.current }}</span>
            </template>
            <template v-else>
              <span class="font-mono">{{ versionInfo.current }}</span>
              <span v-if="versionInfo.updateAvailable" class="font-medium ml-auto">{{ versionInfo.latest }} available</span>
            </template>
          </RouterLink>
        </SidebarTooltip>
      </div>

      <!-- Switch to panel -->
      <div :class="['border-t border-gray-200 dark:border-gray-700 shrink-0', collapsed ? 'p-2' : 'p-3']">
        <SidebarTooltip :label="$t('nav.switchToPanel')" :show="collapsed">
          <button
            @click="goToPanel"
            :class="[
              'flex items-center rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
              collapsed ? 'justify-center w-full p-2.5' : 'gap-3 w-full px-3 py-2.5',
            ]"
          >
            <UserCircle class="w-5 h-5 shrink-0" />
            <span v-if="!collapsed">{{ $t('nav.switchToPanel') }}</span>
          </button>
        </SidebarTooltip>
      </div>

      <!-- Collapse toggle (desktop only, collapsed state = own row in sidebar) -->
      <div v-if="collapsed" class="hidden lg:block p-2 border-t border-gray-200 dark:border-gray-700 shrink-0">
        <button
          @click="toggleCollapse"
          class="flex items-center justify-center w-full p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <PanelLeftOpen class="w-5 h-5" />
        </button>
      </div>
    </aside>

    <!-- Main content -->
    <div :class="['min-w-0 overflow-x-hidden transition-all duration-200 flex flex-col h-screen', collapsed ? 'lg:pl-16' : 'lg:pl-64']">
      <!-- Top header -->
      <header class="shrink-0 z-30 h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 gap-4">
        <!-- Mobile hamburger -->
        <button
          class="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          @click="sidebarOpen = !sidebarOpen"
        >
          <Menu v-if="!sidebarOpen" class="w-5 h-5" />
          <X v-else class="w-5 h-5" />
        </button>

        <!-- Search trigger -->
        <div class="hidden sm:block flex-1 max-w-md lg:ml-2">
          <button
            @click="commandPalette.open()"
            class="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
          >
            <Search class="w-4 h-4" />
            <span class="flex-1 text-left">{{ $t('common.search') }}</span>
            <kbd class="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-600 rounded text-[10px] font-mono">{{ isMac ? '⌘' : 'Ctrl+' }}K</kbd>
          </button>
        </div>

        <div class="flex items-center gap-2 ml-auto mr-2">
          <!-- Language selector -->
          <div class="relative">
            <button
              @click="localeOpen = !localeOpen"
              class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs sm:text-sm border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              <span v-if="currentLocale.flagSvg" class="inline-block w-5 h-3.5 rounded-sm overflow-hidden shrink-0" v-html="currentLocale.flagSvg"></span>
              <span>{{ currentLocale.label }}</span>
              <ChevronDown class="w-3 h-3 shrink-0" />
            </button>
            <div v-if="localeOpen" class="fixed inset-0 z-40" @click="localeOpen = false" />
            <div v-if="localeOpen" class="absolute right-0 mt-1 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
              <button
                v-for="loc in allLocales"
                :key="loc.code"
                @click="changeLocale(loc.code)"
                :class="[
                  'flex items-center gap-2 w-full px-3 py-1.5 text-sm transition-colors',
                  loc.code === locale
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
                ]"
              >
                <span v-if="loc.flagSvg" class="inline-block w-5 h-3.5 rounded-sm overflow-hidden shrink-0" v-html="loc.flagSvg"></span>
                <span v-else class="inline-block w-5 h-3.5 shrink-0"></span>
                <span>{{ loc.label }}</span>
              </button>
            </div>
          </div>

          <!-- Theme toggle -->
          <button
            @click="toggle"
            class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            :title="`Theme: ${theme}`"
          >
            <Sun v-if="theme === 'light'" class="w-5 h-5" />
            <Moon v-else class="w-5 h-5" />
          </button>

          <!-- Notifications -->
          <NotificationBell />

          <!-- User menu -->
          <div class="relative">
            <button
              @click="userMenuOpen = !userMenuOpen"
              class="flex items-center gap-2 p-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              :title="user?.name ?? user?.email ?? ''"
            >
              <div class="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center text-primary-700 dark:text-primary-300 text-sm font-semibold overflow-hidden">
                <img v-if="user?.avatarUrl" :src="user.avatarUrl" :alt="user.name || 'Avatar'" class="w-full h-full object-cover" />
                <span v-else>{{ user?.name?.charAt(0)?.toUpperCase() ?? '?' }}</span>
              </div>
            </button>

            <!-- Click-outside overlay -->
            <div v-if="userMenuOpen" class="fixed inset-0 z-40" @click="userMenuOpen = false" />

            <!-- Dropdown -->
            <div
              v-if="userMenuOpen"
              class="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50"
            >
              <div class="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ user?.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ user?.email }}</p>
              </div>
              <RouterLink
                to="/admin/profile"
                class="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                @click="userMenuOpen = false"
              >
                <UserCircle class="w-4 h-4" />
                {{ $t('nav.profile') }}
              </RouterLink>
              <button
                @click="handleLogout"
                class="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <LogOut class="w-4 h-4" />
                {{ $t('auth.signOut') }}
              </button>
            </div>
          </div>
        </div>
      </header>

      <!-- Page content -->
      <main class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <div v-if="Component" :key="$route.path" class="flex-1 min-h-0 overflow-y-auto p-6" style="scrollbar-gutter: stable">
              <component :is="Component" />
            </div>
          </Transition>
        </RouterView>
      </main>
    </div>

    <!-- Command Palette -->
    <CommandPalette />
  </div>
</template>

<style scoped>
@property --shimmer-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

@property --shimmer-x {
  syntax: '<percentage>';
  initial-value: -15%;
  inherits: false;
}

.sidebar-banner-shimmer {
  position: relative;
  overflow: hidden;
  background: conic-gradient(from var(--shimmer-angle) at var(--shimmer-x) 50%, #075985, #0284c7, #0ea5e9, #0284c7, #075985);
  animation: sidebar-rotate 10s linear infinite, sidebar-drift 7s ease-in-out infinite alternate;
}

.sidebar-banner-shimmer > * {
  position: relative;
  z-index: 1;
}

.sidebar-banner-shimmer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 60%;
  background: linear-gradient(105deg, transparent, rgba(255,255,255,0.15) 50%, transparent);
  animation: sidebar-glint 10s linear infinite;
  pointer-events: none;
  transform: translateX(-100%);
  opacity: 0;
}

@keyframes sidebar-rotate {
  to { --shimmer-angle: 360deg; }
}

@keyframes sidebar-drift {
  from { --shimmer-x: -25%; }
  to { --shimmer-x: -5%; }
}

@keyframes sidebar-glint {
  0% { transform: translateX(-100%); opacity: 0; }
  5% { opacity: 1; }
  35% { opacity: 1; }
  40% { transform: translateX(250%); opacity: 0; }
  100% { transform: translateX(250%); opacity: 0; }
}
</style>
