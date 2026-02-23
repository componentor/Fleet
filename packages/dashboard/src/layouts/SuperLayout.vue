<script setup lang="ts">
import { ref, onMounted } from 'vue'
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
} from 'lucide-vue-next'
import NotificationBell from '@/components/NotificationBell.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import { useCommandPalette } from '@/composables/useCommandPalette'
import { useBranding } from '@/composables/useBranding'
import { versionInfo, updateVersion } from '@/composables/useVersionInfo'

const commandPalette = useCommandPalette()
const { brandTitle, logoSrc } = useBranding()
const api = useApi()

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const isMac = typeof globalThis.navigator !== 'undefined' && globalThis.navigator.platform?.includes('Mac')
const { theme, toggle } = useTheme()
const { user, logout } = useAuth()

const sidebarOpen = ref(false)
const userMenuOpen = ref(false)

onMounted(async () => {
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

const navItems = [
  { nameKey: 'nav.dashboard', path: '/admin', icon: LayoutDashboard },
  { nameKey: 'nav.nodes', path: '/admin/nodes', icon: Server },
  { nameKey: 'nav.accounts', path: '/admin/accounts', icon: Users },
  { nameKey: 'nav.users', path: '/admin/users', icon: Users },
  { nameKey: 'nav.marketplace', path: '/admin/marketplace', icon: Store },
  { nameKey: 'nav.status', path: '/admin/status', icon: Activity },
  { nameKey: 'nav.events', path: '/admin/events', icon: ScrollText },
  { nameKey: 'nav.settings', path: '/admin/settings', icon: Settings },
  { nameKey: 'nav.billing', path: '/admin/billing', icon: CreditCard },
  { nameKey: 'nav.errors', path: '/admin/errors', icon: Bug },
  { nameKey: 'nav.services', path: '/admin/services', icon: Layers },
  { nameKey: 'nav.storage', path: '/admin/storage', icon: HardDrive },
  { nameKey: 'nav.updates', path: '/admin/updates', icon: Download },
  { nameKey: 'nav.emailTemplates', path: '/admin/email-templates', icon: Mail },
  { nameKey: 'nav.sharedDomains', path: '/admin/shared-domains', icon: Globe },
  { nameKey: 'nav.resellers', path: '/admin/resellers', icon: Handshake },
  { nameKey: 'nav.jobs', path: '/admin/jobs', icon: ListFilter },
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
        <RouterLink to="/admin" class="flex items-center gap-2">
          <img v-if="logoSrc()" :src="logoSrc()!" :alt="brandTitle" class="h-8 w-auto max-w-[140px] object-contain" />
          <span class="text-xl font-bold text-primary-600 dark:text-primary-400">{{ brandTitle }}</span>
        </RouterLink>
        <span class="text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">
          {{ $t('nav.admin') }}
        </span>
      </div>

      <nav class="mt-4 px-3 space-y-1 overflow-y-auto flex-1">
        <RouterLink
          v-for="item in navItems"
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

      <!-- Version badge -->
      <div v-if="versionInfo" class="px-4 py-2 border-t border-gray-200 dark:border-gray-700 shrink-0">
        <RouterLink
          to="/admin/updates"
          class="flex items-center gap-2 text-xs transition-colors rounded-md px-2 py-1.5 -mx-1"
          :class="versionInfo.updateAvailable
            ? 'text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'"
        >
          <ArrowUpCircle v-if="versionInfo.updateAvailable" class="w-3.5 h-3.5 shrink-0" />
          <span class="font-mono">v{{ versionInfo.current }}</span>
          <span v-if="versionInfo.updateAvailable" class="font-medium ml-auto">{{ versionInfo.latest }} available</span>
        </RouterLink>
      </div>

      <!-- Switch to panel -->
      <div class="p-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
        <button
          @click="goToPanel"
          class="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <Shield class="w-5 h-5 shrink-0" />
          {{ $t('nav.switchToPanel') }}
        </button>
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

        <!-- Search trigger -->
        <div class="hidden sm:block flex-1 max-w-md">
          <button
            @click="commandPalette.open()"
            class="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
          >
            <Search class="w-4 h-4" />
            <span class="flex-1 text-left">{{ $t('common.search') }}</span>
            <kbd class="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-600 rounded text-[10px] font-mono">{{ isMac ? '⌘' : 'Ctrl+' }}K</kbd>
          </button>
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
