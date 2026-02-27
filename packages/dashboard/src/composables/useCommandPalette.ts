import { ref, computed, onMounted, onUnmounted, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useServicesStore } from '@/stores/services'
import { useAuth } from '@/composables/useAuth'
import { useTheme } from '@/composables/useTheme'
import { useApi } from '@/composables/useApi'
import {
  LayoutDashboard, Box, Rocket, Store, Globe, Terminal,
  HardDrive, Archive, Key, KeyRound, Users, CreditCard, Settings,
  ScrollText, Search, LogOut, Sun, Plus, UserPlus,
} from 'lucide-vue-next'

export interface CommandItem {
  id: string
  type: 'navigation' | 'service' | 'domain' | 'action'
  label: string
  description?: string
  icon: Component
  path?: string
  action?: () => void
  keywords?: string[]
}

const isOpen = ref(false)
const query = ref('')
const selectedIndex = ref(0)

export function useCommandPalette() {
  const router = useRouter()
  const { t } = useI18n()
  const servicesStore = useServicesStore()
  const { isSuper, logout } = useAuth()
  const { toggle: toggleTheme } = useTheme()
  const api = useApi()

  const domains = ref<Array<{ domain: string; id: string }>>([])
  let domainsLoaded = false

  const navigationItems = computed<CommandItem[]>(() => [
    { id: 'nav-dashboard', type: 'navigation', label: t('nav.dashboard'), icon: LayoutDashboard, path: '/panel', keywords: ['home', 'overview', 'dashboard'] },
    { id: 'nav-services', type: 'navigation', label: t('nav.services'), icon: Box, path: '/panel/services', keywords: ['containers', 'apps', 'services'] },
    { id: 'nav-deploy', type: 'navigation', label: t('nav.deploy'), icon: Rocket, path: '/panel/deploy', keywords: ['new', 'create', 'deploy'] },
    { id: 'nav-marketplace', type: 'navigation', label: t('nav.marketplace'), icon: Store, path: '/panel/marketplace', keywords: ['templates', 'apps', 'marketplace'] },
    { id: 'nav-domains', type: 'navigation', label: t('nav.domains'), icon: Globe, path: '/panel/domains', keywords: ['dns', 'ssl', 'certificate', 'domains'] },
    { id: 'nav-terminal', type: 'navigation', label: t('nav.terminal'), icon: Terminal, path: '/panel/terminal', keywords: ['shell', 'ssh', 'console', 'terminal'] },
    { id: 'nav-storage', type: 'navigation', label: t('nav.storage'), icon: HardDrive, path: '/panel/storage', keywords: ['volumes', 'disk', 'storage'] },
    { id: 'nav-backups', type: 'navigation', label: t('nav.backups'), icon: Archive, path: '/panel/backups', keywords: ['restore', 'snapshot', 'backups'] },
    { id: 'nav-ssh', type: 'navigation', label: t('nav.ssh'), icon: Key, path: '/panel/ssh', keywords: ['keys', 'access', 'ssh'] },
    { id: 'nav-apikeys', type: 'navigation', label: t('nav.apiKeys'), icon: KeyRound, path: '/panel/api-keys', keywords: ['tokens', 'api keys'] },
    { id: 'nav-users', type: 'navigation', label: t('commandPalette.teamMembers'), icon: Users, path: '/panel/users', keywords: ['team', 'members', 'invite', 'users'] },
    { id: 'nav-activity', type: 'navigation', label: t('nav.activity'), icon: ScrollText, path: '/panel/activity', keywords: ['events', 'audit', 'activity'] },
    { id: 'nav-billing', type: 'navigation', label: t('nav.billing'), icon: CreditCard, path: '/panel/billing', keywords: ['subscription', 'payment', 'invoice', 'billing'] },
    { id: 'nav-settings', type: 'navigation', label: t('nav.settings'), icon: Settings, path: '/panel/settings', keywords: ['preferences', 'config', 'settings'] },
  ])

  const adminItems = computed<CommandItem[]>(() => [
    { id: 'admin-dashboard', type: 'navigation', label: t('commandPalette.adminDashboard'), icon: LayoutDashboard, path: '/admin', keywords: ['admin', 'super', 'dashboard'] },
    { id: 'admin-nodes', type: 'navigation', label: t('commandPalette.adminNodes'), icon: HardDrive, path: '/admin/nodes', keywords: ['admin', 'servers', 'nodes'] },
    { id: 'admin-accounts', type: 'navigation', label: t('commandPalette.adminAccounts'), icon: Users, path: '/admin/accounts', keywords: ['admin', 'customers', 'accounts'] },
    { id: 'admin-events', type: 'navigation', label: t('commandPalette.adminEvents'), icon: ScrollText, path: '/admin/events', keywords: ['admin', 'audit', 'events'] },
    { id: 'admin-settings', type: 'navigation', label: t('commandPalette.adminSettings'), icon: Settings, path: '/admin/settings', keywords: ['admin', 'platform', 'settings'] },
  ])

  const actionItems = computed<CommandItem[]>(() => [
    { id: 'action-deploy', type: 'action', label: t('commandPalette.deployNew'), icon: Plus, action: () => router.push('/panel/deploy'), keywords: ['create', 'new', 'deploy'] },
    { id: 'action-domain', type: 'action', label: t('commandPalette.addDomain'), icon: Globe, action: () => router.push('/panel/domains'), keywords: ['dns', 'add', 'domain'] },
    { id: 'action-invite', type: 'action', label: t('commandPalette.inviteTeam'), icon: UserPlus, action: () => router.push('/panel/users'), keywords: ['add', 'member', 'invite'] },
    { id: 'action-theme', type: 'action', label: t('commandPalette.toggleTheme'), icon: Sun, action: toggleTheme, keywords: ['dark', 'light', 'mode', 'theme'] },
    { id: 'action-logout', type: 'action', label: t('commandPalette.signOut'), icon: LogOut, action: logout, keywords: ['logout', 'exit', 'sign out'] },
  ])

  const serviceItems = computed<CommandItem[]>(() => {
    return servicesStore.services.map((svc) => ({
      id: `svc-${svc.id}`,
      type: 'service' as const,
      label: svc.name,
      description: svc.status ?? 'unknown',
      icon: Box,
      path: `/panel/services/${svc.id}`,
      keywords: [svc.image ?? '', svc.status ?? ''],
    }))
  })

  const domainItems = computed<CommandItem[]>(() => {
    return domains.value.map((d) => ({
      id: `domain-${d.id}`,
      type: 'domain' as const,
      label: d.domain,
      description: t('commandPalette.dnsZone'),
      icon: Globe,
      path: `/panel/domains/${d.id}`,
      keywords: ['dns'],
    }))
  })

  const allItems = computed(() => {
    const items = [
      ...navigationItems.value,
      ...(isSuper.value ? adminItems.value : []),
      ...serviceItems.value,
      ...domainItems.value,
      ...actionItems.value,
    ]
    return items
  })

  const results = computed(() => {
    const q = query.value.toLowerCase().trim()
    if (!q) {
      // Show navigation + actions when no query
      return allItems.value.slice(0, 15)
    }
    return allItems.value.filter((item) => {
      const searchable = [item.label, item.description ?? '', ...(item.keywords ?? [])].join(' ').toLowerCase()
      return searchable.includes(q)
    }).slice(0, 20)
  })

  const groupedResults = computed(() => {
    const groups: Record<string, CommandItem[]> = {}
    for (const item of results.value) {
      const key = item.type
      if (!groups[key]) groups[key] = []
      groups[key]!.push(item)
    }
    return groups
  })

  function open() {
    query.value = ''
    selectedIndex.value = 0
    isOpen.value = true

    // Lazy-load services and domains
    if (servicesStore.services.length === 0) {
      servicesStore.fetchServices().catch(() => {})
    }
    if (!domainsLoaded) {
      domainsLoaded = true
      api.get<any[]>('/dns/zones').then((data) => {
        domains.value = (data ?? []).map((z: any) => ({ domain: z.domain, id: z.id }))
      }).catch(() => {})
    }
  }

  function close() {
    isOpen.value = false
    query.value = ''
  }

  function execute(item: CommandItem) {
    close()
    if (item.action) {
      item.action()
    } else if (item.path) {
      router.push(item.path)
    }
  }

  function moveUp() {
    if (selectedIndex.value > 0) selectedIndex.value--
  }

  function moveDown() {
    if (selectedIndex.value < results.value.length - 1) selectedIndex.value++
  }

  function executeSelected() {
    const item = results.value[selectedIndex.value]
    if (item) execute(item)
  }

  // Reset selection when results change
  function onQueryChange() {
    selectedIndex.value = 0
  }

  // Global keyboard listener
  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      if (isOpen.value) close()
      else open()
    }
    if (e.key === 'Escape' && isOpen.value) {
      e.preventDefault()
      close()
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown)
  })

  return {
    isOpen,
    query,
    selectedIndex,
    results,
    groupedResults,
    open,
    close,
    execute,
    moveUp,
    moveDown,
    executeSelected,
    onQueryChange,
  }
}
