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
