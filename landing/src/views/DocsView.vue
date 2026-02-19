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
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">Distributed Storage</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              Fleet includes a production-grade distributed storage system that replicates data across multiple nodes with automatic failover and self-healing. This guide covers provider selection, node setup, hardware recommendations, and data migration.
            </p>

            <!-- Overview -->
            <div id="storage-overview" data-section="storage-overview" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Overview</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                Fleet's storage system handles two categories of data through a unified provider abstraction:
              </p>
              <div class="mt-6 grid gap-4 sm:grid-cols-2">
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h3 class="font-semibold text-gray-900 dark:text-white">Volume Storage (POSIX)</h3>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    Block or filesystem storage that mounts directly into Docker containers. Used for persistent application data, databases, and user files. Providers: <strong>Local/NFS</strong>, <strong>GlusterFS</strong>, <strong>Ceph RBD</strong>.
                  </p>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h3 class="font-semibold text-gray-900 dark:text-white">Object Storage (S3-compatible)</h3>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    Key-value blob storage for uploads, backups, and build artifacts. Providers: <strong>Local filesystem</strong>, <strong>MinIO</strong>, <strong>AWS S3</strong>, <strong>Google Cloud Storage</strong>.
                  </p>
                </div>
              </div>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400">
                By default, Fleet uses <strong>local storage</strong> (single-node NFS for volumes, filesystem for objects). This is ideal for development and single-server deployments. For production, switch to a distributed provider to get replication, failover, and self-healing.
              </p>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                All existing services continue working when you switch providers. Fleet's storage manager abstracts the underlying provider, so volume mounts, backups, and uploads work identically regardless of the backend.
              </p>
            </div>

            <!-- Providers -->
            <div id="storage-providers" data-section="storage-providers" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Storage Providers</h2>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Volume Providers</h3>

              <div class="mt-4 space-y-4">
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <div class="flex items-center gap-2">
                    <span class="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">Default</span>
                    <h4 class="font-semibold text-gray-900 dark:text-white">Local / NFS</h4>
                  </div>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    Single-node storage using the local filesystem and NFS exports. No replication. Best for development, testing, and single-server deployments.
                  </p>
                </div>

                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <div class="flex items-center gap-2">
                    <span class="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">Recommended</span>
                    <h4 class="font-semibold text-gray-900 dark:text-white">GlusterFS</h4>
                  </div>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    Distributed replicated filesystem. Data is mirrored across 2-3 nodes automatically. POSIX-compatible, auto-heals when a node recovers, and integrates with Docker via the GlusterFS volume plugin. Ideal for bare metal servers and cloud VMs.
                  </p>
                  <ul class="mt-3 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      2- or 3-way replication across nodes
                    </li>
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      Automatic self-healing when nodes recover
                    </li>
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      Same stack on cloud VMs and bare metal (no vendor lock-in)
                    </li>
                  </ul>
                </div>

                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <div class="flex items-center gap-2">
                    <span class="inline-flex items-center rounded-full bg-purple-100 dark:bg-purple-900/30 px-2.5 py-0.5 text-xs font-medium text-purple-700 dark:text-purple-300">Enterprise</span>
                    <h4 class="font-semibold text-gray-900 dark:text-white">Ceph RBD</h4>
                  </div>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    Enterprise-grade block storage built on Ceph RADOS. Scales to exabytes with erasure coding, thin provisioning, and snapshots. Best for large-scale datacenter deployments with dedicated storage infrastructure.
                  </p>
                  <ul class="mt-3 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      Scales from terabytes to exabytes
                    </li>
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      Point-in-time snapshots and rollback
                    </li>
                    <li class="flex items-start gap-2">
                      <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                      Erasure coding for storage efficiency
                    </li>
                  </ul>
                </div>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Object Providers</h3>

              <div class="mt-4 space-y-4">
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">MinIO (Self-hosted)</h4>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    S3-compatible object storage that runs on your own nodes. Supports distributed mode with erasure coding across multiple disks/nodes. No vendor lock-in, full data sovereignty.
                  </p>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">AWS S3</h4>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    Amazon S3 or any S3-compatible service (Backblaze B2, Wasabi, DigitalOcean Spaces, Cloudflare R2). Uses the official AWS SDK. Supports custom endpoints for S3-compatible providers.
                  </p>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">Google Cloud Storage</h4>
                  <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                    Native Google Cloud Storage integration. Supports workload identity (no key file needed on GCP VMs) and service account authentication. Multi-region and single-region storage classes.
                  </p>
                </div>
              </div>
            </div>

            <!-- Node Setup -->
            <div id="storage-node-setup" data-section="storage-node-setup" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Storage Node Setup</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                Each node in your storage cluster needs the appropriate provider software installed. Fleet provides an automated setup script that handles installation, firewall rules, and kernel tuning.
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Quick Install</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">Run on each node that will participate in the storage cluster:</p>
              <div class="mt-3">
                <CodeBlock code="curl -fsSL https://raw.githubusercontent.com/componentor/fleet/main/install/storage-node.sh | sudo bash" />
              </div>
              <p class="mt-3 text-sm text-surface-500 dark:text-surface-400">The interactive installer will prompt you to choose a provider. Or specify options directly:</p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">GlusterFS Setup</h3>
              <div class="mt-3">
                <CodeBlock :code="`# On each storage node:\nsudo bash storage-node.sh --provider glusterfs --data-path /srv/fleet-storage\n\n# After all nodes are ready, peer probe from any one node:\nsudo gluster peer probe 10.0.1.11\nsudo gluster peer probe 10.0.1.12\n\n# Verify the trusted pool:\nsudo gluster peer status`" />
              </div>
              <p class="mt-3 text-sm text-surface-500 dark:text-surface-400">
                The script installs GlusterFS, creates the brick directory, starts the daemon, configures firewall rules (ports 24007-24008, 49152-49251), and installs the Docker GlusterFS volume plugin.
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Ceph Setup</h3>
              <div class="mt-3">
                <CodeBlock :code="`# Install Ceph client tools on each node:\nsudo bash storage-node.sh --provider ceph --monitors 10.0.1.10,10.0.1.11,10.0.1.12\n\n# The script creates /etc/ceph/ceph.conf and loads the rbd kernel module.\n# You still need a running Ceph cluster — deploy with cephadm or similar.`" />
              </div>
              <p class="mt-3 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                <strong>Note:</strong> This script installs the Ceph client tools (rbd, ceph CLI). A full Ceph cluster requires separate deployment using <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">cephadm</code>, <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">ceph-deploy</code>, or Rook (for Kubernetes). Fleet connects to an existing Ceph cluster via the monitor addresses and keyring.
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">MinIO Setup</h3>
              <div class="mt-3">
                <CodeBlock :code="`# Install MinIO on each storage node:\nsudo bash storage-node.sh --provider minio --data-path /srv/fleet-objects\n\n# The script generates access keys, creates a systemd service,\n# and starts MinIO on port 9000 (API) / 9001 (console).\n# Credentials are saved to /etc/minio/minio.env`" />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Install Everything</h3>
              <div class="mt-3">
                <CodeBlock code="sudo bash storage-node.sh --provider all --data-path /srv/fleet-storage" />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Script Options</h3>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Flag</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Description</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Default</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--provider</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Provider to install: glusterfs, ceph, minio, or all</td>
                      <td class="px-4 py-3 text-surface-500">interactive</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--data-path</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Base directory for storage data</td>
                      <td class="px-4 py-3 text-surface-500">/srv/fleet-storage</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--monitors</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Ceph monitor addresses (comma-separated)</td>
                      <td class="px-4 py-3 text-surface-500">-</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--minio-port</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">MinIO API listen port</td>
                      <td class="px-4 py-3 text-surface-500">9000</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">--skip-firewall</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Skip automatic firewall rule configuration</td>
                      <td class="px-4 py-3 text-surface-500">false</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">After Installation</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">Once storage software is installed on all nodes:</p>
              <ol class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300 list-decimal pl-5">
                <li>Go to your Fleet admin panel → <strong>Storage</strong> → <strong>Configure Storage</strong></li>
                <li>Select <strong>Distributed Cluster</strong> and choose your volume/object providers</li>
                <li>Add each storage node's hostname and IP address</li>
                <li>Run the connectivity test to verify all nodes are reachable</li>
                <li>Click <strong>Initialize</strong> to form the cluster and create the trusted storage pool</li>
                <li>Optionally migrate existing data from local storage</li>
              </ol>
            </div>

            <!-- Hardware Specs -->
            <div id="storage-specs" data-section="storage-specs" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Hardware Recommendations</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                Storage node performance depends heavily on disk I/O and network throughput. Below are recommendations for different deployment scales.
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Minimum Requirements</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                The absolute minimum for a 3-node distributed storage cluster:
              </p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Component</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Minimum</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Recommended</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">CPU</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">2 cores</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">4+ cores</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">RAM</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">4 GB</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">8+ GB</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">Storage</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">50 GB SSD</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">200+ GB NVMe SSD</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">Network</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">1 Gbps</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">10 Gbps</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">Nodes</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">3</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">3+ (odd number)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Scaling Guidelines</h3>

              <div class="mt-4 space-y-4">
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">Small (up to 100 tenants, ~1 TB)</h4>
                  <ul class="mt-2 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li>3 nodes, 4 cores / 8 GB RAM each</li>
                    <li>500 GB NVMe SSD per node</li>
                    <li>1 Gbps network</li>
                    <li>GlusterFS with replica-3 + MinIO on same nodes</li>
                    <li>Shared storage + compute nodes are fine at this scale</li>
                  </ul>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">Medium (100-1,000 tenants, ~10 TB)</h4>
                  <ul class="mt-2 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li>5-7 nodes, 8 cores / 16 GB RAM each</li>
                    <li>1-2 TB NVMe SSD per node</li>
                    <li>10 Gbps network (bonded or dedicated storage VLAN)</li>
                    <li>GlusterFS or Ceph + MinIO or S3</li>
                    <li>Dedicated storage nodes recommended for I/O performance</li>
                  </ul>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">Large (1,000+ tenants, 100+ TB)</h4>
                  <ul class="mt-2 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li>10+ dedicated storage nodes, 16+ cores / 32+ GB RAM each</li>
                    <li>4-8 TB NVMe SSD or HDD (with SSD journal) per node</li>
                    <li>25 Gbps or higher, dedicated storage network</li>
                    <li>Ceph RBD strongly recommended (erasure coding reduces storage overhead)</li>
                    <li>Cloud object storage (S3/GCS) for backups and cold data</li>
                    <li>Separate monitor and OSD nodes for Ceph</li>
                  </ul>
                </div>
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h4 class="font-semibold text-gray-900 dark:text-white">Petabyte+ Scale</h4>
                  <ul class="mt-2 space-y-1 text-sm text-surface-500 dark:text-surface-400">
                    <li>Ceph is the only volume provider that scales to this level</li>
                    <li>50+ OSD nodes with high-density disk shelves (JBOD)</li>
                    <li>Dedicated 100 Gbps storage fabric</li>
                    <li>3-5 dedicated Ceph monitor + manager nodes</li>
                    <li>Erasure coding profiles (e.g., 4+2) to reduce replication overhead from 3x to 1.5x</li>
                    <li>Use cloud object storage (S3/GCS) for archival and cross-region replication</li>
                  </ul>
                </div>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Disk Selection Tips</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>NVMe SSD</strong> — Best overall performance. Use for volumes that serve databases or high-IOPS workloads.</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>SATA SSD</strong> — Good for general-purpose storage. Sufficient for most application volumes and object storage.</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>HDD with SSD journal</strong> — Cost-effective for large capacity. Use for backups, cold storage, and archival. Add a small SSD for the Ceph OSD journal/WAL to improve write performance.</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>Avoid mixing disk types</strong> within a Ceph pool — performance bottlenecks occur when fast and slow disks share a pool.</span>
                </li>
              </ul>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Network Considerations</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>Storage replication is network-intensive. A dedicated storage VLAN or separate NIC is strongly recommended for clusters with 5+ nodes.</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>Keep storage nodes in the same datacenter or availability zone. Cross-region replication should use object storage (S3/GCS), not volume replication.</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>Latency between storage nodes should be under 1ms. Storage performance degrades rapidly above 5ms round-trip latency.</span>
                </li>
              </ul>
            </div>

            <!-- Migration -->
            <div id="storage-migration" data-section="storage-migration" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Data Migration</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                Fleet supports zero-downtime migration between any storage providers. You can migrate from local to distributed, between distributed providers, or from cloud to self-hosted (and vice versa).
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">How Migration Works</h3>
              <ol class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300 list-decimal pl-5">
                <li><strong>Inventory</strong> — Fleet scans all existing volumes, uploads, and backups to calculate the total migration scope.</li>
                <li><strong>Copy</strong> — Data is streamed from the source provider to the destination provider. Volumes are copied via rsync/direct copy, objects are streamed bucket-by-bucket.</li>
                <li><strong>Verify</strong> — Checksums are compared between source and destination to ensure data integrity.</li>
                <li><strong>Switchover</strong> — The active provider is atomically switched to the new destination. Services experience a brief pause (typically under 5 seconds) during switchover.</li>
                <li><strong>Cleanup</strong> — After a configurable grace period, data on the old provider can be removed.</li>
              </ol>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Using the Migration Wizard</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                The easiest way to migrate is through the admin panel:
              </p>
              <ol class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300 list-decimal pl-5">
                <li>Go to <strong>Storage</strong> → click <strong>Migrate Storage</strong></li>
                <li>Select your target volume and object providers</li>
                <li>Review the migration summary and click <strong>Start Migration</strong></li>
                <li>Monitor progress in real-time — you can <strong>pause</strong> and <strong>resume</strong> at any time</li>
                <li>After completion, verify everything is working. If needed, click <strong>Rollback</strong> to revert to the previous provider.</li>
              </ol>

              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                <strong>Tip:</strong> For large datasets (10+ TB), consider running the migration during off-peak hours. While services remain online during migration, the I/O overhead of copying data can impact performance on the source provider.
              </p>
            </div>
          </section>

          <!-- Networking -->
          <section id="networking" data-section="networking" class="mb-16">
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">Networking &amp; Ports</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              Fleet uses several network ports for communication between nodes, serving traffic, and providing file access. This guide covers which ports to open, firewall configuration, and SFTP access setup.
            </p>

            <!-- Required Ports -->
            <div id="networking-ports" data-section="networking-ports" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Required Ports</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                The following ports must be accessible for Fleet to operate correctly. Ports are categorized by their purpose.
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Public-facing Ports</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">These ports must be open to the internet (or to your users' networks):</p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Port</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Protocol</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Service</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Description</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">22</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">SSH</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Server management access</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">80</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">HTTP</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Web traffic (redirects to HTTPS)</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">443</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">HTTPS</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Secure web traffic, dashboard, and API</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">2222</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">SFTP</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Secure file transfer for upload-based services</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Swarm Cluster Ports (Internal)</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">These ports are used for node-to-node communication within the Docker Swarm cluster. They should only be open between your nodes, not to the public internet:</p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Port</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Protocol</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Service</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Description</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">2377</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">Swarm Management</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Docker Swarm cluster management and Raft consensus</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">7946</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP + UDP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">Node Discovery</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Container network discovery and gossip protocol</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">4789</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">UDP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">Overlay Network</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">VXLAN overlay network for cross-node container communication</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">2049</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">NFS</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Network File System for shared volume storage</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Optional Storage Ports (Internal)</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">Only needed if you use distributed storage providers:</p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Port</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Protocol</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Service</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Description</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">24007-24008</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">GlusterFS</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">GlusterFS daemon and management</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">49152-49251</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">GlusterFS Bricks</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">GlusterFS brick ports (one per brick)</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">6789</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">Ceph Monitor</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Ceph monitor daemon</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">6800-7300</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">Ceph OSD</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Ceph OSD daemons</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">9000</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">MinIO API</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">MinIO S3-compatible API</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">9001</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">TCP</td>
                      <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">MinIO Console</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">MinIO web console</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Firewall Setup -->
            <div id="networking-firewall" data-section="networking-firewall" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Firewall Setup</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                The Fleet install script automatically configures firewall rules for the required ports. If you need to set them up manually, use the commands below.
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">UFW (Ubuntu/Debian)</h3>
              <div class="mt-3">
                <CodeBlock :code="`# Public ports\nsudo ufw allow 22/tcp    # SSH\nsudo ufw allow 80/tcp    # HTTP\nsudo ufw allow 443/tcp   # HTTPS\nsudo ufw allow 2222/tcp  # SFTP\n\n# Swarm ports (restrict to your node IPs in production)\nsudo ufw allow 2377/tcp  # Swarm management\nsudo ufw allow 7946/tcp  # Node discovery\nsudo ufw allow 7946/udp  # Node discovery\nsudo ufw allow 4789/udp  # Overlay network\nsudo ufw allow 2049/tcp  # NFS\n\nsudo ufw reload`" />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">firewalld (RHEL/CentOS/Fedora)</h3>
              <div class="mt-3">
                <CodeBlock :code="`sudo firewall-cmd --permanent --add-port=22/tcp\nsudo firewall-cmd --permanent --add-port=80/tcp\nsudo firewall-cmd --permanent --add-port=443/tcp\nsudo firewall-cmd --permanent --add-port=2222/tcp\nsudo firewall-cmd --permanent --add-port=2377/tcp\nsudo firewall-cmd --permanent --add-port=7946/tcp\nsudo firewall-cmd --permanent --add-port=7946/udp\nsudo firewall-cmd --permanent --add-port=4789/udp\nsudo firewall-cmd --permanent --add-port=2049/tcp\nsudo firewall-cmd --reload`" />
              </div>

              <p class="mt-6 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                <strong>Security tip:</strong> For production deployments, restrict Swarm ports (2377, 7946, 4789) and NFS (2049) to only your cluster node IPs rather than opening them to all traffic. Use <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">ufw allow from &lt;NODE_IP&gt; to any port 2377</code> to restrict per-IP.
              </p>
            </div>

            <!-- SFTP Access -->
            <div id="networking-sftp" data-section="networking-sftp" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">SFTP Access</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                Fleet includes a built-in SFTP server that provides secure file access to services using custom upload (file-based deployment). Users can connect via any SFTP client to manage their uploaded files directly.
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">How It Works</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>SFTP server runs embedded in the Fleet API process on port <strong>2222</strong> (configurable)</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>Authentication uses <strong>API keys</strong> — the same keys used for the REST API and CLI</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>Each connection is <strong>chrooted</strong> to the specific service's upload directory — no cross-account or cross-service access</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>Built-in rate limiting on failed auth attempts and per-account connection limits protect against abuse</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>Supports up to <strong>10,000 concurrent connections</strong> by default (configurable via <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">SFTP_MAX_CONNECTIONS</code>)</span>
                </li>
              </ul>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Connecting</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                Use any SFTP client (FileZilla, WinSCP, Cyberduck, or the command line). The username format is <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">accountId/serviceId</code> and the password is your API key.
              </p>
              <div class="mt-3">
                <CodeBlock :code="`# Command-line SFTP\nsftp -P 2222 ACCOUNT_ID/SERVICE_ID@your-server.com\n\n# When prompted for password, enter your API key`" />
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Security</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>Per-account isolation:</strong> Each SFTP session is restricted to its service's upload directory. Path traversal is blocked.</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>Brute-force protection:</strong> After 10 failed login attempts from an IP within 60 seconds, further attempts are blocked for that IP.</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>Connection limits:</strong> Global limit of 10,000 connections and 100 per account (both configurable) prevent resource exhaustion.</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>SSH encryption:</strong> All traffic is encrypted via SSH (ed25519 host key, auto-generated on first startup).</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span><strong>API key auth:</strong> Passwords are verified against argon2-hashed API keys in the database. Expired keys are rejected.</span>
                </li>
              </ul>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Disabling SFTP</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                If you don't need SFTP access, disable it by setting the environment variable:
              </p>
              <div class="mt-3">
                <CodeBlock code="SFTP_ENABLED=false" />
              </div>
            </div>
          </section>

          <!-- Integrations -->
          <section id="integrations" data-section="integrations" class="mb-16">
            <h1 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">Integrations</h1>
            <p class="mt-4 text-lg text-surface-500 dark:text-surface-400">
              Add a "Deploy on Fleet" button to any GitHub repository. Users click the button, land on a pre-filled deploy form, and launch the service in a few clicks.
            </p>

            <!-- Deploy Button -->
            <div id="deploy-button" data-section="deploy-button" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Deploy Button</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                The deploy button is a badge that links to your Fleet instance's one-click deploy page. It works like Heroku, Vercel, or Railway deploy buttons.
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Quick Start</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">Add this to your repository's README:</p>
              <div class="mt-3">
                <CodeBlock :code="`[![Deploy on Fleet](https://your-landing-site.com/deploy-button.svg)](https://your-dashboard.com/deploy/gh?repo=owner/repo)`" />
              </div>
              <p class="mt-3 text-sm text-surface-500 dark:text-surface-400">
                Replace <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">your-landing-site.com</code> with your Fleet landing page URL and <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">your-dashboard.com</code> with your Fleet dashboard URL.
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">URL Parameters</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                The deploy URL supports the following query parameters:
              </p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Parameter</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Required</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Description</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">repo</td>
                      <td class="px-4 py-3 text-red-500">Yes</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">GitHub repo in <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">owner/repo</code> format</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">branch</td>
                      <td class="px-4 py-3 text-surface-500">No</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Branch to deploy. Falls back to fleet.json default, then the repo's default branch</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">name</td>
                      <td class="px-4 py-3 text-surface-500">No</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Pre-fill the service name</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">env[KEY]</td>
                      <td class="px-4 py-3 text-surface-500">No</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Pre-fill environment variables. Use multiple <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">env[KEY]=value</code> params for multiple variables</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">How It Works</h3>
              <ol class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300 list-decimal pl-5">
                <li>User clicks the deploy button in your README</li>
                <li>Fleet fetches <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">fleet.json</code> from your repo (if it exists) and pre-fills the deploy form</li>
                <li>User reviews the configuration, fills in any required env vars, and clicks Deploy</li>
                <li>Fleet creates the service, clones the repo, builds and deploys it</li>
              </ol>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 px-4 py-3">
                If the user is not logged in, they'll be redirected to the login page first, then returned to the deploy form after authentication.
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Examples</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">Basic deploy button:</p>
              <div class="mt-3">
                <CodeBlock code="https://your-dashboard.com/deploy/gh?repo=myorg/my-app" />
              </div>
              <p class="mt-4 text-sm text-surface-500 dark:text-surface-400">With branch and pre-filled env vars:</p>
              <div class="mt-3">
                <CodeBlock code="https://your-dashboard.com/deploy/gh?repo=myorg/my-app&branch=stable&env[NODE_ENV]=production&env[PORT]=3000" />
              </div>
            </div>

            <!-- fleet.json Reference -->
            <div id="fleet-json" data-section="fleet-json" class="mt-12">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white">fleet.json Reference</h2>
              <p class="mt-4 text-surface-600 dark:text-surface-300">
                The <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">fleet.json</code> file is an optional manifest placed in the root of your repository. When present, it enriches the deploy experience with metadata, environment variable descriptions, port configuration, and build settings.
              </p>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Full Example</h3>
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

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Top-Level Fields</h3>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Field</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Type</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Description</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">name</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Display name for the app (max 100 chars)</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">description</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Short description shown on the deploy page (max 500 chars)</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">icon</td>
                      <td class="px-4 py-3 text-surface-500">url</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">URL to an app icon displayed on the deploy page</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">website</td>
                      <td class="px-4 py-3 text-surface-500">url</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Link to the project's website</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">env</td>
                      <td class="px-4 py-3 text-surface-500">object</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Environment variable definitions (see below)</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">ports</td>
                      <td class="px-4 py-3 text-surface-500">array</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Port mappings for the service</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">buildFile</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Path to the Dockerfile or docker-compose.yml (max 200 chars)</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">branch</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Default branch to deploy if not specified in the URL</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Environment Variables</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                Each key in the <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">env</code> object maps to an environment variable. The value can be a plain string (used as the default value) or an object with the following properties:
              </p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Property</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Type</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Description</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">description</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Human-readable help text shown next to the input</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">value</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Default value (pre-filled, user can change)</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">required</td>
                      <td class="px-4 py-3 text-surface-500">boolean</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Whether the variable must be filled (default: true)</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">generate</td>
                      <td class="px-4 py-3 text-surface-500">boolean</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Auto-generate a random 32-byte hex string. Useful for secrets, tokens, and encryption keys</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Port Mappings</h3>
              <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
                Each entry in the <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">ports</code> array defines a port mapping:
              </p>
              <div class="mt-4 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
                <table class="w-full text-sm">
                  <thead class="bg-surface-50 dark:bg-surface-900/80">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Property</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Type</th>
                      <th class="px-4 py-3 text-left font-semibold text-surface-600 dark:text-surface-300">Description</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-surface-200 dark:divide-surface-800">
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">target</td>
                      <td class="px-4 py-3 text-surface-500">number</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Container port (required, 1-65535)</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">published</td>
                      <td class="px-4 py-3 text-surface-500">number</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400">Host port (optional, auto-assigned if omitted)</td>
                    </tr>
                    <tr>
                      <td class="px-4 py-3 font-mono text-primary-600 dark:text-primary-400">protocol</td>
                      <td class="px-4 py-3 text-surface-500">string</td>
                      <td class="px-4 py-3 text-surface-500 dark:text-surface-400"><code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">tcp</code> or <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">udp</code> (default: tcp)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Real-World Examples</h3>

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

              <h3 class="mt-8 text-lg font-semibold text-gray-900 dark:text-white">Best Practices</h3>
              <ul class="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>Use <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">generate: true</code> for secrets — never commit default secret values</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>Add <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">description</code> to every env var — it helps users understand what each variable does</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>Set <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">required: false</code> for optional env vars — all env vars are required by default</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                  <span>Always include a <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">Dockerfile</code> in your repo so Fleet can build and run it</span>
                </li>
                <li class="flex items-start gap-3">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  <span>Never put actual secret values in <code class="rounded bg-surface-100 dark:bg-surface-800/50 px-1.5 py-0.5 text-xs">fleet.json</code> — it's committed to your repo and publicly visible</span>
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
