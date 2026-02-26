<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RouterView, RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'
import { useAuth } from '@/composables/useAuth'
import { useAccount } from '@/composables/useAccount'
import { useRole } from '@/composables/useRole'
import { useAuthStore } from '@/stores/auth'
import {
  LayoutDashboard,
  Box,
  Rocket,
  Store,
  Globe,
  Terminal as TerminalIcon,
  HardDrive,
  Archive,
  Key,
  KeyRound,
  ScrollText,
  Users,
  UserPlus,
  CreditCard,
  Handshake,
  Settings,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  ChevronDown,
  ShieldCheck,
  ShieldAlert,
  Languages,
  Search,
  SlidersHorizontal,
} from 'lucide-vue-next'
import NotificationBell from '@/components/NotificationBell.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import AdminOverridesPanel from '@/components/AdminOverridesPanel.vue'
import { useCommandPalette } from '@/composables/useCommandPalette'
import { useApi } from '@/composables/useApi'
import { useBranding } from '@/composables/useBranding'

const commandPalette = useCommandPalette()
const { brandTitle, logoSrc } = useBranding()
const api = useApi()

const { t, locale } = useI18n()
const route = useRoute()
const isMac = typeof globalThis.navigator !== 'undefined' && globalThis.navigator.platform?.includes('Mac')
const { theme, toggle } = useTheme()
const { user, isSuper, logout } = useAuth()
const { currentAccount, accounts, switchAccount } = useAccount()
const { canAdmin, canOwner } = useRole()

const isImpersonating = computed(() => !!sessionStorage.getItem('fleet_impersonating'))

function stopImpersonating() {
  const originalAccountId = sessionStorage.getItem('fleet_original_account_id')
  if (originalAccountId) localStorage.setItem('fleet_account_id', originalAccountId)
  else localStorage.removeItem('fleet_account_id')
  sessionStorage.removeItem('fleet_original_account_id')
  sessionStorage.removeItem('fleet_impersonating')
  // Original token is restored via httpOnly cookie refresh on page reload
  window.location.href = '/admin/accounts'
}

// Reseller branding for sub-accounts
const resellerBranding = ref<{ found: boolean; brandName?: string; brandLogoUrl?: string; brandPrimaryColor?: string }>({ found: false })

onMounted(async () => {
  // Super admins always see platform branding, even when viewing sub-accounts
  if (isSuper) return
  try {
    resellerBranding.value = await api.get('/reseller/parent-branding')
  } catch {
    // Not a sub-account of a reseller, or reseller program not active
  }
})

const sidebarOpen = ref(false)
const userMenuOpen = ref(false)
const accountMenuOpen = ref(false)
const overridesPanelOpen = ref(false)

const navItems = [
  { nameKey: 'nav.dashboard', path: '/panel', icon: LayoutDashboard },
  { nameKey: 'nav.services', path: '/panel/services', icon: Box },
  { nameKey: 'nav.deploy', path: '/panel/deploy', icon: Rocket },
  { nameKey: 'nav.marketplace', path: '/panel/marketplace', icon: Store },
  { nameKey: 'nav.domains', path: '/panel/domains', icon: Globe },
  { nameKey: 'nav.terminal', path: '/panel/terminal', icon: TerminalIcon },
  { nameKey: 'nav.storage', path: '/panel/storage', icon: HardDrive },
  { nameKey: 'nav.backups', path: '/panel/backups', icon: Archive },
  { nameKey: 'nav.ssh', path: '/panel/ssh', icon: Key },
  { nameKey: 'nav.apiKeys', path: '/panel/api-keys', icon: KeyRound, requireAdmin: true },
  { nameKey: 'nav.subAccounts', path: '/panel/sub-accounts', icon: UserPlus },
  { nameKey: 'nav.users', path: '/panel/users', icon: Users },
  { nameKey: 'nav.activity', path: '/panel/activity', icon: ScrollText },
  { nameKey: 'nav.billing', path: '/panel/billing', icon: CreditCard, requireOwner: true },
  { nameKey: 'nav.reseller', path: '/panel/reseller', icon: Handshake, requireOwner: true },
  { nameKey: 'nav.settings', path: '/panel/settings', icon: Settings, requireAdmin: true },
]

