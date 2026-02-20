<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import TheNavbar from '@/components/TheNavbar.vue'
import type { NavLink } from '@/components/TheNavbar.vue'
import TheFooter from '@/components/TheFooter.vue'

const { t } = useI18n()

const dashboardUrl = import.meta.env.VITE_DASHBOARD_URL || 'http://localhost:5173'
const platformName = import.meta.env.VITE_PLATFORM_NAME || 'Fleet'
const contactEmail = import.meta.env.VITE_CONTACT_EMAIL || 'privacy@fleet.app'

const vars = { platformName, platformNameUpper: platformName.toUpperCase(), contactEmail }

const navLinks = computed<NavLink[]>(() => [
  { label: t('nav.home'), href: '/', routerLink: true },
  { label: 'Docs', href: '/docs', routerLink: true },
  { label: t('footer.terms'), href: '/terms', routerLink: true },
  { label: t('nav.github'), href: 'https://github.com/fleet', external: true },
])

const sections = computed(() => [
  { id: 'info-collect', title: t('privacy.infoCollect.title'), body: t('privacy.infoCollect.body') },
  { id: 'how-we-use', title: t('privacy.howWeUse.title'), body: t('privacy.howWeUse.body', vars) },
  { id: 'data-storage', title: t('privacy.dataStorage.title'), body: t('privacy.dataStorage.body') },
  { id: 'third-party', title: t('privacy.thirdParty.title'), body: t('privacy.thirdParty.body') },
  { id: 'data-retention', title: t('privacy.dataRetention.title'), body: t('privacy.dataRetention.body') },
  { id: 'your-rights', title: t('privacy.yourRights.title'), body: t('privacy.yourRights.body') },
  { id: 'cookies', title: t('privacy.cookies.title'), body: t('privacy.cookies.body') },
  { id: 'changes', title: t('privacy.changes.title'), body: t('privacy.changes.body', vars) },
  { id: 'contact', title: t('privacy.contact.title'), body: t('privacy.contact.body', vars) },
])
</script>

<template>
  <div class="min-h-screen bg-white dark:bg-surface-950 text-surface-700 dark:text-surface-200">
    <TheNavbar :nav-links="navLinks" :dashboard-url="dashboardUrl" :show-locale-switcher="true" />

    <main class="pt-32 pb-20 sm:pt-40 sm:pb-32">
      <div class="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <h1 class="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white sm:text-5xl">
          {{ $t('privacy.title') }}
        </h1>
        <p class="mt-4 text-sm text-surface-500">
          {{ $t('privacy.lastUpdated') }}
        </p>
        <p class="mt-6 text-lg leading-relaxed text-surface-600 dark:text-surface-300">
          {{ $t('privacy.intro', vars) }}
        </p>

        <div class="mt-12 space-y-12">
          <section v-for="section in sections" :key="section.id" :id="section.id">
            <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ section.title }}</h2>
            <p class="mt-4 leading-relaxed text-surface-600 dark:text-surface-300 whitespace-pre-line">{{ section.body }}</p>
          </section>
        </div>
      </div>
    </main>

    <TheFooter />
  </div>
</template>
