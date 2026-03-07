<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  AlertTriangle,
  Lock,
  Unlock,
  Eye,
  Globe,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
  Key,
  Ban,
  Activity,
  Search,
  X,
} from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const api = useApi()

const loading = ref(true)
const refreshing = ref(false)
const overview = ref<any>(null)
const hours = ref(24)
const activeTab = ref<'overview' | 'events' | 'investigate'>('overview')

// Events tab state
const events = ref<any[]>([])
const eventsLoading = ref(false)
const eventsPage = ref(1)
const eventsTotalPages = ref(1)
const eventsTotal = ref(0)
const filterType = ref('')
const filterIp = ref('')
const filterEmail = ref('')

// Investigate tab state
const investigateIp = ref('')
const ipDetail = ref<any>(null)
const ipLoading = ref(false)

// Expanded high-risk event
const expandedEvent = ref<string | null>(null)

const threatColors: Record<string, { bg: string; text: string; border: string; icon: any }> = {
  low: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/30', icon: ShieldCheck },
  medium: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/30', icon: Shield },
  high: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/30', icon: ShieldAlert },
  critical: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', icon: ShieldX },
}

const defaultThreat = { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/30', icon: ShieldCheck }

const currentThreat = computed(() => {
  const level = overview.value?.threatLevel ?? 'low'
  return threatColors[level] ?? defaultThreat
})

const timelineData = computed(() => {
  if (!overview.value?.timeline?.length) return []
  return overview.value.timeline.map((t: any) => ({
    hour: new Date(t.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    failedLogins: Number(t.failedLogins ?? 0),
    permissionDenied: Number(t.permissionDenied ?? 0),
    twoFaFailed: Number(t.twoFaFailed ?? 0),
  }))
})

const timelineMax = computed(() => {
  if (!timelineData.value.length) return 1
  return Math.max(1, ...timelineData.value.map((t: any) => t.failedLogins + t.permissionDenied + t.twoFaFailed))
})

const hasActiveThreats = computed(() => {
  if (!overview.value?.threats) return false
  const { bruteForceIps, multiIpFailures, rapidFireIps } = overview.value.threats
  return (bruteForceIps?.length > 0) || (multiIpFailures?.length > 0) || (rapidFireIps?.length > 0)
})

const eventTypeLabels: Record<string, { label: string; color: string }> = {
  'auth.login_failed': { label: 'Failed Login', color: 'text-red-400' },
  'auth.2fa_failed': { label: '2FA Failed', color: 'text-orange-400' },
  'auth.region_blocked': { label: 'Region Blocked', color: 'text-yellow-400' },
  'auth.brute_force_detected': { label: 'Brute Force', color: 'text-red-500' },
  'security.permission_denied': { label: 'Permission Denied', color: 'text-orange-400' },
  'security.admin_permission_denied': { label: 'Admin Denied', color: 'text-red-400' },
  'user.super_toggled': { label: 'Super Toggle', color: 'text-purple-400' },
  'account.impersonated': { label: 'Impersonation', color: 'text-blue-400' },
  'account.suspended': { label: 'Account Suspended', color: 'text-yellow-400' },
  'account.deleted': { label: 'Account Deleted', color: 'text-red-400' },
  'account.deletion_scheduled': { label: 'Deletion Scheduled', color: 'text-orange-400' },
  'admin_role.created': { label: 'Role Created', color: 'text-blue-400' },
  'admin_role.updated': { label: 'Role Updated', color: 'text-blue-400' },
  'admin_role.deleted': { label: 'Role Deleted', color: 'text-red-400' },
  'admin_role.assigned': { label: 'Role Assigned', color: 'text-green-400' },
  'admin_role.removed': { label: 'Role Removed', color: 'text-orange-400' },
  'api_key.created': { label: 'API Key Created', color: 'text-blue-400' },
  'api_key.revoked': { label: 'API Key Revoked', color: 'text-orange-400' },
  'settings.updated': { label: 'Settings Changed', color: 'text-yellow-400' },
  'user.settings_changed': { label: 'User Settings', color: 'text-yellow-400' },
}

function getEventLabel(type: string) {
  return eventTypeLabels[type] ?? { label: type, color: 'text-zinc-400' }
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

async function fetchOverview() {
  try {
    overview.value = await api.get<any>(`/admin/security/overview?hours=${hours.value}`)
  } catch (e) {
    console.error('Failed to fetch security overview', e)
  }
}

async function fetchEvents() {
  eventsLoading.value = true
  try {
    const params = new URLSearchParams({
      page: String(eventsPage.value),
      limit: '50',
      hours: String(Math.min(hours.value * 3, 720)),
    })
    if (filterType.value) params.set('type', filterType.value)
    if (filterIp.value) params.set('ip', filterIp.value)
    if (filterEmail.value) params.set('email', filterEmail.value)
    const res = await api.get<any>(`/admin/security/events?${params}`)
    events.value = res.data ?? []
    eventsTotalPages.value = res.pagination?.totalPages ?? 1
    eventsTotal.value = res.pagination?.total ?? 0
  } catch (e) {
    console.error('Failed to fetch security events', e)
  } finally {
    eventsLoading.value = false
  }
}

async function investigateIpAddress(ip?: string) {
  const target = ip ?? investigateIp.value
  if (!target) return
  investigateIp.value = target
  activeTab.value = 'investigate'
  ipLoading.value = true
  try {
    ipDetail.value = await api.get<any>(`/admin/security/ip/${encodeURIComponent(target)}?hours=72`)
  } catch (e) {
    console.error('Failed to investigate IP', e)
  } finally {
    ipLoading.value = false
  }
}

async function refresh() {
  refreshing.value = true
  await fetchOverview()
  if (activeTab.value === 'events') await fetchEvents()
  refreshing.value = false
}

const previousThreatLevel = ref<string>('low')

function checkThreatEscalation() {
  const current = overview.value?.threatLevel ?? 'low'
  const prev = previousThreatLevel.value
  const levels = ['low', 'medium', 'high', 'critical']
  const currentIdx = levels.indexOf(current)
  const prevIdx = levels.indexOf(prev)

  if (currentIdx > prevIdx && currentIdx >= 2) {
    // Threat escalated to high or critical — show browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(current === 'critical' ? 'CRITICAL Security Alert' : 'Security Alert', {
        body: current === 'critical'
          ? 'Multiple active attacks detected — check Security Monitor immediately.'
          : 'Elevated threat activity detected — brute force or rapid-fire attacks in progress.',
        icon: '/favicon.ico',
        tag: 'fleet-security-alert',
      })
    }
  }
  previousThreatLevel.value = current
}