function isActive(path: string) {
  if (path === '/panel') {
    return route.path === '/panel'
  }
  return route.path.startsWith(path)
}

async function handleLogout() {
  userMenuOpen.value = false
  await logout()
}

function handleSwitchAccount(id: string) {
  accountMenuOpen.value = false
  switchAccount(id)
}

function changeLocale(newLocale: string) {
  locale.value = newLocale
  localStorage.setItem('fleet_locale', newLocale)
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
        'fixed inset-y-0 left-0 z-50 w-64 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-200 lg:translate-x-0 flex flex-col',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      ]"
    >
      <div class="flex items-center justify-between h-16 px-6 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <RouterLink to="/" class="flex items-center gap-2">
          <img v-if="resellerBranding.found && resellerBranding.brandLogoUrl" :src="resellerBranding.brandLogoUrl" :alt="resellerBranding.brandName" class="h-8 w-auto max-w-[140px] object-contain" />
          <img v-else-if="logoSrc()" :src="logoSrc()!" :alt="brandTitle" class="h-8 w-auto max-w-[140px] object-contain" />
          <template v-else>
            <svg class="w-8 h-8 shrink-0" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
              <defs><linearGradient id="nav-g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#4f46e5"/></linearGradient></defs>
              <rect width="64" height="64" rx="14" fill="url(#nav-g)"/>
              <text x="32" y="44" font-family="system-ui,-apple-system,sans-serif" font-weight="700" font-size="36" fill="#fff" text-anchor="middle">F</text>
            </svg>
          </template>
          <span v-if="resellerBranding.found && resellerBranding.brandName && !resellerBranding.brandLogoUrl" class="text-xl font-bold text-primary-600 dark:text-primary-400">
            {{ resellerBranding.brandName }}
          </span>
          <span v-else-if="!resellerBranding.found && !logoSrc()" class="text-xl font-bold text-primary-600 dark:text-primary-400">
            {{ brandTitle }}
          </span>
        </RouterLink>
      </div>

      <!-- Account banner -->
      <div class="px-3 py-2 text-white text-center shrink-0 sidebar-banner-shimmer">
        <div class="flex items-center justify-center gap-1.5" style="text-shadow: 0 1px 3px rgba(0,0,0,0.35);">
          <Users class="w-3.5 h-3.5" />
          <span class="text-xs font-semibold tracking-wide uppercase truncate">{{ currentAccount?.name || 'Account' }}</span>
        </div>
      </div>

      <nav class="mt-4 px-3 space-y-1 overflow-y-auto flex-1">
        <RouterLink
          v-for="item in navItems.filter(i => (!i.requireAdmin || canAdmin) && (!i.requireOwner || canOwner))"
          :key="item.path"
          :to="item.path"
          :class="[
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 border-l-[3px]',
            isActive(item.path)
              ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border-l-primary-500'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border-l-transparent',
          ]"
          @click="sidebarOpen = false"
        >
          <component :is="item.icon" class="w-5 h-5 shrink-0" />
          {{ $t(item.nameKey) }}
        </RouterLink>
      </nav>

      <!-- Back to Admin (for super users) -->
      <div v-if="isSuper" class="p-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
        <RouterLink
          to="/admin"
          class="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
        >
          <ShieldCheck class="w-5 h-5 shrink-0" />
          {{ $t('nav.backToAdmin') }}
        </RouterLink>
      </div>
    </aside>

    <!-- Main content -->
    <div class="lg:pl-64 min-w-0 overflow-x-hidden">
      <!-- Top header -->
      <header class="sticky top-0 z-30 h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 gap-4">
        <!-- Mobile hamburger -->
        <button
          class="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          @click="sidebarOpen = !sidebarOpen"
        >
          <Menu v-if="!sidebarOpen" class="w-5 h-5" />
          <X v-else class="w-5 h-5" />
        </button>

        <!-- Account switcher -->
        <div class="relative">
          <button
            @click="accountMenuOpen = !accountMenuOpen"
            class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 transition-colors max-w-[120px] sm:max-w-[240px]"
          >
            <span class="truncate">{{ currentAccount?.name ?? $t('nav.selectAccount') }}</span>
            <ChevronDown class="w-4 h-4 shrink-0" />
          </button>

          <!-- Click-outside overlay -->
          <div v-if="accountMenuOpen" class="fixed inset-0 z-40" @click="accountMenuOpen = false" />

          <!-- Account dropdown -->
          <div
            v-if="accountMenuOpen"
            class="absolute left-0 mt-2 w-56 sm:w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50"
          >
            <div class="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {{ $t('nav.accounts') }}
            </div>
            <button
              v-for="account in accounts"
              :key="account.id"
              @click="handleSwitchAccount(account.id)"
              :class="[
                'flex items-center gap-2 w-full px-4 py-2 text-sm transition-colors',
                account.id === currentAccount?.id
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
              ]"
            >
              <div class="w-6 h-6 rounded bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-semibold">
                {{ account.name.charAt(0).toUpperCase() }}
              </div>
              {{ account.name }}
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2 ml-auto">
          <!-- Language selector -->
          <select
            :value="locale"
            @change="changeLocale(($event.target as HTMLSelectElement).value)"
            class="px-1 sm:px-2 py-1.5 rounded-lg text-xs sm:text-sm border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="en">EN</option>
            <option value="nb">NO</option>
            <option value="de">DE</option>
            <option value="zh">中文</option>
          </select>

          <!-- Theme toggle -->
          <button
            @click="toggle"
            class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            :title="`Theme: ${theme}`"
          >
            <Sun v-if="theme === 'light'" class="w-5 h-5" />
            <Moon v-else-if="theme === 'dark'" class="w-5 h-5" />
            <svg v-else class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none" />
            </svg>
          </button>

          <!-- Search trigger -->
          <button
            @click="commandPalette.open()"
            class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-xs"
          >
            <Search class="w-3.5 h-3.5" />
            <span class="hidden md:inline">{{ $t('common.search') }}</span>
            <kbd class="ml-1 px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-mono">{{ isMac ? '⌘' : 'Ctrl+' }}K</kbd>
          </button>

          <!-- Notifications -->
          <NotificationBell />

          <!-- User menu -->
          <div class="relative">
            <button
              @click="userMenuOpen = !userMenuOpen"
              class="flex items-center gap-2 p-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <div class="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center text-primary-700 dark:text-primary-300 text-sm font-semibold">
                {{ user?.name?.charAt(0)?.toUpperCase() ?? '?' }}
              </div>
              <ChevronDown class="w-4 h-4" />
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
                to="/panel/profile"
                class="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                @click="userMenuOpen = false"
              >
                <Users class="w-4 h-4" />
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

      <!-- Impersonation banner -->
      <div v-if="isImpersonating" class="bg-amber-500 text-white px-4 py-2 flex items-center justify-between text-sm">
        <div class="flex items-center gap-2">
          <ShieldAlert class="w-4 h-4" />
          <span>{{ $t('impersonation.youAreImpersonating') }} <strong>{{ currentAccount?.name ?? $t('impersonation.anAccount') }}</strong></span>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="overridesPanelOpen = !overridesPanelOpen"
            :class="[
              'flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors',
              overridesPanelOpen ? 'bg-white/30' : 'bg-white/20 hover:bg-white/30',
            ]"
          >
            <SlidersHorizontal class="w-3.5 h-3.5" />
            {{ $t('impersonation.adminOverrides') }}
          </button>
          <button
            @click="stopImpersonating"
            class="px-3 py-1 rounded bg-white/20 hover:bg-white/30 font-medium transition-colors"
          >
            {{ $t('impersonation.stopImpersonating') }}
          </button>
        </div>
      </div>

      <!-- Admin overrides panel (when impersonating) -->
      <AdminOverridesPanel v-if="isImpersonating && overridesPanelOpen && currentAccount?.id" :account-id="currentAccount.id" />

      <!-- Page content -->
      <main class="p-6">
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <div v-if="Component" :key="$route.path">
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
  background: conic-gradient(from var(--shimmer-angle) at var(--shimmer-x) 50%, #6d28d9, #8b5cf6, #9b7fe6, #8b5cf6, #6d28d9);
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
