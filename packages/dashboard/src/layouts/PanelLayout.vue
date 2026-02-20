<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterView, RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'
import { useAuth } from '@/composables/useAuth'
import { useAccount } from '@/composables/useAccount'
import { useRole } from '@/composables/useRole'
import { useAuthStore } from '@/stores/auth'
import {
  LayoutDashboard,
  Layers,
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
  Settings,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  ChevronDown,
  ArrowLeft,
  ShieldAlert,
  Languages,
  Search,
} from 'lucide-vue-next'
import NotificationBell from '@/components/NotificationBell.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import { useCommandPalette } from '@/composables/useCommandPalette'

const commandPalette = useCommandPalette()

const { t, locale } = useI18n()
const route = useRoute()
const isMac = typeof globalThis.navigator !== 'undefined' && globalThis.navigator.platform?.includes('Mac')
const { theme, toggle } = useTheme()
const { user, isSuper, logout } = useAuth()
const { currentAccount, accounts, switchAccount } = useAccount()
const { canAdmin, canOwner } = useRole()

const isImpersonating = computed(() => !!sessionStorage.getItem('fleet_impersonating'))

function stopImpersonating() {
  const originalToken = sessionStorage.getItem('fleet_original_token')
  const originalAccountId = sessionStorage.getItem('fleet_original_account_id')
  if (originalToken) {
    // Restore original access token in-memory via auth store
    const authStore = useAuthStore()
    authStore.setToken(originalToken)
  }
  if (originalAccountId) localStorage.setItem('fleet_account_id', originalAccountId)
  else localStorage.removeItem('fleet_account_id')
  sessionStorage.removeItem('fleet_original_token')
  sessionStorage.removeItem('fleet_original_account_id')
  sessionStorage.removeItem('fleet_impersonating')
  window.location.href = '/admin/accounts'
}

const sidebarOpen = ref(false)
const userMenuOpen = ref(false)
const accountMenuOpen = ref(false)

const navItems = [
  { nameKey: 'nav.dashboard', path: '/panel', icon: LayoutDashboard },
  { nameKey: 'nav.services', path: '/panel/services', icon: Box },
  { nameKey: 'nav.stacks', path: '/panel/stacks', icon: Layers },
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
        <RouterLink to="/panel" class="text-xl font-bold text-primary-600 dark:text-primary-400">
          Fleet
        </RouterLink>
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
          <ArrowLeft class="w-5 h-5 shrink-0" />
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
        <button
          @click="stopImpersonating"
          class="px-3 py-1 rounded bg-white/20 hover:bg-white/30 font-medium transition-colors"
        >
          {{ $t('impersonation.stopImpersonating') }}
        </button>
      </div>

      <!-- Page content -->
      <main class="p-6">
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
    </div>

    <!-- Command Palette -->
    <CommandPalette />
  </div>
</template>
