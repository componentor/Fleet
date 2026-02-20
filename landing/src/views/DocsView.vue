<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import TheNavbar from '@/components/TheNavbar.vue'
import type { NavLink } from '@/components/TheNavbar.vue'
import TheFooter from '@/components/TheFooter.vue'
import DocsSidebar from '@/components/DocsSidebar.vue'
import CodeBlock from '@/components/CodeBlock.vue'
import { sidebarSections, commandGroups } from '@/data/docs'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const dashboardUrl = import.meta.env.VITE_DASHBOARD_URL || 'http://localhost:5173'

const navLinks = computed<NavLink[]>(() => [
  { label: t('nav.features'), href: '/#features' },
  { label: t('nav.pricing'), href: '/#pricing' },
  { label: t('docs.title'), href: '/docs', routerLink: true },
  { label: t('nav.github'), href: 'https://github.com/fleet', external: true },
])

const activeSection = ref('getting-started')
const sidebarOpen = ref(false)
const sidebarRef = ref<HTMLElement | null>(null)

function handleSidebarClickOutside(e: MouseEvent) {
  if (sidebarOpen.value && sidebarRef.value && !sidebarRef.value.contains(e.target as Node)) {
    sidebarOpen.value = false
  }
}

function navigateTo(id: string) {
  activeSection.value = id
  sidebarOpen.value = false
  // Wait for sidebar collapse DOM update before calculating position
  nextTick(() => {
    const el = document.getElementById(id)
    if (el) {
      const offset = window.innerWidth < 1024 ? 128 : 80
      const top = el.getBoundingClientRect().top + window.scrollY - offset
      window.scrollTo({ top, behavior: 'smooth' })
    }
  })
  history.replaceState(null, '', '#' + id)
}

function handleScroll() {
  const sections = document.querySelectorAll('[data-section]')
  let current = 'getting-started'
  sections.forEach((section) => {
    const rect = section.getBoundingClientRect()
    if (rect.top <= 100) {
      current = section.getAttribute('data-section') ?? current
    }
  })
  activeSection.value = current
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true })
  document.addEventListener('click', handleSidebarClickOutside)
  if (window.location.hash) {
    const id = window.location.hash.slice(1)
    setTimeout(() => navigateTo(id), 100)
  }
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  document.removeEventListener('click', handleSidebarClickOutside)
})
</script>

