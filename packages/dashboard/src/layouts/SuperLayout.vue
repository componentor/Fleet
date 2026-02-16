<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterView, RouterLink, useRoute, useRouter } from 'vue-router'
import { useTheme } from '@/composables/useTheme'
import { useAuth } from '@/composables/useAuth'
import {
  LayoutDashboard,
  Server,
  Users,
  Store,
  Shield,
  Settings,
  CreditCard,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  Monitor,
  ScrollText,
  ChevronDown,
  Search,
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const { theme, toggle } = useTheme()
const { user, logout } = useAuth()

const sidebarOpen = ref(false)
const userMenuOpen = ref(false)

const navItems = [
  { name: 'Dashboard', path: '/admin', icon: LayoutDashboard },
  { name: 'Nodes', path: '/admin/nodes', icon: Server },
  { name: 'Accounts', path: '/admin/accounts', icon: Users },
  { name: 'Users', path: '/admin/users', icon: Users },
  { name: 'Marketplace', path: '/admin/marketplace', icon: Store },
  { name: 'Audit Log', path: '/admin/audit-log', icon: ScrollText },
  { name: 'Settings', path: '/admin/settings', icon: Settings },
  { name: 'Billing', path: '/admin/billing', icon: CreditCard },
]

function isActive(path: string) {
  if (path === '/admin') {
    return route.path === '/admin'
  }
  return route.path.startsWith(path)
}

async function handleLogout() {
  userMenuOpen.value = false
  await logout()
}

function goToPanel() {
  router.push('/panel')
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
        'fixed inset-y-0 left-0 z-50 w-64 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-200 lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      ]"
    >
      <div class="flex items-center justify-between h-16 px-6 border-b border-gray-200 dark:border-gray-700">
        <RouterLink to="/admin" class="text-xl font-bold text-primary-600 dark:text-primary-400">
          Hoster
        </RouterLink>
        <span class="text-xs font-medium bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 px-2 py-0.5 rounded-full">
          Admin
        </span>
      </div>

      <nav class="mt-4 px-3 space-y-1">
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

      <!-- Switch to panel -->
      <div class="absolute bottom-4 left-3 right-3">
        <button
          @click="goToPanel"
          class="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <Shield class="w-5 h-5 shrink-0" />
          Switch to Panel
        </button>
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

        <!-- Search -->
        <div class="flex-1 max-w-md">
          <div class="relative">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              class="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
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
