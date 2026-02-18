<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
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

function navigateTo(id: string) {
  activeSection.value = id
  sidebarOpen.value = false
  const el = document.getElementById(id)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
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
  // If URL has a hash, scroll to it
  if (window.location.hash) {
    const id = window.location.hash.slice(1)
    setTimeout(() => navigateTo(id), 100)
  }
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <div class="min-h-screen bg-surface-950 text-surface-200">
    <TheNavbar :nav-links="navLinks" :dashboard-url="dashboardUrl" />

    <div class="mx-auto max-w-7xl px-4 pt-24 pb-16 sm:px-6 lg:px-8">
      <div class="lg:grid lg:grid-cols-[240px_1fr] lg:gap-12">
        <!-- Mobile sidebar toggle -->
        <button
          class="mb-6 flex items-center gap-2 rounded-lg border border-surface-800 bg-surface-900/50 px-4 py-2 text-sm text-surface-400 lg:hidden"
          @click="sidebarOpen = !sidebarOpen"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          {{ $t('docs.navigation') }}
        </button>

        <!-- Sidebar -->
        <aside
          :class="[
            'lg:block lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)] lg:overflow-y-auto',
            sidebarOpen ? 'mb-8 block' : 'hidden',
          ]"
        >
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
            <h1 class="text-3xl font-bold text-white sm:text-4xl">{{ $t('docs.gettingStarted') }}</h1>
            <p class="mt-4 text-lg text-surface-400">
              {{ $t('docs.gettingStartedIntro') }}
            </p>

            <!-- Prerequisites -->
            <div id="prerequisites" data-section="prerequisites" class="mt-12">
              <h2 class="text-2xl font-bold text-white">{{ $t('docs.prerequisites') }}</h2>
              <ul class="mt-4 space-y-2 text-surface-300">
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
              <p class="mt-4 text-sm text-surface-400 rounded-lg border border-surface-800 bg-surface-900/50 px-4 py-3">
                {{ $t('docs.prereqNote') }}
              </p>
            </div>

            <!-- Installation -->
            <div id="installation" data-section="installation" class="mt-12">
              <h2 class="text-2xl font-bold text-white">{{ $t('docs.installation') }}</h2>
              <p class="mt-4 text-surface-400">
                {{ $t('docs.installScript') }}
              </p>
              <div class="mt-4">
                <CodeBlock code="curl -fsSL https://get.fleethost.io | bash" />
              </div>
              <p class="mt-4 text-surface-400">
                {{ $t('docs.installManual') }}
              </p>
              <div class="mt-4">
                <CodeBlock :code="`git clone https://github.com/fleet/fleet.git\ncd fleet\npnpm install\npnpm build`" />
              </div>
              <p class="mt-4 text-surface-400">
                {{ $t('docs.installCli') }}
              </p>
              <div class="mt-4">
                <CodeBlock code="npm install -g @fleet/cli" />
              </div>
            </div>

            <!-- First Deploy -->
            <div id="first-deploy" data-section="first-deploy" class="mt-12">
              <h2 class="text-2xl font-bold text-white">{{ $t('docs.firstDeploy') }}</h2>
              <p class="mt-4 text-surface-400">
                {{ $t('docs.initCluster') }}
              </p>
              <div class="mt-4">
                <CodeBlock code="fleet init --domain panel.example.com --email admin@example.com" />
              </div>
              <p class="mt-4 text-surface-400">
                {{ $t('docs.loginCli') }}
              </p>
              <div class="mt-4">
                <CodeBlock :code="`fleet login --api-url https://panel.example.com`" />
              </div>
              <p class="mt-4 text-surface-400">
                {{ $t('docs.deployFirst') }}
              </p>
              <div class="mt-4">
                <CodeBlock :code="`fleet deploy --name my-app --image node:20`" />
              </div>
              <p class="mt-4 text-surface-400">
                {{ $t('docs.deployDone') }}
              </p>
            </div>
          </section>

          <!-- CLI Reference -->
          <section id="cli-reference" data-section="cli-reference" class="mb-16">
            <h1 class="text-3xl font-bold text-white sm:text-4xl">{{ $t('docs.cliReference') }}</h1>
            <p class="mt-4 text-lg text-surface-400">
              {{ $t('docs.cliReferenceIntro') }}
            </p>

            <div
              v-for="group in commandGroups"
              :key="group.id"
              :id="group.id"
              :data-section="group.id"
              class="mt-12"
            >
              <h2 class="text-2xl font-bold text-white">{{ $t(group.titleKey) }}</h2>
              <p class="mt-2 text-surface-400">{{ $t(group.descriptionKey) }}</p>

              <div class="mt-6 space-y-8">
                <div
                  v-for="cmd in group.commands"
                  :key="cmd.name"
                  class="rounded-xl border border-surface-800 bg-surface-900/50 p-6"
                >
                  <h3 class="font-mono text-lg font-semibold text-white">{{ cmd.name }}</h3>
                  <p class="mt-2 text-sm text-surface-400">{{ $t(cmd.descriptionKey) }}</p>

                  <div class="mt-4">
                    <p class="text-xs font-semibold uppercase tracking-wider text-surface-500">{{ $t('docs.usage') }}</p>
                    <code class="mt-1 block rounded bg-surface-800/50 px-3 py-2 font-mono text-sm text-surface-300">
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
                        <code class="shrink-0 rounded bg-surface-800/50 px-2 py-0.5 font-mono text-primary-400">
                          {{ flag.flag }}
                        </code>
                        <span class="text-surface-400">
                          {{ $t(flag.descriptionKey) }}
                          <span v-if="flag.required" class="text-red-400">{{ $t('docs.required') }}</span>
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

          <!-- Configuration -->
          <section id="configuration" data-section="configuration" class="mb-16">
            <h1 class="text-3xl font-bold text-white sm:text-4xl">{{ $t('docs.configuration') }}</h1>
            <p class="mt-4 text-lg text-surface-400">
              {{ $t('docs.configIntro') }}
            </p>

            <div class="mt-8 overflow-hidden rounded-xl border border-surface-800">
              <table class="w-full text-sm">
                <thead class="bg-surface-900/80">
                  <tr>
                    <th class="px-4 py-3 text-left font-semibold text-surface-300">{{ $t('docs.variable') }}</th>
                    <th class="px-4 py-3 text-left font-semibold text-surface-300">{{ $t('docs.description') }}</th>
                    <th class="px-4 py-3 text-left font-semibold text-surface-300">{{ $t('docs.default') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-surface-800">
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-400">DB_DIALECT</td>
                    <td class="px-4 py-3 text-surface-400">{{ $t('docs.configDbDialect') }}</td>
                    <td class="px-4 py-3 text-surface-500">sqlite</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-400">DATABASE_URL</td>
                    <td class="px-4 py-3 text-surface-400">{{ $t('docs.configDatabaseUrl') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-400">JWT_SECRET</td>
                    <td class="px-4 py-3 text-surface-400">{{ $t('docs.configJwtSecret') }}</td>
                    <td class="px-4 py-3 text-surface-500">{{ $t('docs.configAutoGen') }}</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-400">NODE_AUTH_TOKEN</td>
                    <td class="px-4 py-3 text-surface-400">{{ $t('docs.configNodeAuthToken') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-400">STRIPE_SECRET_KEY</td>
                    <td class="px-4 py-3 text-surface-400">{{ $t('docs.configStripeSecret') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-400">STRIPE_WEBHOOK_SECRET</td>
                    <td class="px-4 py-3 text-surface-400">{{ $t('docs.configStripeWebhook') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-400">VALKEY_URL</td>
                    <td class="px-4 py-3 text-surface-400">{{ $t('docs.configValkeyUrl') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-400">NFS_SERVER</td>
                    <td class="px-4 py-3 text-surface-400">{{ $t('docs.configNfsServer') }}</td>
                    <td class="px-4 py-3 text-surface-500">-</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-400">NFS_PATH</td>
                    <td class="px-4 py-3 text-surface-400">{{ $t('docs.configNfsPath') }}</td>
                    <td class="px-4 py-3 text-surface-500">/fleet-data</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 font-mono text-primary-400">PLATFORM_DOMAIN</td>
                    <td class="px-4 py-3 text-surface-400">{{ $t('docs.configPlatformDomain') }}</td>
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