async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission()
  }
}

let autoRefresh: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  loading.value = true
  requestNotificationPermission()
  await fetchOverview()
  checkThreatEscalation()
  loading.value = false
  autoRefresh = setInterval(async () => {
    await fetchOverview()
    checkThreatEscalation()
  }, 60000)
})

onUnmounted(() => {
  if (autoRefresh) clearInterval(autoRefresh)
})

function switchTab(tab: 'overview' | 'events' | 'investigate') {
  activeTab.value = tab
  if (tab === 'events' && events.value.length === 0) fetchEvents()
}
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 py-8">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-lg" :class="currentThreat.bg">
          <component :is="currentThreat.icon" class="w-6 h-6" :class="currentThreat.text" />
        </div>
        <div>
          <h1 class="text-2xl font-bold text-zinc-100">{{ t('security.title') }}</h1>
          <p class="text-sm text-zinc-500">{{ t('security.subtitle') }}</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <select
          v-model="hours"
          @change="refresh()"
          class="bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-1.5 text-sm focus:ring-blue-500 focus:border-blue-500"
        >
          <option :value="1">1h</option>
          <option :value="6">6h</option>
          <option :value="24">24h</option>
          <option :value="72">3d</option>
          <option :value="168">7d</option>
        </select>
        <button
          @click="refresh()"
          :disabled="refreshing"
          class="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors disabled:opacity-50"
        >
          <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': refreshing }" />
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-24">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
    </div>

    <template v-else-if="overview">
      <!-- Threat Level Banner -->
      <div
        class="mb-6 rounded-xl border p-4 flex items-center gap-4"
        :class="[currentThreat.bg, currentThreat.border]"
      >
        <component :is="currentThreat.icon" class="w-8 h-8 flex-shrink-0" :class="currentThreat.text" />
        <div>
          <div class="font-semibold text-zinc-100">
            {{ t('security.threatLevel') }}: <span :class="currentThreat.text" class="uppercase">{{ overview.threatLevel }}</span>
          </div>
          <div class="text-sm text-zinc-400" v-if="overview.threatLevel === 'low'">{{ t('security.threatLow') }}</div>
          <div class="text-sm text-zinc-400" v-else-if="overview.threatLevel === 'medium'">{{ t('security.threatMedium') }}</div>
          <div class="text-sm text-zinc-400" v-else-if="overview.threatLevel === 'high'">{{ t('security.threatHigh') }}</div>
          <div class="text-sm text-zinc-400" v-else>{{ t('security.threatCritical') }}</div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex gap-1 mb-6 border-b border-zinc-800">
        <button
          v-for="tab in (['overview', 'events', 'investigate'] as const)"
          :key="tab"
          @click="switchTab(tab)"
          class="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
          :class="activeTab === tab
            ? 'border-blue-500 text-blue-400'
            : 'border-transparent text-zinc-500 hover:text-zinc-300'"
        >
          {{ t(`security.tab.${tab}`) }}
        </button>
      </div>

      <!-- Overview Tab -->
      <div v-if="activeTab === 'overview'">
        <!-- Summary Cards -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div class="flex items-center gap-2 text-zinc-500 text-xs font-medium mb-2">
              <Lock class="w-3.5 h-3.5" />
              {{ t('security.failedLogins') }}
            </div>
            <div class="text-2xl font-bold" :class="(overview.summary?.failedLogins ?? 0) > 0 ? 'text-red-400' : 'text-zinc-100'">
              {{ overview.summary?.failedLogins ?? 0 }}
            </div>
          </div>
          <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div class="flex items-center gap-2 text-zinc-500 text-xs font-medium mb-2">
              <Ban class="w-3.5 h-3.5" />
              {{ t('security.permissionDenied') }}
            </div>
            <div class="text-2xl font-bold" :class="(overview.summary?.permissionDenied ?? 0) > 0 ? 'text-orange-400' : 'text-zinc-100'">
              {{ overview.summary?.permissionDenied ?? 0 }}
            </div>
          </div>
          <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div class="flex items-center gap-2 text-zinc-500 text-xs font-medium mb-2">
              <Key class="w-3.5 h-3.5" />
              {{ t('security.twoFaFailed') }}
            </div>
            <div class="text-2xl font-bold" :class="(overview.summary?.twoFaFailed ?? 0) > 0 ? 'text-orange-400' : 'text-zinc-100'">
              {{ overview.summary?.twoFaFailed ?? 0 }}
            </div>
          </div>
          <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div class="flex items-center gap-2 text-zinc-500 text-xs font-medium mb-2">
              <Globe class="w-3.5 h-3.5" />
              {{ t('security.regionBlocked') }}
            </div>
            <div class="text-2xl font-bold" :class="(overview.summary?.regionBlocked ?? 0) > 0 ? 'text-yellow-400' : 'text-zinc-100'">
              {{ overview.summary?.regionBlocked ?? 0 }}
            </div>
          </div>
          <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div class="flex items-center gap-2 text-zinc-500 text-xs font-medium mb-2">
              <AlertTriangle class="w-3.5 h-3.5" />
              {{ t('security.highRiskActions') }}
            </div>
            <div class="text-2xl font-bold text-zinc-100">
              {{ overview.summary?.highRiskActions ?? 0 }}
            </div>
          </div>
        </div>

        <!-- Active Threats -->
        <div v-if="hasActiveThreats" class="mb-6">
          <h2 class="text-lg font-semibold text-zinc-100 mb-3 flex items-center gap-2">
            <ShieldAlert class="w-5 h-5 text-red-400" />
            {{ t('security.activeThreats') }}
          </h2>
          <div class="space-y-3">
            <!-- Brute Force IPs -->
            <div
              v-for="ip in overview.threats?.bruteForceIps ?? []"
              :key="'bf-' + ip.ipAddress"
              class="bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex items-center justify-between"
            >
              <div class="flex items-center gap-3">
                <ShieldX class="w-5 h-5 text-red-400 flex-shrink-0" />
                <div>
                  <span class="text-zinc-200 font-medium">{{ ip.ipAddress ?? 'Unknown IP' }}</span>
                  <span class="text-red-400 text-sm ml-2">{{ ip.count }} {{ t('security.failedAttemptsLastHour') }}</span>
                </div>
              </div>
              <button
                @click="investigateIpAddress(ip.ipAddress)"
                class="text-xs px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
              >
                {{ t('security.investigate') }}
              </button>
            </div>

            <!-- Rapid Fire -->
            <div
              v-for="ip in overview.threats?.rapidFireIps ?? []"
              :key="'rf-' + ip.ipAddress"
              class="bg-orange-500/5 border border-orange-500/20 rounded-xl p-4 flex items-center justify-between"
            >
              <div class="flex items-center gap-3">
                <Activity class="w-5 h-5 text-orange-400 flex-shrink-0" />
                <div>
                  <span class="text-zinc-200 font-medium">{{ ip.ipAddress ?? 'Unknown IP' }}</span>
                  <span class="text-orange-400 text-sm ml-2">{{ ip.count }} {{ t('security.attemptsLast5Min') }}</span>
                </div>
              </div>
              <button
                @click="investigateIpAddress(ip.ipAddress)"
                class="text-xs px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
              >
                {{ t('security.investigate') }}
              </button>
            </div>

            <!-- Multi-IP Failures (credential stuffing) -->
            <div
              v-for="entry in overview.threats?.multiIpFailures ?? []"
              :key="'mi-' + entry.email"
              class="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 flex items-center gap-3"
            >
              <Unlock class="w-5 h-5 text-yellow-400 flex-shrink-0" />
              <div>
                <span class="text-zinc-200 font-medium">{{ entry.email ?? 'Unknown' }}</span>
                <span class="text-yellow-400 text-sm ml-2">
                  {{ entry.attempts }} {{ t('security.attemptsFrom') }} {{ entry.ipCount }} {{ t('security.differentIps') }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Timeline Chart -->
        <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-5 mb-6" v-if="timelineData.length > 1">
          <h3 class="text-sm font-medium text-zinc-400 mb-4">{{ t('security.eventTimeline') }}</h3>
          <div class="flex items-end gap-px h-32">
            <div
              v-for="(bar, i) in timelineData"
              :key="i"
              class="flex-1 flex flex-col justify-end group relative"
            >
              <div
                class="bg-red-500/60 rounded-t-sm transition-all hover:bg-red-500/80 cursor-pointer"
                :style="{ height: `${Math.max(1, (bar.failedLogins / timelineMax) * 100)}%`, minHeight: bar.failedLogins > 0 ? '3px' : '0' }"
              />
              <div
                class="bg-orange-500/60 rounded-t-sm"
                :style="{ height: `${Math.max(0, (bar.permissionDenied / timelineMax) * 100)}%`, minHeight: bar.permissionDenied > 0 ? '2px' : '0' }"
              />
              <div
                class="bg-yellow-500/60 rounded-t-sm"
                :style="{ height: `${Math.max(0, (bar.twoFaFailed / timelineMax) * 100)}%`, minHeight: bar.twoFaFailed > 0 ? '2px' : '0' }"
              />
              <!-- Tooltip -->
              <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                <div class="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-xl">
                  <div class="text-zinc-300 font-medium mb-1">{{ bar.hour }}</div>
                  <div class="text-red-400" v-if="bar.failedLogins">Failed logins: {{ bar.failedLogins }}</div>
                  <div class="text-orange-400" v-if="bar.permissionDenied">Perm denied: {{ bar.permissionDenied }}</div>
                  <div class="text-yellow-400" v-if="bar.twoFaFailed">2FA failed: {{ bar.twoFaFailed }}</div>
                </div>
              </div>
            </div>
          </div>
          <!-- Legend -->
          <div class="flex gap-4 mt-3 text-xs text-zinc-500">
            <div class="flex items-center gap-1"><div class="w-2.5 h-2.5 rounded-sm bg-red-500/60" /> {{ t('security.failedLogins') }}</div>
            <div class="flex items-center gap-1"><div class="w-2.5 h-2.5 rounded-sm bg-orange-500/60" /> {{ t('security.permissionDenied') }}</div>
            <div class="flex items-center gap-1"><div class="w-2.5 h-2.5 rounded-sm bg-yellow-500/60" /> {{ t('security.twoFaFailed') }}</div>
          </div>
        </div>

        <!-- Two-column: Top IPs + Top Emails -->
        <div class="grid md:grid-cols-2 gap-6 mb-6">
          <!-- Top Offending IPs -->
          <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
            <h3 class="text-sm font-medium text-zinc-400 mb-3">{{ t('security.topOffendingIps') }}</h3>
            <div v-if="!overview.failedLoginsByIp?.length" class="text-sm text-zinc-600 py-4 text-center">
              {{ t('security.noData') }}
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="entry in overview.failedLoginsByIp.slice(0, 10)"
                :key="entry.ipAddress"
                class="flex items-center justify-between group"
              >
                <button
                  @click="investigateIpAddress(entry.ipAddress)"
                  class="text-sm text-zinc-300 hover:text-blue-400 transition-colors font-mono"
                >
                  {{ entry.ipAddress ?? 'Unknown' }}
                </button>
                <span class="text-sm font-medium" :class="entry.count >= 10 ? 'text-red-400' : entry.count >= 5 ? 'text-orange-400' : 'text-zinc-400'">
                  {{ entry.count }}
                </span>
              </div>
            </div>
          </div>

          <!-- Top Targeted Accounts -->
          <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
            <h3 class="text-sm font-medium text-zinc-400 mb-3">{{ t('security.topTargetedAccounts') }}</h3>
            <div v-if="!overview.failedLoginsByEmail?.length" class="text-sm text-zinc-600 py-4 text-center">
              {{ t('security.noData') }}
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="entry in overview.failedLoginsByEmail.slice(0, 10)"
                :key="entry.email"
                class="flex items-center justify-between"
              >
                <span class="text-sm text-zinc-300 truncate mr-4">{{ entry.email }}</span>
                <span class="text-sm font-medium" :class="entry.count >= 10 ? 'text-red-400' : entry.count >= 5 ? 'text-orange-400' : 'text-zinc-400'">
                  {{ entry.count }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- High-Risk Events -->
        <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <h3 class="text-sm font-medium text-zinc-400 mb-3">{{ t('security.recentHighRisk') }}</h3>
          <div v-if="!overview.highRiskEvents?.length" class="text-sm text-zinc-600 py-4 text-center">
            {{ t('security.noHighRiskEvents') }}
          </div>
          <div v-else class="space-y-1">
            <div
              v-for="evt in overview.highRiskEvents.slice(0, 20)"
              :key="evt.id"
              class="rounded-lg hover:bg-zinc-800/50 transition-colors"
            >
              <button
                @click="expandedEvent = expandedEvent === evt.id ? null : evt.id"
                class="w-full flex items-center gap-3 px-3 py-2 text-left"
              >
                <component :is="expandedEvent === evt.id ? ChevronDown : ChevronRight" class="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
                <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="getEventLabel(evt.eventType).color + ' bg-zinc-800'">
                  {{ getEventLabel(evt.eventType).label }}
                </span>
                <span class="text-sm text-zinc-300 truncate flex-1">{{ evt.description }}</span>
                <span class="text-xs text-zinc-600 flex-shrink-0">{{ timeAgo(evt.createdAt) }}</span>
              </button>
              <div v-if="expandedEvent === evt.id" class="px-10 pb-3 text-xs space-y-1">
                <div class="text-zinc-500">
                  <span class="text-zinc-600">Actor:</span> {{ evt.actorEmail ?? 'System' }}
                </div>
                <div class="text-zinc-500">
                  <span class="text-zinc-600">IP:</span>
                  <button v-if="evt.ipAddress" @click="investigateIpAddress(evt.ipAddress)" class="text-blue-400 hover:underline ml-1">{{ evt.ipAddress }}</button>
                  <span v-else class="ml-1">N/A</span>
                </div>
                <div class="text-zinc-500" v-if="evt.resourceType">
                  <span class="text-zinc-600">Resource:</span> {{ evt.resourceType }} {{ evt.resourceId ? `(${evt.resourceId.slice(0,8)}...)` : '' }}
                </div>
                <div class="text-zinc-500" v-if="evt.details && Object.keys(evt.details).length > 0">
                  <span class="text-zinc-600">Details:</span>
                  <code class="ml-1 text-zinc-400">{{ JSON.stringify(evt.details) }}</code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Events Tab -->
      <div v-else-if="activeTab === 'events'">
        <!-- Filters -->
        <div class="flex flex-wrap gap-3 mb-4">
          <select
            v-model="filterType"
            @change="eventsPage = 1; fetchEvents()"
            class="bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">All security events</option>
            <option value="auth.login_failed">Failed Logins</option>
            <option value="auth.2fa_failed">2FA Failed</option>
            <option value="auth.region_blocked">Region Blocked</option>
            <option value="security.permission_denied">Permission Denied</option>
            <option value="security.admin_permission_denied">Admin Permission Denied</option>
            <option value="user.super_toggled">Super Admin Toggle</option>
            <option value="account.impersonated">Impersonation</option>
            <option value="account.suspended">Account Suspended</option>
            <option value="account.deleted">Account Deleted</option>
            <option value="api_key.">API Key Events</option>
            <option value="admin_role.">Admin Role Changes</option>
            <option value="settings.">Settings Changes</option>
          </select>
          <div class="relative">
            <input
              v-model="filterIp"
              @keyup.enter="eventsPage = 1; fetchEvents()"
              type="text"
              placeholder="Filter by IP..."
              class="bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-1.5 text-sm pl-8 w-48"
            />
            <Globe class="w-3.5 h-3.5 text-zinc-600 absolute left-2.5 top-1/2 -translate-y-1/2" />
          </div>
          <div class="relative">
            <input
              v-model="filterEmail"
              @keyup.enter="eventsPage = 1; fetchEvents()"
              type="text"
              placeholder="Filter by email..."
              class="bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-1.5 text-sm pl-8 w-48"
            />
            <User class="w-3.5 h-3.5 text-zinc-600 absolute left-2.5 top-1/2 -translate-y-1/2" />
          </div>
          <button
            @click="eventsPage = 1; fetchEvents()"
            class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors"
          >
            <Search class="w-3.5 h-3.5" />
          </button>
          <button
            v-if="filterType || filterIp || filterEmail"
            @click="filterType = ''; filterIp = ''; filterEmail = ''; eventsPage = 1; fetchEvents()"
            class="px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-lg text-sm transition-colors"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- Events Table -->
        <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <div v-if="eventsLoading" class="flex items-center justify-center py-12">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
          </div>
          <table v-else-if="events.length" class="w-full text-sm">
            <thead>
              <tr class="border-b border-zinc-800 text-zinc-500 text-xs">
                <th class="text-left px-4 py-3 font-medium">{{ t('security.eventType') }}</th>
                <th class="text-left px-4 py-3 font-medium">{{ t('security.description') }}</th>
                <th class="text-left px-4 py-3 font-medium">{{ t('security.actor') }}</th>
                <th class="text-left px-4 py-3 font-medium">IP</th>
                <th class="text-left px-4 py-3 font-medium">{{ t('security.time') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="evt in events"
                :key="evt.id"
                class="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
              >
                <td class="px-4 py-2.5">
                  <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="getEventLabel(evt.eventType).color + ' bg-zinc-800'">
                    {{ getEventLabel(evt.eventType).label }}
                  </span>
                </td>
                <td class="px-4 py-2.5 text-zinc-300 max-w-xs truncate">{{ evt.description }}</td>
                <td class="px-4 py-2.5 text-zinc-400 text-xs">{{ evt.actorEmail ?? '-' }}</td>
                <td class="px-4 py-2.5">
                  <button
                    v-if="evt.ipAddress"
                    @click="investigateIpAddress(evt.ipAddress)"
                    class="text-xs font-mono text-zinc-400 hover:text-blue-400 transition-colors"
                  >
                    {{ evt.ipAddress }}
                  </button>
                  <span v-else class="text-zinc-600 text-xs">-</span>
                </td>
                <td class="px-4 py-2.5 text-zinc-500 text-xs whitespace-nowrap">{{ timeAgo(evt.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="text-center py-12 text-zinc-600 text-sm">{{ t('security.noEvents') }}</div>
        </div>

        <!-- Pagination -->
        <div v-if="eventsTotalPages > 1" class="flex items-center justify-between mt-4 text-sm">
          <span class="text-zinc-500">{{ eventsTotal }} {{ t('security.totalEvents') }}</span>
          <div class="flex gap-2">
            <button
              :disabled="eventsPage <= 1"
              @click="eventsPage--; fetchEvents()"
              class="px-3 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 disabled:opacity-30 hover:text-zinc-200 transition-colors"
            >
              {{ t('security.prev') }}
            </button>
            <span class="px-3 py-1 text-zinc-500">{{ eventsPage }} / {{ eventsTotalPages }}</span>
            <button
              :disabled="eventsPage >= eventsTotalPages"
              @click="eventsPage++; fetchEvents()"
              class="px-3 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 disabled:opacity-30 hover:text-zinc-200 transition-colors"
            >
              {{ t('security.next') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Investigate Tab -->
      <div v-else-if="activeTab === 'investigate'">
        <!-- IP Search -->
        <div class="flex gap-3 mb-6">
          <div class="relative flex-1">
            <input
              v-model="investigateIp"
              @keyup.enter="investigateIpAddress()"
              type="text"
              placeholder="Enter IP address to investigate..."
              class="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-4 py-2.5 text-sm pl-10"
            />
            <Search class="w-4 h-4 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
          </div>
          <button
            @click="investigateIpAddress()"
            :disabled="!investigateIp"
            class="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {{ t('security.investigate') }}
          </button>
        </div>

        <div v-if="ipLoading" class="flex items-center justify-center py-12">
          <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
        </div>

        <template v-else-if="ipDetail">
          <!-- IP Summary -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div class="text-xs text-zinc-500 mb-1">{{ t('security.totalEvents') }}</div>
              <div class="text-xl font-bold text-zinc-100">{{ ipDetail.totalEvents }}</div>
            </div>
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div class="text-xs text-zinc-500 mb-1">{{ t('security.successfulLogins') }}</div>
              <div class="text-xl font-bold" :class="ipDetail.successfulLogins > 0 ? 'text-green-400' : 'text-zinc-100'">{{ ipDetail.successfulLogins }}</div>
            </div>
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div class="text-xs text-zinc-500 mb-1">{{ t('security.targetedAccounts') }}</div>
              <div class="text-xl font-bold text-zinc-100">{{ ipDetail.targetedEmails?.length ?? 0 }}</div>
            </div>
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div class="text-xs text-zinc-500 mb-1">{{ t('security.period') }}</div>
              <div class="text-xl font-bold text-zinc-100">{{ ipDetail.period?.hours ?? 72 }}h</div>
            </div>
          </div>

          <!-- Two-column: Breakdown + Targeted Emails -->
          <div class="grid md:grid-cols-2 gap-6 mb-6">
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
              <h3 class="text-sm font-medium text-zinc-400 mb-3">{{ t('security.eventBreakdown') }}</h3>
              <div class="space-y-2">
                <div v-for="b in ipDetail.breakdown" :key="b.eventType" class="flex items-center justify-between">
                  <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="getEventLabel(b.eventType).color + ' bg-zinc-800'">
                    {{ getEventLabel(b.eventType).label }}
                  </span>
                  <span class="text-sm font-medium text-zinc-300">{{ b.count }}</span>
                </div>
              </div>
            </div>
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
              <h3 class="text-sm font-medium text-zinc-400 mb-3">{{ t('security.targetedAccounts') }}</h3>
              <div v-if="!ipDetail.targetedEmails?.length" class="text-sm text-zinc-600 py-4 text-center">{{ t('security.noData') }}</div>
              <div v-else class="space-y-2">
                <div v-for="e in ipDetail.targetedEmails" :key="e.email" class="flex items-center justify-between">
                  <span class="text-sm text-zinc-300 truncate mr-4">{{ e.email ?? 'Unknown' }}</span>
                  <span class="text-sm font-medium text-red-400">{{ e.count }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Recent Events from IP -->
          <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
            <h3 class="text-sm font-medium text-zinc-400 mb-3">{{ t('security.recentEventsFromIp') }}</h3>
            <div class="space-y-1 max-h-96 overflow-y-auto">
              <div
                v-for="evt in ipDetail.recentEvents"
                :key="evt.id"
                class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50"
              >
                <span class="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0" :class="getEventLabel(evt.eventType).color + ' bg-zinc-800'">
                  {{ getEventLabel(evt.eventType).label }}
                </span>
                <span class="text-sm text-zinc-300 truncate flex-1">{{ evt.description }}</span>
                <span class="text-xs text-zinc-600 flex-shrink-0">{{ timeAgo(evt.createdAt) }}</span>
              </div>
            </div>
          </div>
        </template>

        <div v-else class="text-center py-12 text-zinc-600 text-sm">
          {{ t('security.enterIpToInvestigate') }}
        </div>
      </div>
    </template>
  </div>
</template>
