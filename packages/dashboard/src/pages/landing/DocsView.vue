<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import LandingNavbar from '@/components/landing/LandingNavbar.vue'
import type { NavLink } from '@/components/landing/LandingNavbar.vue'
import LandingFooter from '@/components/landing/LandingFooter.vue'
import DocsSidebar from '@/components/landing/DocsSidebar.vue'
import CodeBlock from '@/components/landing/CodeBlock.vue'
import { sidebarSections, commandGroups } from '@/data/docs'
import { useI18n } from 'vue-i18n'
import { useBranding } from '@/composables/useBranding'

const { t } = useI18n()
const { brandGithubUrl } = useBranding()

const navLinks = computed<NavLink[]>(() => {
  const links: NavLink[] = [
    { label: t('landing.nav.home'), href: '/', routerLink: true },
  ]
  if (brandGithubUrl.value) {
    links.push({ label: t('landing.nav.github'), href: brandGithubUrl.value, external: true })
  }
  return links
})

const activeSection = ref('getting-started')
const sidebarOpen = ref(false)
const sidebarRef = ref<HTMLElement | null>(null)

function handleSidebarClickOutside(e: MouseEvent) {
  if (sidebarOpen.value && sidebarRef.value && !sidebarRef.value.contains(e.target as Node)) {
    sidebarOpen.value = false
  }
}

function getBannerHeight() {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--banner-height') || '0', 10)
}

function navigateTo(id: string) {
  activeSection.value = id
  sidebarOpen.value = false
  // Wait for sidebar collapse DOM update before calculating position
  nextTick(() => {
    const el = document.getElementById(id)
    if (el) {
      const bannerH = getBannerHeight()
      const offset = (window.innerWidth < 1024 ? 128 : 80) + bannerH
      const top = el.getBoundingClientRect().top + window.scrollY - offset
      window.scrollTo({ top, behavior: 'smooth' })
    }
  })
  history.replaceState(null, '', '#' + id)
}