<template>
  <div class="min-h-screen bg-white dark:bg-surface-950 text-surface-700 dark:text-surface-200">
    <TheNavbar :nav-links="navLinks" :dashboard-url="dashboardUrl" />

    <div class="mx-auto max-w-7xl px-4 pt-24 pb-16 sm:px-6 lg:px-8">
      <div class="lg:grid lg:grid-cols-[240px_1fr] lg:gap-12">
        <!-- Mobile sidebar toggle + collapsible nav -->
        <div ref="sidebarRef" class="lg:hidden sticky top-16 z-40 -mx-4 px-4 pb-3 pt-3 bg-white dark:bg-surface-950">
          <button
            class="flex w-full items-center justify-between rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-2 text-sm text-surface-500 dark:text-surface-400 cursor-pointer"
            @click.stop="sidebarOpen = !sidebarOpen"
          >
            <span class="flex items-center gap-2">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              {{ $t('docs.navigation') }}
            </span>
            <svg
              :class="['h-4 w-4 transition-transform', sidebarOpen ? 'rotate-180' : '']"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div v-if="sidebarOpen" class="mt-2 max-h-64 overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-2">
            <DocsSidebar
              :sections="sidebarSections"
              :active-section="activeSection"
              @navigate="navigateTo"
            />
          </div>
        </div>

        <!-- Desktop sidebar -->
        <aside class="hidden lg:block lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)] lg:overflow-y-auto">
          <DocsSidebar
            :sections="sidebarSections"
            :active-section="activeSection"
            @navigate="navigateTo"
          />
        </aside>

        <!-- Main content -->
        <main class="min-w-0">
          <!-- Getting Started -->
          <section id="getting-started" data-section="getting-started" class="mb-16">
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{{ $t('docs.gettingStarted') }}</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              {{ $t('docs.gettingStartedIntro') }}
            </p>

            <!-- Prerequisites -->
            <div id="prerequisites" data-section="prerequisites" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('docs.prerequisites') }}</h2>
              <ul class="mt-4 space-y-2 text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-1 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.prereq1') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-1 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.prereq2') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-1 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.prereq3') }}</span>
                </li>
              </ul>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                {{ $t('docs.prereqNote') }}
              </p>
            </div>

            <!-- Installation -->
            <div id="installation" data-section="installation" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('docs.installation') }}</h2>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('docs.installScript') }}
              </p>
              <div class="mt-4">
                <CodeBlock code="curl -fsSL https://get.fleethost.io | bash" />
              </div>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('docs.installManual') }}
              </p>
              <div class="mt-4">
                <CodeBlock :code="`git clone https://github.com/fleet/fleet.git\ncd fleet\npnpm install\npnpm build`" />
              </div>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('docs.installCli') }}
              </p>
              <div class="mt-4">
                <CodeBlock code="npm install -g @fleet/cli" />
              </div>
            </div>

            <!-- First Deploy -->
            <div id="first-deploy" data-section="first-deploy" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('docs.firstDeploy') }}</h2>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('docs.initCluster') }}
              </p>
              <div class="mt-4">
                <CodeBlock code="fleet init --domain panel.example.com --email admin@example.com" />
              </div>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('docs.loginCli') }}
              </p>
              <div class="mt-4">
                <CodeBlock :code="`fleet login --api-url https://panel.example.com`" />
              </div>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('docs.deployFirst') }}
              </p>
              <div class="mt-4">
                <CodeBlock :code="`fleet deploy --name my-app --image node:20`" />
              </div>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('docs.deployDone') }}
              </p>
            </div>
          </section>

          <!-- CLI Reference -->
          <section id="cli-reference" data-section="cli-reference" class="mb-16">
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{{ $t('docs.cliReference') }}</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              {{ $t('docs.cliReferenceIntro') }}
            </p>

            <div
              v-for="group in commandGroups"
              :key="group.id"
              :id="group.id"
              :data-section="group.id"
              class="mt-12"
            >
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t(group.titleKey) }}</h2>
              <p class="mt-2 text-surface-500 dark:text-surface-400">{{ $t(group.descriptionKey) }}</p>

              <div class="mt-6 space-y-8">
                <div
                  v-for="cmd in group.commands"
                  :key="cmd.name"
                  class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-6"
                >
                  <h3 class="font-mono text-lg font-semibold text-gray-900 dark:text-white">{{ cmd.name }}</h3>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t(cmd.descriptionKey) }}</p>

                  <div class="mt-4">
                    <p class="text-xs font-semibold uppercase tracking-wider text-surface-500">{{ $t('docs.usage') }}</p>
                    <code class="mt-1 block rounded bg-surface-100 dark:bg-surface-800/50 px-3 py-2 font-mono text-sm text-surface-700 dark:text-surface-300">
                      {{ cmd.usage }}
                    </code>
                  </div>

                  <div v-if="cmd.flags?.length" class="mt-4">
                    <p class="text-xs font-semibold uppercase tracking-wider text-surface-500">{{ $t('docs.options') }}</p>
                    <div class="mt-2 space-y-1">
                      <div
                        v-for="flag in cmd.flags"
                        :key="flag.flag"
                        class="flex items-start gap-3 text-sm"
                      >
                        <code class="shrink-0 rounded bg-surface-100 dark:bg-surface-800/50 px-2 py-0.5 font-mono text-primary-600 dark:text-primary-400">
                          {{ flag.flag }}
                        </code>
                        <span class="text-surface-500 dark:text-surface-400">
                          {{ $t(flag.descriptionKey) }}
                          <span v-if="flag.required" class="text-red-500 dark:text-red-400">{{ $t('docs.required') }}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div v-if="cmd.examples?.length" class="mt-4">
                    <p class="text-xs font-semibold uppercase tracking-wider text-surface-500">{{ $t('docs.examples') }}</p>
                    <div class="mt-2">
                      <CodeBlock :code="cmd.examples.join('\n')" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- Storage -->
          <section id="storage" data-section="storage" class="mb-16">
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{{ $t('docs.storage.title') }}</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              {{ $t('docs.storage.intro') }}
            </p>

            <!-- Overview -->
            <div id="storage-overview" data-section="storage-overview" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('docs.storage.overviewTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('docs.storage.overviewDesc') }}
              </p>
              <div class="mt-6 grid gap-4 sm:grid-cols-2">
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h3 class="font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.volumeStorageTitle') }}</h3>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('docs.storage.volumeStorageDesc') }} <strong>Local/NFS</strong>, <strong>GlusterFS</strong>, <strong>Ceph RBD</strong>.
                  </p>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h3 class="font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.objectStorageTitle') }}</h3>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('docs.storage.objectStorageDesc') }} <strong>Local filesystem</strong>, <strong>MinIO</strong>, <strong>AWS S3</strong>, <strong>Google Cloud Storage</strong>.
                  </p>
                </div>
              </div>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('docs.storage.defaultStoragePart1') }} <strong>{{ $t('docs.storage.localStorage') }}</strong> {{ $t('docs.storage.defaultStoragePart2') }}
              </p>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                {{ $t('docs.storage.providerAbstractionNote') }}
              </p>
            </div>

            <!-- Providers -->
            <div id="storage-providers" data-section="storage-providers" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('docs.storage.providersTitle') }}</h2>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.volumeProvidersTitle') }}</h3>

              <div class="mt-4 space-y-4">
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <div class="flex items-center gap-2">
                    <span class="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">{{ $t('docs.storage.defaultBadge') }}</span>
                    <h4 class="font-semibold text-gray-900 dark:text-white">Local / NFS</h4>
                  </div>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('docs.storage.localNfsDesc') }}
                  </p>
                </div>

                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <div class="flex items-center gap-2">
                    <span class="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">{{ $t('docs.storage.recommendedBadge') }}</span>
                    <h4 class="font-semibold text-gray-900 dark:text-white">GlusterFS</h4>
                  </div>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('docs.storage.glusterDesc') }}
                  </p>
                  <ul class="mt-3 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      {{ $t('docs.storage.glusterFeature1') }}
                    </li>
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      {{ $t('docs.storage.glusterFeature2') }}
                    </li>
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      {{ $t('docs.storage.glusterFeature3') }}
                    </li>
                  </ul>
                </div>

                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <div class="flex items-center gap-2">
                    <span class="inline-flex items-center rounded-full bg-purple-100 dark:bg-purple-900/30 px-2.5 py-0.5 text-xs font-medium text-purple-700 dark:text-purple-300">{{ $t('docs.storage.enterpriseBadge') }}</span>
                    <h4 class="font-semibold text-gray-900 dark:text-white">Ceph RBD</h4>
                  </div>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('docs.storage.cephDesc') }}
                  </p>
                  <ul class="mt-3 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      {{ $t('docs.storage.cephFeature1') }}
                    </li>
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      {{ $t('docs.storage.cephFeature2') }}
                    </li>
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      {{ $t('docs.storage.cephFeature3') }}
                    </li>
                  </ul>
                </div>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.objectProvidersTitle') }}</h3>

              <div class="mt-4 space-y-4">
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.minioTitle') }}</h4>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('docs.storage.minioDesc') }}
                  </p>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">AWS S3</h4>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('docs.storage.awsS3Desc') }}
                  </p>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">Google Cloud Storage</h4>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('docs.storage.gcsDesc') }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Node Setup -->
            <div id="storage-node-setup" data-section="storage-node-setup" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('docs.storage.nodeSetupTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('docs.storage.nodeSetupDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.quickInstallTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('docs.storage.quickInstallDesc') }}</p>
              <div class="mt-3">
                <CodeBlock code="curl -fsSL https://raw.githubusercontent.com/componentor/fleet/main/install/storage-node.sh | sudo bash" />
              </div>
              <p class="mt-3 text-sm text-surface-500 dark:text-surface-400">{{ $t('docs.storage.interactiveInstallerNote') }}</p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.glusterSetupTitle') }}</h3>
              <div class="mt-3">
                <CodeBlock :code="`# On each storage node:\nsudo bash storage-node.sh --provider glusterfs --data-path /srv/fleet-storage\n\n# After all nodes are ready, peer probe from any one node:\nsudo gluster peer probe 10.0.1.11\nsudo gluster peer probe 10.0.1.12\n\n# Verify the trusted pool:\nsudo gluster peer status`" />
              </div>
              <p class="mt-3 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('docs.storage.glusterSetupDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.cephSetupTitle') }}</h3>
              <div class="mt-3">
                <CodeBlock :code="`# Install Ceph client tools on each node:\nsudo bash storage-node.sh --provider ceph --monitors 10.0.1.10,10.0.1.11,10.0.1.12\n\n# The script creates /etc/ceph/ceph.conf and loads the rbd kernel module.\n# You still need a running Ceph cluster — deploy with cephadm or similar.`" />
              </div>
              <p class="mt-3 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                <strong>{{ $t('docs.storage.noteLabel') }}</strong> {{ $t('docs.storage.cephNotepart1') }} <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">cephadm</code>, <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">ceph-deploy</code>{{ $t('docs.storage.cephNotePart2') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.minioSetupTitle') }}</h3>
              <div class="mt-3">
                <CodeBlock :code="`# Install MinIO on each storage node:\nsudo bash storage-node.sh --provider minio --data-path /srv/fleet-objects\n\n# The script generates access keys, creates a systemd service,\n# and starts MinIO on port 9000 (API) / 9001 (console).\n# Credentials are saved to /etc/minio/minio.env`" />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.installEverythingTitle') }}</h3>
              <div class="mt-3">
                <CodeBlock code="sudo bash storage-node.sh --provider all --data-path /srv/fleet-storage" />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.scriptOptionsTitle') }}</h3>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.storage.flagHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.storage.descriptionHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.storage.defaultHeader') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--provider</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.providerFlagDesc') }}</td>
                      <td class="px-4 py-3 text-surface-500">{{ $t('docs.storage.providerFlagDefault') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--data-path</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.dataPathFlagDesc') }}</td>
                      <td class="px-4 py-3 text-surface-500">/srv/fleet-storage</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--monitors</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.monitorsFlagDesc') }}</td>
                      <td class="px-4 py-3 text-surface-500">-</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--minio-port</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.minioPortFlagDesc') }}</td>
                      <td class="px-4 py-3 text-surface-500">9000</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--skip-firewall</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.skipFirewallFlagDesc') }}</td>
                      <td class="px-4 py-3 text-surface-500">false</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.afterInstallTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('docs.storage.afterInstallDesc') }}</p>
              <ol class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300 list-decimal pl-5">
                <li>{{ $t('docs.storage.afterInstallStep1Part1') }} <strong>Storage</strong> → <strong>Configure Storage</strong></li>
                <li>{{ $t('docs.storage.afterInstallStep2Part1') }} <strong>Distributed Cluster</strong> {{ $t('docs.storage.afterInstallStep2Part2') }}</li>
                <li>{{ $t('docs.storage.afterInstallStep3') }}</li>
                <li>{{ $t('docs.storage.afterInstallStep4') }}</li>
                <li>{{ $t('docs.storage.afterInstallStep5Part1') }} <strong>Initialize</strong> {{ $t('docs.storage.afterInstallStep5Part2') }}</li>
                <li>{{ $t('docs.storage.afterInstallStep6') }}</li>
              </ol>
            </div>

            <!-- Hardware Specs -->
            <div id="storage-specs" data-section="storage-specs" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('docs.storage.hardwareTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('docs.storage.hardwareDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.minimumRequirementsTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('docs.storage.minimumRequirementsDesc') }}
              </p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.storage.componentHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.storage.minimumHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.storage.recommendedHeader') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('docs.storage.cpuComponent') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.cpuMinimum') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.cpuRecommended') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('docs.storage.ramComponent') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.ramMinimum') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.ramRecommended') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('docs.storage.storageComponent') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.storageMinimum') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.storageRecommended') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('docs.storage.networkComponent') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.networkMinimum') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.networkRecommended') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('docs.storage.nodesComponent') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.nodesMinimum') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.storage.nodesRecommended') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.scalingGuidelinesTitle') }}</h3>

              <div class="mt-4 space-y-4">
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.smallScaleTitle') }}</h4>
                  <ul class="mt-2 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li>{{ $t('docs.storage.smallScaleItem1') }}</li>
                    <li>{{ $t('docs.storage.smallScaleItem2') }}</li>
                    <li>{{ $t('docs.storage.smallScaleItem3') }}</li>
                    <li>{{ $t('docs.storage.smallScaleItem4') }}</li>
                    <li>{{ $t('docs.storage.smallScaleItem5') }}</li>
                  </ul>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.mediumScaleTitle') }}</h4>
                  <ul class="mt-2 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li>{{ $t('docs.storage.mediumScaleItem1') }}</li>
                    <li>{{ $t('docs.storage.mediumScaleItem2') }}</li>
                    <li>{{ $t('docs.storage.mediumScaleItem3') }}</li>
                    <li>{{ $t('docs.storage.mediumScaleItem4') }}</li>
                    <li>{{ $t('docs.storage.mediumScaleItem5') }}</li>
                  </ul>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.largeScaleTitle') }}</h4>
                  <ul class="mt-2 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li>{{ $t('docs.storage.largeScaleItem1') }}</li>
                    <li>{{ $t('docs.storage.largeScaleItem2') }}</li>
                    <li>{{ $t('docs.storage.largeScaleItem3') }}</li>
                    <li>{{ $t('docs.storage.largeScaleItem4') }}</li>
                    <li>{{ $t('docs.storage.largeScaleItem5') }}</li>
                    <li>{{ $t('docs.storage.largeScaleItem6') }}</li>
                  </ul>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.petabyteScaleTitle') }}</h4>
                  <ul class="mt-2 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li>{{ $t('docs.storage.petabyteScaleItem1') }}</li>
                    <li>{{ $t('docs.storage.petabyteScaleItem2') }}</li>
                    <li>{{ $t('docs.storage.petabyteScaleItem3') }}</li>
                    <li>{{ $t('docs.storage.petabyteScaleItem4') }}</li>
                    <li>{{ $t('docs.storage.petabyteScaleItem5') }}</li>
                    <li>{{ $t('docs.storage.petabyteScaleItem6') }}</li>
                  </ul>
                </div>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.diskSelectionTitle') }}</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>NVMe SSD</strong> — {{ $t('docs.storage.nvmeSsdTip') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>SATA SSD</strong> — {{ $t('docs.storage.sataSsdTip') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>HDD with SSD journal</strong> — {{ $t('docs.storage.hddSsdTip') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>{{ $t('docs.storage.avoidMixingDiskTypes') }}</strong> {{ $t('docs.storage.avoidMixingDiskTypesDesc') }}</span>
                </li>
              </ul>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.networkConsiderationsTitle') }}</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.storage.networkTip1') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.storage.networkTip2') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.storage.networkTip3') }}</span>
                </li>
              </ul>
            </div>

            <!-- Migration -->
            <div id="storage-migration" data-section="storage-migration" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('docs.storage.migrationTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('docs.storage.migrationDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.howMigrationWorksTitle') }}</h3>
              <ol class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300 list-decimal pl-5">
                <li><strong>{{ $t('docs.storage.migrationInventoryLabel') }}</strong> — {{ $t('docs.storage.migrationInventoryDesc') }}</li>
                <li><strong>{{ $t('docs.storage.migrationCopyLabel') }}</strong> — {{ $t('docs.storage.migrationCopyDesc') }}</li>
                <li><strong>{{ $t('docs.storage.migrationVerifyLabel') }}</strong> — {{ $t('docs.storage.migrationVerifyDesc') }}</li>
                <li><strong>{{ $t('docs.storage.migrationSwitchoverLabel') }}</strong> — {{ $t('docs.storage.migrationSwitchoverDesc') }}</li>
                <li><strong>{{ $t('docs.storage.migrationCleanupLabel') }}</strong> — {{ $t('docs.storage.migrationCleanupDesc') }}</li>
              </ol>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.storage.migrationWizardTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('docs.storage.migrationWizardDesc') }}
              </p>
              <ol class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300 list-decimal pl-5">
                <li>{{ $t('docs.storage.wizardStep1Part1') }} <strong>Storage</strong> → {{ $t('docs.storage.wizardStep1Part2') }} <strong>Migrate Storage</strong></li>
                <li>{{ $t('docs.storage.wizardStep2') }}</li>
                <li>{{ $t('docs.storage.wizardStep3Part1') }} <strong>Start Migration</strong></li>
                <li>{{ $t('docs.storage.wizardStep4Part1') }} <strong>{{ $t('docs.storage.pause') }}</strong> {{ $t('docs.storage.and') }} <strong>{{ $t('docs.storage.resume') }}</strong> {{ $t('docs.storage.wizardStep4Part2') }}</li>
                <li>{{ $t('docs.storage.wizardStep5Part1') }} <strong>Rollback</strong> {{ $t('docs.storage.wizardStep5Part2') }}</li>
              </ol>

              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                <strong>{{ $t('docs.storage.tipLabel') }}</strong> {{ $t('docs.storage.migrationTip') }}
              </p>
            </div>
          </section>

          <!-- Networking -->
          <section id="networking" data-section="networking" class="mb-16">
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{{ $t('docs.networking.title') }}</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              {{ $t('docs.networking.intro') }}
            </p>

            <!-- Required Ports -->
            <div id="networking-ports" data-section="networking-ports" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('docs.networking.requiredPortsTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('docs.networking.requiredPortsDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.networking.publicPortsTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('docs.networking.publicPortsDesc') }}</p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.networking.portHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.networking.protocolHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.networking.serviceHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.networking.descriptionHeader') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">22</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">SSH</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.sshDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">80</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">HTTP</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.httpDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">443</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">HTTPS</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.httpsDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">2222</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">SFTP</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.sftpDesc') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.networking.swarmPortsTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('docs.networking.swarmPortsDesc') }}</p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.networking.portHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.networking.protocolHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.networking.serviceHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.networking.descriptionHeader') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">2377</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('docs.networking.swarmManagementService') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.swarmManagementDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">7946</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP + UDP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('docs.networking.nodeDiscoveryService') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.nodeDiscoveryDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">4789</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">UDP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('docs.networking.overlayNetworkService') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.overlayNetworkDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">2049</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">NFS</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.nfsDesc') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.networking.optionalStoragePortsTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('docs.networking.optionalStoragePortsDesc') }}</p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.networking.portHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.networking.protocolHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.networking.serviceHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.networking.descriptionHeader') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">24007-24008</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">GlusterFS</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.glusterDaemonDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">49152-49251</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('docs.networking.glusterBricksService') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.glusterBricksDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">6789</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('docs.networking.cephMonitorService') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.cephMonitorDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">6800-7300</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">Ceph OSD</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.cephOsdDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">9000</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">MinIO API</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.minioApiDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">9001</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('docs.networking.minioConsoleService') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.networking.minioConsoleDesc') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Firewall Setup -->
            <div id="networking-firewall" data-section="networking-firewall" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('docs.networking.firewallTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('docs.networking.firewallDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.networking.ufwTitle') }}</h3>
              <div class="mt-3">
                <CodeBlock :code="`# Public ports\nsudo ufw allow 22/tcp    # SSH\nsudo ufw allow 80/tcp    # HTTP\nsudo ufw allow 443/tcp   # HTTPS\nsudo ufw allow 2222/tcp  # SFTP\n\n# Swarm ports (restrict to your node IPs in production)\nsudo ufw allow 2377/tcp  # Swarm management\nsudo ufw allow 7946/tcp  # Node discovery\nsudo ufw allow 7946/udp  # Node discovery\nsudo ufw allow 4789/udp  # Overlay network\nsudo ufw allow 2049/tcp  # NFS\n\nsudo ufw reload`" />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.networking.firewalldTitle') }}</h3>
              <div class="mt-3">
                <CodeBlock :code="`sudo firewall-cmd --permanent --add-port=22/tcp\nsudo firewall-cmd --permanent --add-port=80/tcp\nsudo firewall-cmd --permanent --add-port=443/tcp\nsudo firewall-cmd --permanent --add-port=2222/tcp\nsudo firewall-cmd --permanent --add-port=2377/tcp\nsudo firewall-cmd --permanent --add-port=7946/tcp\nsudo firewall-cmd --permanent --add-port=7946/udp\nsudo firewall-cmd --permanent --add-port=4789/udp\nsudo firewall-cmd --permanent --add-port=2049/tcp\nsudo firewall-cmd --reload`" />
              </div>

              <p class="mt-6 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                <strong>{{ $t('docs.networking.securityTipLabel') }}</strong> {{ $t('docs.networking.securityTipPart1') }} <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">ufw allow from &lt;NODE_IP&gt; to any port 2377</code> {{ $t('docs.networking.securityTipPart2') }}
              </p>
            </div>

            <!-- SFTP Access -->
            <div id="networking-sftp" data-section="networking-sftp" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('docs.networking.sftpAccessTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('docs.networking.sftpAccessDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.networking.howItWorksTitle') }}</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.networking.sftpHowItem1Part1') }} <strong>2222</strong> {{ $t('docs.networking.sftpHowItem1Part2') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.networking.sftpHowItem2Part1') }} <strong>{{ $t('docs.networking.apiKeys') }}</strong> — {{ $t('docs.networking.sftpHowItem2Part2') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.networking.sftpHowItem3Part1') }} <strong>{{ $t('docs.networking.chrooted') }}</strong> {{ $t('docs.networking.sftpHowItem3Part2') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.networking.sftpHowItem4') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.networking.sftpHowItem5Part1') }} <strong>{{ $t('docs.networking.concurrentConnections') }}</strong> {{ $t('docs.networking.sftpHowItem5Part2') }} <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">SFTP_MAX_CONNECTIONS</code>)</span>
                </li>
              </ul>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.networking.connectingTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('docs.networking.connectingDescPart1') }} <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">accountId/serviceId</code> {{ $t('docs.networking.connectingDescPart2') }}
              </p>
              <div class="mt-3">
                <CodeBlock :code="`# Command-line SFTP\nsftp -P 2222 ACCOUNT_ID/SERVICE_ID@your-server.com\n\n# When prompted for password, enter your API key`" />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.networking.securityTitle') }}</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>{{ $t('docs.networking.perAccountIsolationLabel') }}</strong> {{ $t('docs.networking.perAccountIsolationDesc') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>{{ $t('docs.networking.bruteForceLabel') }}</strong> {{ $t('docs.networking.bruteForceDesc') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>{{ $t('docs.networking.connectionLimitsLabel') }}</strong> {{ $t('docs.networking.connectionLimitsDesc') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>{{ $t('docs.networking.sshEncryptionLabel') }}</strong> {{ $t('docs.networking.sshEncryptionDesc') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>{{ $t('docs.networking.apiKeyAuthLabel') }}</strong> {{ $t('docs.networking.apiKeyAuthDesc') }}</span>
                </li>
              </ul>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.networking.disablingSftpTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('docs.networking.disablingSftpDesc') }}
              </p>
              <div class="mt-3">
                <CodeBlock code="SFTP_ENABLED=false" />
              </div>
            </div>
          </section>

          <!-- Integrations -->
          <section id="integrations" data-section="integrations" class="mb-16">
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{{ $t('docs.integrationsTitle') }}</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              {{ $t('docs.integrationsIntro') }}
            </p>

            <!-- Deploy Button -->
            <div id="deploy-button" data-section="deploy-button" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('docs.deployButtonTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('docs.deployButtonDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.quickStart') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('docs.addToReadme') }}</p>
              <div class="mt-3">
                <CodeBlock :code="`[![Deploy on Fleet](https://your-landing-site.com/deploy-button.svg)](https://your-dashboard.com/deploy/gh?repo=owner/repo)`" />
              </div>
              <p class="mt-3 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('docs.replaceUrls', { landingSite: 'your-landing-site.com', dashboard: 'your-dashboard.com' }) }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.urlParameters') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('docs.urlParamsDesc') }}
              </p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.parameter') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.required') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.description') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">repo</td>
                      <td class="px-4 py-3 text-red-500">{{ $t('docs.yes') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.paramRepoDesc', { format: 'owner/repo' }) }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">branch</td>
                      <td class="px-4 py-3 text-surface-500">{{ $t('docs.no') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.paramBranchDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">name</td>
                      <td class="px-4 py-3 text-surface-500">{{ $t('docs.no') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.paramNameDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">env[KEY]</td>
                      <td class="px-4 py-3 text-surface-500">{{ $t('docs.no') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.paramEnvDesc', { format: 'env[KEY]=value' }) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.howItWorks') }}</h3>
              <ol class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300 list-decimal pl-5">
                <li>{{ $t('docs.howStep1') }}</li>
                <li>{{ $t('docs.howStep2', { file: 'fleet.json' }) }}</li>
                <li>{{ $t('docs.howStep3') }}</li>
                <li>{{ $t('docs.howStep4') }}</li>
              </ol>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                {{ $t('docs.howNote') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.examples') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('docs.basicDeployButton') }}</p>
              <div class="mt-3">
                <CodeBlock code="https://your-dashboard.com/deploy/gh?repo=myorg/my-app" />
              </div>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400">{{ $t('docs.withBranchAndEnv') }}</p>
              <div class="mt-3">
                <CodeBlock code="https://your-dashboard.com/deploy/gh?repo=myorg/my-app&branch=stable&env[NODE_ENV]=production&env[PORT]=3000" />
              </div>
            </div>

            <!-- fleet.json Reference -->
            <div id="fleet-json" data-section="fleet-json" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('docs.fleetJsonTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('docs.fleetJsonDesc', { file: 'fleet.json' }) }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.fullExample') }}</h3>
              <div class="mt-3">
                <CodeBlock :code='`{
  \"name\": \"My App\",
  \"description\": \"A brief description of the app\",
  \"icon\": \"https://example.com/icon.png\",
  \"website\": \"https://example.com\",
  \"env\": {
    \"DATABASE_URL\": {
      \"description\": \"PostgreSQL connection string\",
      \"required\": true
    },
    \"SECRET_KEY\": {
      \"description\": \"Secret key for session encryption\",
      \"generate\": true
    },
    \"LOG_LEVEL\": {
      \"description\": \"Logging verbosity\",
      \"value\": \"info\",
      \"required\": false
    }
  },
  \"ports\": [
    { \"target\": 3000 }
  ],
  \"buildFile\": \"Dockerfile\",
  \"branch\": \"main\"
}`' />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.topLevelFields') }}</h3>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.field') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.type') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.description') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">name</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.fieldNameDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">description</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.fieldDescriptionDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">icon</td>
                      <td class="px-4 py-3 text-surface-500">url</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.fieldIconDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">website</td>
                      <td class="px-4 py-3 text-surface-500">url</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.fieldWebsiteDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">env</td>
                      <td class="px-4 py-3 text-surface-500">object</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.fieldEnvDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">ports</td>
                      <td class="px-4 py-3 text-surface-500">array</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.fieldPortsDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">buildFile</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.fieldBuildFileDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">branch</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.fieldBranchDesc') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.environmentVariables') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('docs.envVarsDesc', { env: 'env' }) }}
              </p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.property') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.type') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.description') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">description</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.propDescriptionDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">value</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.propValueDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">required</td>
                      <td class="px-4 py-3 text-surface-500">boolean</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.propRequiredDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">generate</td>
                      <td class="px-4 py-3 text-surface-500">boolean</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.propGenerateDesc') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.portMappings') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('docs.portMappingsDesc', { ports: 'ports' }) }}
              </p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.property') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.type') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.description') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">target</td>
                      <td class="px-4 py-3 text-surface-500">number</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.propTargetDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">published</td>
                      <td class="px-4 py-3 text-surface-500">number</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.propPublishedDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">protocol</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.propProtocolDesc', { tcp: 'tcp', udp: 'udp' }) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.realWorldExamples') }}</h3>

              <h4 class="mt-6 text-base font-semibold text-gray-900 dark:text-white">Node.js App</h4>
              <div class="mt-3">
                <CodeBlock :code='`{
  \"name\": \"Express API\",
  \"description\": \"REST API built with Express.js\",
  \"env\": {
    \"NODE_ENV\": {
      \"value\": \"production\",
      \"required\": false
    },
    \"PORT\": {
      \"value\": \"3000\"
    },
    \"SESSION_SECRET\": {
      \"description\": \"Secret for signing session cookies\",
      \"generate\": true
    },
    \"DATABASE_URL\": {
      \"description\": \"PostgreSQL connection string\",
      \"required\": true
    }
  },
  \"ports\": [{ \"target\": 3000 }],
  \"buildFile\": \"Dockerfile\"
}`' />
              </div>

              <h4 class="mt-6 text-base font-semibold text-gray-900 dark:text-white">Python / Django</h4>
              <div class="mt-3">
                <CodeBlock :code='`{
  \"name\": \"Django App\",
  \"description\": \"Django web application\",
  \"env\": {
    \"DJANGO_SECRET_KEY\": {
      \"description\": \"Django secret key\",
      \"generate\": true
    },
    \"DJANGO_ALLOWED_HOSTS\": {
      \"value\": \"*\"
    },
    \"DATABASE_URL\": {
      \"description\": \"Database connection string\",
      \"required\": true
    }
  },
  \"ports\": [{ \"target\": 8000 }],
  \"branch\": \"main\"
}`' />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('docs.bestPractices') }}</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.bestPractice1', { code: 'generate: true' }) }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.bestPractice2', { code: 'description' }) }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.bestPractice3', { code: 'required: false' }) }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('docs.bestPractice4', { code: 'Dockerfile' }) }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  <span>{{ $t('docs.bestPracticeNo1', { code: 'fleet.json' }) }}</span>
                </li>
              </ul>
            </div>
          </section>

          <!-- Configuration -->
          <section id="configuration" data-section="configuration" class="mb-16">
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{{ $t('docs.configuration') }}</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              {{ $t('docs.configIntro') }}
            </p>

            <div class="mt-8 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
              <table class="w-full text-sm">
                <thead class="bg-surface-50 dark:bg-surface-900/80">
                  <tr>
                    <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.variable') }}</th>
                    <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.description') }}</th>
                    <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('docs.default') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">DB_DIALECT</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.configDbDialect') }}</td>
                    <td class="px-4 py-3 text-surface-500">sqlite</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">DATABASE_URL</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.configDatabaseUrl') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">JWT_SECRET</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.configJwtSecret') }}</td>
                    <td class="px-4 py-3 text-surface-500">{{ $t('docs.configAutoGen') }}</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">NODE_AUTH_TOKEN</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.configNodeAuthToken') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">STRIPE_SECRET_KEY</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.configStripeSecret') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">STRIPE_WEBHOOK_SECRET</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.configStripeWebhook') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">VALKEY_URL</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.configValkeyUrl') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">NFS_SERVER</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.configNfsServer') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">NFS_PATH</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.configNfsPath') }}</td>
                    <td class="px-4 py-3 text-surface-500">/fleet-data</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">PLATFORM_DOMAIN</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('docs.configPlatformDomain') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">SFTP_ENABLED</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Enable or disable the built-in SFTP server</td>
                    <td class="px-4 py-3 text-surface-500">true</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">SFTP_PORT</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Port for the SFTP server to listen on</td>
                    <td class="px-4 py-3 text-surface-500">2222</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">SFTP_HOST_KEY_PATH</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Path to the SSH host key file (auto-generated if missing)</td>
                    <td class="px-4 py-3 text-surface-500">./data/sftp_host_ed25519_key</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">SFTP_MAX_CONNECTIONS</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Maximum total concurrent SFTP connections</td>
                    <td class="px-4 py-3 text-surface-500">10000</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">SFTP_MAX_PER_ACCOUNT</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Maximum concurrent SFTP connections per account</td>
                    <td class="px-4 py-3 text-surface-500">100</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>

    <TheFooter />
  </div>
</template>
