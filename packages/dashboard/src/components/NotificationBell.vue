<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Bell } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const api = useApi()
const unreadCount = ref(0)
const notifications = ref<any[]>([])
const showDropdown = ref(false)
const loading = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

async function fetchUnreadCount() {
  try {
    const data = await api.get<{ count: number }>('/notifications/unread-count')
    unreadCount.value = data.count
  } catch {}
}

async function fetchNotifications() {
  loading.value = true
  try {
    const data = await api.get<any[]>('/notifications?limit=10')
    notifications.value = data
  } catch {}
  loading.value = false
}

function toggleDropdown() {
  showDropdown.value = !showDropdown.value
  if (showDropdown.value) fetchNotifications()
}

async function markAsRead(id: string) {
  await api.patch(`/notifications/${id}/read`, {})
  const n = notifications.value.find(n => n.id === id)
  if (n) n.read = true
  unreadCount.value = Math.max(0, unreadCount.value - 1)
}

async function markAllRead() {
  await api.post('/notifications/mark-all-read', {})
  notifications.value.forEach(n => n.read = true)
  unreadCount.value = 0
}

onMounted(() => {
  fetchUnreadCount()
  pollTimer = setInterval(fetchUnreadCount, 30_000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="relative">
    <button @click="toggleDropdown" class="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
      <Bell class="w-5 h-5 text-gray-600 dark:text-gray-300" />
      <span v-if="unreadCount > 0" class="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
        {{ unreadCount > 99 ? '99+' : unreadCount }}
      </span>
    </button>

    <!-- Dropdown -->
    <div v-if="showDropdown" class="absolute right-0 top-full mt-2 w-80 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg z-50">
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('notifications.title') }}</span>
        <button v-if="unreadCount > 0" @click="markAllRead" class="text-xs text-blue-600 dark:text-blue-400 hover:underline">
          {{ $t('notifications.markAllRead') }}
        </button>
      </div>
      <div class="max-h-80 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
        <div v-if="loading" class="px-4 py-6 text-center text-sm text-gray-500">{{ $t('notifications.loading') }}</div>
        <div v-else-if="notifications.length === 0" class="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">{{ $t('notifications.noNotifications') }}</div>
        <div
          v-for="n in notifications"
          :key="n.id"
          @click="!n.read && markAsRead(n.id)"
          class="px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          :class="{ 'bg-blue-50/50 dark:bg-blue-900/10': !n.read }"
        >
          <div class="flex items-start gap-2">
            <span v-if="!n.read" class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500"></span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ n.title }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ n.message }}</p>
              <p class="text-[10px] text-gray-400 mt-1">{{ new Date(n.createdAt).toLocaleString() }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Click-outside overlay -->
    <div v-if="showDropdown" class="fixed inset-0 z-40" @click="showDropdown = false"></div>
  </div>
</template>