function handleScroll() {
  const sections = document.querySelectorAll('[data-section]')
  let current = 'getting-started'
  const threshold = 100 + getBannerHeight()
  sections.forEach((section) => {
    const rect = section.getBoundingClientRect()
    if (rect.top <= threshold) {
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
    <LandingNavbar :nav-links="navLinks" />

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
              {{ $t('landing.docs.navigation') }}
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
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{{ $t('landing.docs.gettingStarted') }}</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              {{ $t('landing.docs.gettingStartedIntro') }}
            </p>

            <!-- Prerequisites -->
            <div id="prerequisites" data-section="prerequisites" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('landing.docs.prerequisites') }}</h2>
              <ul class="mt-4 space-y-2 text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-1 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.prereq1') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-1 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.prereq2') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-1 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.prereq3') }}</span>
                </li>
              </ul>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                {{ $t('landing.docs.prereqNote') }}
              </p>
            </div>

            <!-- Installation -->
            <div id="installation" data-section="installation" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('landing.docs.installation') }}</h2>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.installScript') }}
              </p>
              <div class="mt-4">
                <CodeBlock code="curl -fsSL https://get.fleethost.io | bash" />
              </div>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.installManual') }}
              </p>
              <div class="mt-4">
                <CodeBlock :code="`git clone https://github.com/fleet/fleet.git\ncd fleet\npnpm install\npnpm build`" />
              </div>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.installCli') }}
              </p>
              <div class="mt-4">
                <CodeBlock code="npm install -g siglar" />
              </div>
            </div>

            <!-- First Deploy -->
            <div id="first-deploy" data-section="first-deploy" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('landing.docs.firstDeploy') }}</h2>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.initCluster') }}
              </p>
              <div class="mt-4">
                <CodeBlock code="siglar init --domain panel.example.com --email admin@example.com" />
              </div>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.loginCli') }}
              </p>
              <div class="mt-4">
                <CodeBlock :code="`siglar login --api-url https://panel.example.com`" />
              </div>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.deployFirst') }}
              </p>
              <div class="mt-4">
                <CodeBlock :code="`siglar deploy --name my-app --image node:20`" />
              </div>
              <p class="mt-4 text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.deployDone') }}
              </p>
            </div>
          </section>

          <!-- CLI Reference -->
          <section id="cli-reference" data-section="cli-reference" class="mb-16">
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{{ $t('landing.docs.cliReference') }}</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              {{ $t('landing.docs.cliReferenceIntro') }}
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
                    <p class="text-xs font-semibold uppercase tracking-wider text-surface-500">{{ $t('landing.docs.usage') }}</p>
                    <code class="mt-1 block rounded bg-surface-100 dark:bg-surface-800/50 px-3 py-2 font-mono text-sm text-surface-700 dark:text-surface-300">
                      {{ cmd.usage }}
                    </code>
                  </div>

                  <div v-if="cmd.flags?.length" class="mt-4">
                    <p class="text-xs font-semibold uppercase tracking-wider text-surface-500">{{ $t('landing.docs.options') }}</p>
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
                          <span v-if="flag.required" class="text-red-500 dark:text-red-400">{{ $t('landing.docs.required') }}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div v-if="cmd.examples?.length" class="mt-4">
                    <p class="text-xs font-semibold uppercase tracking-wider text-surface-500">{{ $t('landing.docs.examples') }}</p>
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
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{{ $t('landing.docs.storage.title') }}</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              {{ $t('landing.docs.storage.intro') }}
            </p>

            <!-- Overview -->
            <div id="storage-overview" data-section="storage-overview" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.overviewTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('landing.docs.storage.overviewDesc') }}
              </p>
              <div class="mt-6 grid gap-4 sm:grid-cols-2">
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h3 class="font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.volumeStorageTitle') }}</h3>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('landing.docs.storage.volumeStorageDesc') }} <strong>Local/NFS</strong>, <strong>GlusterFS</strong>, <strong>Ceph RBD</strong>.
                  </p>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h3 class="font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.objectStorageTitle') }}</h3>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('landing.docs.storage.objectStorageDesc') }} <strong>Local filesystem</strong>, <strong>MinIO</strong>, <strong>AWS S3</strong>, <strong>Google Cloud Storage</strong>.
                  </p>
                </div>
              </div>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.storage.defaultStoragePart1') }} <strong>{{ $t('landing.docs.storage.localStorage') }}</strong> {{ $t('landing.docs.storage.defaultStoragePart2') }}
              </p>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                {{ $t('landing.docs.storage.providerAbstractionNote') }}
              </p>
            </div>

            <!-- Providers -->
            <div id="storage-providers" data-section="storage-providers" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.providersTitle') }}</h2>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.volumeProvidersTitle') }}</h3>

              <div class="mt-4 space-y-4">
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <div class="flex items-center gap-2">
                    <span class="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">{{ $t('landing.docs.storage.defaultBadge') }}</span>
                    <h4 class="font-semibold text-gray-900 dark:text-white">Local / NFS</h4>
                  </div>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('landing.docs.storage.localNfsDesc') }}
                  </p>
                </div>

                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <div class="flex items-center gap-2">
                    <span class="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">{{ $t('landing.docs.storage.recommendedBadge') }}</span>
                    <h4 class="font-semibold text-gray-900 dark:text-white">GlusterFS</h4>
                  </div>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('landing.docs.storage.glusterDesc') }}
                  </p>
                  <ul class="mt-3 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      {{ $t('landing.docs.storage.glusterFeature1') }}
                    </li>
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      {{ $t('landing.docs.storage.glusterFeature2') }}
                    </li>
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      {{ $t('landing.docs.storage.glusterFeature3') }}
                    </li>
                  </ul>
                </div>

                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <div class="flex items-center gap-2">
                    <span class="inline-flex items-center rounded-full bg-purple-100 dark:bg-purple-900/30 px-2.5 py-0.5 text-xs font-medium text-purple-700 dark:text-purple-300">{{ $t('landing.docs.storage.enterpriseBadge') }}</span>
                    <h4 class="font-semibold text-gray-900 dark:text-white">Ceph RBD</h4>
                  </div>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('landing.docs.storage.cephDesc') }}
                  </p>
                  <ul class="mt-3 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      {{ $t('landing.docs.storage.cephFeature1') }}
                    </li>
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      {{ $t('landing.docs.storage.cephFeature2') }}
                    </li>
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      {{ $t('landing.docs.storage.cephFeature3') }}
                    </li>
                  </ul>
                </div>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.objectProvidersTitle') }}</h3>

              <div class="mt-4 space-y-4">
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.minioTitle') }}</h4>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('landing.docs.storage.minioDesc') }}
                  </p>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">AWS S3</h4>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('landing.docs.storage.awsS3Desc') }}
                  </p>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">Google Cloud Storage</h4>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    {{ $t('landing.docs.storage.gcsDesc') }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Node Setup -->
            <div id="storage-node-setup" data-section="storage-node-setup" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.nodeSetupTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('landing.docs.storage.nodeSetupDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.quickInstallTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.quickInstallDesc') }}</p>
              <div class="mt-3">
                <CodeBlock code="sudo bash storage-node.sh --provider glusterfs" />
              </div>
              <p class="mt-3 text-sm text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.interactiveInstallerNote') }}</p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.glusterSetupTitle') }}</h3>
              <div class="mt-3">
                <CodeBlock :code="`# On each storage node:\nsudo bash storage-node.sh --provider glusterfs --data-path /srv/fleet-storage\n\n# After all nodes are ready, peer probe from any one node:\nsudo gluster peer probe 10.0.1.11\nsudo gluster peer probe 10.0.1.12\n\n# Verify the trusted pool:\nsudo gluster peer status`" />
              </div>
              <p class="mt-3 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.storage.glusterSetupDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.cephSetupTitle') }}</h3>
              <div class="mt-3">
                <CodeBlock :code="`# Install Ceph client tools on each node:\nsudo bash storage-node.sh --provider ceph --monitors 10.0.1.10,10.0.1.11,10.0.1.12\n\n# The script creates /etc/ceph/ceph.conf and loads the rbd kernel module.\n# You still need a running Ceph cluster — deploy with cephadm or similar.`" />
              </div>
              <p class="mt-3 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                <strong>{{ $t('landing.docs.storage.noteLabel') }}</strong> {{ $t('landing.docs.storage.cephNotepart1') }} <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">cephadm</code>, <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">ceph-deploy</code>{{ $t('landing.docs.storage.cephNotePart2') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.minioSetupTitle') }}</h3>
              <div class="mt-3">
                <CodeBlock :code="`# Install MinIO on each storage node:\nsudo bash storage-node.sh --provider minio --data-path /srv/fleet-objects\n\n# The script generates access keys, creates a systemd service,\n# and starts MinIO on port 9000 (API) / 9001 (console).\n# Credentials are saved to /etc/minio/minio.env`" />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.installEverythingTitle') }}</h3>
              <div class="mt-3">
                <CodeBlock code="sudo bash storage-node.sh --provider all --data-path /srv/fleet-storage" />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.scriptOptionsTitle') }}</h3>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.storage.flagHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.storage.descriptionHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.storage.defaultHeader') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--provider</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.providerFlagDesc') }}</td>
                      <td class="px-4 py-3 text-surface-500">{{ $t('landing.docs.storage.providerFlagDefault') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--data-path</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.dataPathFlagDesc') }}</td>
                      <td class="px-4 py-3 text-surface-500">/srv/fleet-storage</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--monitors</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.monitorsFlagDesc') }}</td>
                      <td class="px-4 py-3 text-surface-500">-</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--minio-port</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.minioPortFlagDesc') }}</td>
                      <td class="px-4 py-3 text-surface-500">9000</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--skip-firewall</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.skipFirewallFlagDesc') }}</td>
                      <td class="px-4 py-3 text-surface-500">false</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.afterInstallTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.afterInstallDesc') }}</p>
              <ol class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300 list-decimal pl-5">
                <li>{{ $t('landing.docs.storage.afterInstallStep1Part1') }} <strong>Storage</strong> → <strong>Configure Storage</strong></li>
                <li>{{ $t('landing.docs.storage.afterInstallStep2Part1') }} <strong>Distributed Cluster</strong> {{ $t('landing.docs.storage.afterInstallStep2Part2') }}</li>
                <li>{{ $t('landing.docs.storage.afterInstallStep3') }}</li>
                <li>{{ $t('landing.docs.storage.afterInstallStep4') }}</li>
                <li>{{ $t('landing.docs.storage.afterInstallStep5Part1') }} <strong>Initialize</strong> {{ $t('landing.docs.storage.afterInstallStep5Part2') }}</li>
                <li>{{ $t('landing.docs.storage.afterInstallStep6') }}</li>
              </ol>
            </div>

            <!-- Hardware Specs -->
            <div id="storage-specs" data-section="storage-specs" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.hardwareTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('landing.docs.storage.hardwareDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.minimumRequirementsTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.storage.minimumRequirementsDesc') }}
              </p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.storage.componentHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.storage.minimumHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.storage.recommendedHeader') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('landing.docs.storage.cpuComponent') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.cpuMinimum') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.cpuRecommended') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('landing.docs.storage.ramComponent') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.ramMinimum') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.ramRecommended') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('landing.docs.storage.storageComponent') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.storageMinimum') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.storageRecommended') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('landing.docs.storage.networkComponent') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.networkMinimum') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.networkRecommended') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('landing.docs.storage.nodesComponent') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.nodesMinimum') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.storage.nodesRecommended') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.scalingGuidelinesTitle') }}</h3>

              <div class="mt-4 space-y-4">
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.smallScaleTitle') }}</h4>
                  <ul class="mt-2 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li>{{ $t('landing.docs.storage.smallScaleItem1') }}</li>
                    <li>{{ $t('landing.docs.storage.smallScaleItem2') }}</li>
                    <li>{{ $t('landing.docs.storage.smallScaleItem3') }}</li>
                    <li>{{ $t('landing.docs.storage.smallScaleItem4') }}</li>
                    <li>{{ $t('landing.docs.storage.smallScaleItem5') }}</li>
                  </ul>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.mediumScaleTitle') }}</h4>
                  <ul class="mt-2 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li>{{ $t('landing.docs.storage.mediumScaleItem1') }}</li>
                    <li>{{ $t('landing.docs.storage.mediumScaleItem2') }}</li>
                    <li>{{ $t('landing.docs.storage.mediumScaleItem3') }}</li>
                    <li>{{ $t('landing.docs.storage.mediumScaleItem4') }}</li>
                    <li>{{ $t('landing.docs.storage.mediumScaleItem5') }}</li>
                  </ul>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.largeScaleTitle') }}</h4>
                  <ul class="mt-2 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li>{{ $t('landing.docs.storage.largeScaleItem1') }}</li>
                    <li>{{ $t('landing.docs.storage.largeScaleItem2') }}</li>
                    <li>{{ $t('landing.docs.storage.largeScaleItem3') }}</li>
                    <li>{{ $t('landing.docs.storage.largeScaleItem4') }}</li>
                    <li>{{ $t('landing.docs.storage.largeScaleItem5') }}</li>
                    <li>{{ $t('landing.docs.storage.largeScaleItem6') }}</li>
                  </ul>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.petabyteScaleTitle') }}</h4>
                  <ul class="mt-2 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li>{{ $t('landing.docs.storage.petabyteScaleItem1') }}</li>
                    <li>{{ $t('landing.docs.storage.petabyteScaleItem2') }}</li>
                    <li>{{ $t('landing.docs.storage.petabyteScaleItem3') }}</li>
                    <li>{{ $t('landing.docs.storage.petabyteScaleItem4') }}</li>
                    <li>{{ $t('landing.docs.storage.petabyteScaleItem5') }}</li>
                    <li>{{ $t('landing.docs.storage.petabyteScaleItem6') }}</li>
                  </ul>
                </div>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.diskSelectionTitle') }}</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>NVMe SSD</strong> — {{ $t('landing.docs.storage.nvmeSsdTip') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>SATA SSD</strong> — {{ $t('landing.docs.storage.sataSsdTip') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>HDD with SSD journal</strong> — {{ $t('landing.docs.storage.hddSsdTip') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>{{ $t('landing.docs.storage.avoidMixingDiskTypes') }}</strong> {{ $t('landing.docs.storage.avoidMixingDiskTypesDesc') }}</span>
                </li>
              </ul>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.networkConsiderationsTitle') }}</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.storage.networkTip1') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.storage.networkTip2') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.storage.networkTip3') }}</span>
                </li>
              </ul>
            </div>

            <!-- Migration -->
            <div id="storage-migration" data-section="storage-migration" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.migrationTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('landing.docs.storage.migrationDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.howMigrationWorksTitle') }}</h3>
              <ol class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300 list-decimal pl-5">
                <li><strong>{{ $t('landing.docs.storage.migrationInventoryLabel') }}</strong> — {{ $t('landing.docs.storage.migrationInventoryDesc') }}</li>
                <li><strong>{{ $t('landing.docs.storage.migrationCopyLabel') }}</strong> — {{ $t('landing.docs.storage.migrationCopyDesc') }}</li>
                <li><strong>{{ $t('landing.docs.storage.migrationVerifyLabel') }}</strong> — {{ $t('landing.docs.storage.migrationVerifyDesc') }}</li>
                <li><strong>{{ $t('landing.docs.storage.migrationSwitchoverLabel') }}</strong> — {{ $t('landing.docs.storage.migrationSwitchoverDesc') }}</li>
                <li><strong>{{ $t('landing.docs.storage.migrationCleanupLabel') }}</strong> — {{ $t('landing.docs.storage.migrationCleanupDesc') }}</li>
              </ol>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.storage.migrationWizardTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.storage.migrationWizardDesc') }}
              </p>
              <ol class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300 list-decimal pl-5">
                <li>{{ $t('landing.docs.storage.wizardStep1Part1') }} <strong>Storage</strong> → {{ $t('landing.docs.storage.wizardStep1Part2') }} <strong>Migrate Storage</strong></li>
                <li>{{ $t('landing.docs.storage.wizardStep2') }}</li>
                <li>{{ $t('landing.docs.storage.wizardStep3Part1') }} <strong>Start Migration</strong></li>
                <li>{{ $t('landing.docs.storage.wizardStep4Part1') }} <strong>{{ $t('landing.docs.storage.pause') }}</strong> {{ $t('landing.docs.storage.and') }} <strong>{{ $t('landing.docs.storage.resume') }}</strong> {{ $t('landing.docs.storage.wizardStep4Part2') }}</li>
                <li>{{ $t('landing.docs.storage.wizardStep5Part1') }} <strong>Rollback</strong> {{ $t('landing.docs.storage.wizardStep5Part2') }}</li>
              </ol>

              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                <strong>{{ $t('landing.docs.storage.tipLabel') }}</strong> {{ $t('landing.docs.storage.migrationTip') }}
              </p>
            </div>
          </section>

          <!-- Networking -->
          <section id="networking" data-section="networking" class="mb-16">
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{{ $t('landing.docs.networking.title') }}</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              {{ $t('landing.docs.networking.intro') }}
            </p>

            <!-- Required Ports -->
            <div id="networking-ports" data-section="networking-ports" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('landing.docs.networking.requiredPortsTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('landing.docs.networking.requiredPortsDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.networking.publicPortsTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.publicPortsDesc') }}</p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.networking.portHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.networking.protocolHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.networking.serviceHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.networking.descriptionHeader') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">22</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">SSH</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.sshDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">80</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">HTTP</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.httpDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">443</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">HTTPS</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.httpsDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">2222</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">SFTP</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.sftpDesc') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.networking.swarmPortsTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.swarmPortsDesc') }}</p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.networking.portHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.networking.protocolHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.networking.serviceHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.networking.descriptionHeader') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">2377</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('landing.docs.networking.swarmManagementService') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.swarmManagementDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">7946</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP + UDP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('landing.docs.networking.nodeDiscoveryService') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.nodeDiscoveryDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">4789</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">UDP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('landing.docs.networking.overlayNetworkService') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.overlayNetworkDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">2049</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">NFS</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.nfsDesc') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.networking.optionalStoragePortsTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.optionalStoragePortsDesc') }}</p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.networking.portHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.networking.protocolHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.networking.serviceHeader') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.networking.descriptionHeader') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">24007-24008</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">GlusterFS</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.glusterDaemonDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">49152-49251</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('landing.docs.networking.glusterBricksService') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.glusterBricksDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">6789</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('landing.docs.networking.cephMonitorService') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.cephMonitorDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">6800-7300</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">Ceph OSD</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.cephOsdDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">9000</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">MinIO API</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.minioApiDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">9001</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">{{ $t('landing.docs.networking.minioConsoleService') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.networking.minioConsoleDesc') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Firewall Setup -->
            <div id="networking-firewall" data-section="networking-firewall" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('landing.docs.networking.firewallTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('landing.docs.networking.firewallDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.networking.ufwTitle') }}</h3>
              <div class="mt-3">
                <CodeBlock :code="`# Public ports\nsudo ufw allow 22/tcp    # SSH\nsudo ufw allow 80/tcp    # HTTP\nsudo ufw allow 443/tcp   # HTTPS\nsudo ufw allow 2222/tcp  # SFTP\n\n# Swarm ports (restrict to your node IPs in production)\nsudo ufw allow 2377/tcp  # Swarm management\nsudo ufw allow 7946/tcp  # Node discovery\nsudo ufw allow 7946/udp  # Node discovery\nsudo ufw allow 4789/udp  # Overlay network\nsudo ufw allow 2049/tcp  # NFS\n\nsudo ufw reload`" />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.networking.firewalldTitle') }}</h3>
              <div class="mt-3">
                <CodeBlock :code="`sudo firewall-cmd --permanent --add-port=22/tcp\nsudo firewall-cmd --permanent --add-port=80/tcp\nsudo firewall-cmd --permanent --add-port=443/tcp\nsudo firewall-cmd --permanent --add-port=2222/tcp\nsudo firewall-cmd --permanent --add-port=2377/tcp\nsudo firewall-cmd --permanent --add-port=7946/tcp\nsudo firewall-cmd --permanent --add-port=7946/udp\nsudo firewall-cmd --permanent --add-port=4789/udp\nsudo firewall-cmd --permanent --add-port=2049/tcp\nsudo firewall-cmd --reload`" />
              </div>

              <p class="mt-6 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                <strong>{{ $t('landing.docs.networking.securityTipLabel') }}</strong> {{ $t('landing.docs.networking.securityTipPart1') }} <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">ufw allow from &lt;NODE_IP&gt; to any port 2377</code> {{ $t('landing.docs.networking.securityTipPart2') }}
              </p>
            </div>

            <!-- SFTP Access -->
            <div id="networking-sftp" data-section="networking-sftp" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('landing.docs.networking.sftpAccessTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('landing.docs.networking.sftpAccessDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.networking.howItWorksTitle') }}</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.networking.sftpHowItem1Part1') }} <strong>2222</strong> {{ $t('landing.docs.networking.sftpHowItem1Part2') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.networking.sftpHowItem2Part1') }} <strong>{{ $t('landing.docs.networking.apiKeys') }}</strong> — {{ $t('landing.docs.networking.sftpHowItem2Part2') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.networking.sftpHowItem3Part1') }} <strong>{{ $t('landing.docs.networking.chrooted') }}</strong> {{ $t('landing.docs.networking.sftpHowItem3Part2') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.networking.sftpHowItem4') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.networking.sftpHowItem5Part1') }} <strong>{{ $t('landing.docs.networking.concurrentConnections') }}</strong> {{ $t('landing.docs.networking.sftpHowItem5Part2') }} <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">SFTP_MAX_CONNECTIONS</code>)</span>
                </li>
              </ul>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.networking.connectingTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.networking.connectingDescPart1') }} <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">accountId/serviceId</code> {{ $t('landing.docs.networking.connectingDescPart2') }}
              </p>
              <div class="mt-3">
                <CodeBlock :code="`# Command-line SFTP\nsftp -P 2222 ACCOUNT_ID/SERVICE_ID@your-server.com\n\n# When prompted for password, enter your API key`" />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.networking.securityTitle') }}</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>{{ $t('landing.docs.networking.perAccountIsolationLabel') }}</strong> {{ $t('landing.docs.networking.perAccountIsolationDesc') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>{{ $t('landing.docs.networking.bruteForceLabel') }}</strong> {{ $t('landing.docs.networking.bruteForceDesc') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>{{ $t('landing.docs.networking.connectionLimitsLabel') }}</strong> {{ $t('landing.docs.networking.connectionLimitsDesc') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>{{ $t('landing.docs.networking.sshEncryptionLabel') }}</strong> {{ $t('landing.docs.networking.sshEncryptionDesc') }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>{{ $t('landing.docs.networking.apiKeyAuthLabel') }}</strong> {{ $t('landing.docs.networking.apiKeyAuthDesc') }}</span>
                </li>
              </ul>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.networking.disablingSftpTitle') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.networking.disablingSftpDesc') }}
              </p>
              <div class="mt-3">
                <CodeBlock code="SFTP_ENABLED=false" />
              </div>
            </div>
          </section>

          <!-- Integrations -->
          <section id="integrations" data-section="integrations" class="mb-16">
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{{ $t('landing.docs.integrationsTitle') }}</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              {{ $t('landing.docs.integrationsIntro') }}
            </p>

            <!-- Deploy Button -->
            <div id="deploy-button" data-section="deploy-button" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('landing.docs.deployButtonTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('landing.docs.deployButtonDesc') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.quickStart') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('landing.docs.addToReadme') }}</p>
              <div class="mt-3">
                <CodeBlock :code="`[![Deploy on Siglar](https://your-landing-site.com/deploy-button.svg)](https://your-dashboard.com/deploy/gh?repo=owner/repo)`" />
              </div>
              <p class="mt-3 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.replaceUrls', { landingSite: 'your-landing-site.com', dashboard: 'your-dashboard.com' }) }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.urlParameters') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.urlParamsDesc') }}
              </p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.parameter') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.required') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.description') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">repo</td>
                      <td class="px-4 py-3 text-red-500">{{ $t('landing.docs.yes') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.paramRepoDesc', { format: 'owner/repo' }) }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">branch</td>
                      <td class="px-4 py-3 text-surface-500">{{ $t('landing.docs.no') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.paramBranchDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">name</td>
                      <td class="px-4 py-3 text-surface-500">{{ $t('landing.docs.no') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.paramNameDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">env[KEY]</td>
                      <td class="px-4 py-3 text-surface-500">{{ $t('landing.docs.no') }}</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.paramEnvDesc', { format: 'env[KEY]=value' }) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.howItWorks') }}</h3>
              <ol class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300 list-decimal pl-5">
                <li>{{ $t('landing.docs.howStep1') }}</li>
                <li>{{ $t('landing.docs.howStep2', { file: 'siglar.json' }) }}</li>
                <li>{{ $t('landing.docs.howStep3') }}</li>
                <li>{{ $t('landing.docs.howStep4') }}</li>
              </ol>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                {{ $t('landing.docs.howNote') }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.examples') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ $t('landing.docs.basicDeployButton') }}</p>
              <div class="mt-3">
                <CodeBlock code="https://your-dashboard.com/deploy/gh?repo=myorg/my-app" />
              </div>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400">{{ $t('landing.docs.withBranchAndEnv') }}</p>
              <div class="mt-3">
                <CodeBlock code="https://your-dashboard.com/deploy/gh?repo=myorg/my-app&branch=stable&env[NODE_ENV]=production&env[PORT]=3000" />
              </div>
            </div>

            <!-- siglar.json Reference -->
            <div id="fleet-json" data-section="fleet-json" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('landing.docs.fleetJsonTitle') }}</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                {{ $t('landing.docs.fleetJsonDesc', { file: 'siglar.json' }) }}
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.fullExample') }}</h3>
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

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.topLevelFields') }}</h3>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.field') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.type') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.description') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">name</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.fieldNameDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">description</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.fieldDescriptionDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">icon</td>
                      <td class="px-4 py-3 text-surface-500">url</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.fieldIconDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">website</td>
                      <td class="px-4 py-3 text-surface-500">url</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.fieldWebsiteDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">env</td>
                      <td class="px-4 py-3 text-surface-500">object</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.fieldEnvDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">ports</td>
                      <td class="px-4 py-3 text-surface-500">array</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.fieldPortsDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">buildFile</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.fieldBuildFileDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">branch</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.fieldBranchDesc') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.environmentVariables') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.envVarsDesc', { env: 'env' }) }}
              </p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.property') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.type') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.description') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">description</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.propDescriptionDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">value</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.propValueDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">required</td>
                      <td class="px-4 py-3 text-surface-500">boolean</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.propRequiredDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">generate</td>
                      <td class="px-4 py-3 text-surface-500">boolean</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.propGenerateDesc') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.portMappings') }}</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                {{ $t('landing.docs.portMappingsDesc', { ports: 'ports' }) }}
              </p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.property') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.type') }}</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.description') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">target</td>
                      <td class="px-4 py-3 text-surface-500">number</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.propTargetDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">published</td>
                      <td class="px-4 py-3 text-surface-500">number</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.propPublishedDesc') }}</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">protocol</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.propProtocolDesc', { tcp: 'tcp', udp: 'udp' }) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.realWorldExamples') }}</h3>

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

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">{{ $t('landing.docs.bestPractices') }}</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.bestPractice1', { code: 'generate: true' }) }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.bestPractice2', { code: 'description' }) }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.bestPractice3', { code: 'required: false' }) }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>{{ $t('landing.docs.bestPractice4', { code: 'Dockerfile' }) }}</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  <span>{{ $t('landing.docs.bestPracticeNo1', { code: 'siglar.json' }) }}</span>
                </li>
              </ul>
            </div>
          </section>

          <!-- Configuration -->
          <section id="configuration" data-section="configuration" class="mb-16">
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{{ $t('landing.docs.configuration') }}</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              {{ $t('landing.docs.configIntro') }}
            </p>

            <div class="mt-8 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
              <table class="w-full text-sm">
                <thead class="bg-surface-50 dark:bg-surface-900/80">
                  <tr>
                    <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.variable') }}</th>
                    <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.description') }}</th>
                    <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">{{ $t('landing.docs.default') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">DB_DIALECT</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.configDbDialect') }}</td>
                    <td class="px-4 py-3 text-surface-500">sqlite</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">DATABASE_URL</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.configDatabaseUrl') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">JWT_SECRET</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.configJwtSecret') }}</td>
                    <td class="px-4 py-3 text-surface-500">{{ $t('landing.docs.configAutoGen') }}</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">NODE_AUTH_TOKEN</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.configNodeAuthToken') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">STRIPE_SECRET_KEY</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.configStripeSecret') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">STRIPE_WEBHOOK_SECRET</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.configStripeWebhook') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">VALKEY_URL</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.configValkeyUrl') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">NFS_SERVER</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.configNfsServer') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">NFS_PATH</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.configNfsPath') }}</td>
                    <td class="px-4 py-3 text-surface-500">/fleet-data</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">PLATFORM_DOMAIN</td>
                    <td class="px-4 py-3 text-surface-500 dark:text-surface-400">{{ $t('landing.docs.configPlatformDomain') }}</td>
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

    <LandingFooter />
  </div>
</template>
