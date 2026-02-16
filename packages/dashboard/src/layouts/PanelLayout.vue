<script setup lang="ts">
import { ref } from 'vue'
import { RouterView, RouterLink, useRoute } from 'vue-router'
import { useTheme } from '@/composables/useTheme'
import { useAuth } from '@/composables/useAuth'
import { useAccount } from '@/composables/useAccount'
import {
  LayoutDashboard,
  Layers,
  Rocket,
  Store,
  Globe,
  Terminal as TerminalIcon,
  HardDrive,
  Archive,
  Key,
  Users,
  UserPlus,
  CreditCard,
  Settings,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  ArrowLeft,
} from 'lucide-vue-next'

const route = useRoute()
const { theme, toggle } = useTheme()
const { user, isSuper, logout } = useAuth()
const { currentAccount, accounts, switchAccount } = useAccount()

const sidebarOpen = ref(false)
const userMenuOpen = ref(false)
const accountMenuOpen = ref(false)

const navItems = [
  { name: 'Dashboard', path: '/panel', icon: LayoutDashboard },
  { name: 'Services', path: '/panel/services', icon: Layers },
  { name: 'Deploy', path: '/panel/deploy', icon: Rocket },
  { name: 'Marketplace', path: '/panel/marketplace', icon: Store },
  { name: 'Domains', path: '/panel/domains', icon: Globe },
  { name: 'Terminal', path: '/panel/terminal', icon: TerminalIcon },
  { name: 'Storage', path: '/panel/storage', icon: HardDrive },
  { name: 'Backups', path: '/panel/backups', icon: Archive },
  { name: 'SSH Keys', path: '/panel/ssh', icon: Key },
  { name: 'Sub-Accounts', path: '/panel/sub-accounts', icon: UserPlus },
  { name: 'Users', path: '/panel/users', icon: Users },
  { name: 'Billing', path: '/panel/billing', icon: CreditCard },
  { name: 'Settings', path: '/panel/settings', icon: Settings },
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
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          :class="[
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
            isActive(item.path)
              ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
          ]"
          @click="sidebarOpen = false"
        >
          <component :is="item.icon" class="w-5 h-5 shrink-0" />
          {{ item.name }}
        </RouterLink>
      </nav>

      <!-- Back to Admin (for super users) -->
      <div v-if="isSuper" class="p-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
        <RouterLink
          to="/admin"
          class="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
        >
          <ArrowLeft class="w-5 h-5 shrink-0" />
          Back to Admin
        </RouterLink>
      </div>
    </aside>

    <!-- Main content -->
    <div class="lg:pl-64">
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
            class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 transition-colors"
          >
            <span>{{ currentAccount?.name ?? 'Select account' }}</span>
            <ChevronDown class="w-4 h-4" />
          </button>

          <!-- Account dropdown -->
          <div
            v-if="accountMenuOpen"
            class="absolute left-0 mt-2 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50"
          >
            <div class="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Accounts
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
          <!-- Theme toggle -->
          <button
            @click="toggle"
            class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            :title="`Theme: ${theme}`"
          >
            <Sun v-if="theme === 'light'" class="w-5 h-5" />
            <Moon v-else-if="theme === 'dark'" class="w-5 h-5" />
            <Monitor v-else class="w-5 h-5" />
          </button>

          <!-- User menu -->
          <div class="relative">
            <button
              @click="userMenuOpen = !userMenuOpen"
              class="flex items-center gap-2 p-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <div class="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center text-primary-700 dark:text-primary-300 text-sm font-semibold">
                {{ user?.name?.charAt(0)?.toUpperCase() ?? '?' }}
              </div>
              <span class="hidden sm:block text-sm font-medium">{{ user?.name ?? 'User' }}</span>
              <ChevronDown class="w-4 h-4" />
            </button>

            <!-- Dropdown -->
            <div
              v-if="userMenuOpen"
              class="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50"
              @click="userMenuOpen = false"
            >
              <div class="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ user?.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ user?.email }}</p>
              </div>
              <button
                @click="handleLogout"
                class="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <LogOut class="w-4 h-4" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <!-- Page content -->
      <main class="p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
