<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import TheNavbar from '@/components/TheNavbar.vue'
import type { NavLink } from '@/components/TheNavbar.vue'
import TheFooter from '@/components/TheFooter.vue'

const { t } = useI18n()

const dashboardUrl = import.meta.env.VITE_DASHBOARD_URL || 'http://localhost:5173'
const platformName = import.meta.env.VITE_PLATFORM_NAME || 'Fleet'
const contactEmail = import.meta.env.VITE_CONTACT_EMAIL || 'legal@fleet.app'

const vars = { platformName, platformNameUpper: platformName.toUpperCase(), contactEmail }

const navLinks = computed<NavLink[]>(() => [
  { label: t('nav.home'), href: '/', routerLink: true },
  { label: 'Docs', href: '/docs', routerLink: true },
  { label: t('footer.privacy'), href: '/privacy', routerLink: true },
  { label: t('nav.github'), href: 'https://github.com/fleet', external: true },
])

const sections = computed(() => [
  { id: 'description', title: t('terms.description.title'), body: t('terms.description.body', vars) },
  { id: 'account', title: t('terms.account.title'), body: t('terms.account.body') },
  { id: 'acceptable-use', title: t('terms.acceptableUse.title'), body: t('terms.acceptableUse.body') },
  { id: 'availability', title: t('terms.availability.title'), body: t('terms.availability.body') },
  { id: 'billing', title: t('terms.billing.title'), body: t('terms.billing.body', vars) },
  { id: 'ip', title: t('terms.ip.title'), body: t('terms.ip.body', vars) },
  { id: 'data-privacy', title: t('terms.dataPrivacy.title'), body: t('terms.dataPrivacy.body') },
  { id: 'termination', title: t('terms.termination.title'), body: t('terms.termination.body') },
  { id: 'liability', title: t('terms.liability.title'), body: t('terms.liability.body', vars) },
  { id: 'governing-law', title: t('terms.governingLaw.title'), body: t('terms.governingLaw.body') },
  { id: 'changes', title: t('terms.changes.title'), body: t('terms.changes.body') },
  { id: 'contact', title: t('terms.contact.title'), body: t('terms.contact.body', vars) },
])
</script>

<template>
  <div class="min-h-screen bg-white dark:bg-surface-950 text-surface-700 dark:text-surface-200">
    <TheNavbar :nav-links="navLinks" :dashboard-url="dashboardUrl" :show-locale-switcher="true" />

    <main class="pt-32 pb-20 sm:pt-40 sm:pb-32">
      <div class="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <h1 class="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white sm:text-5xl">
          {{ $t('terms.title') }}
        </h1>
        <p class="mt-4 text-sm text-surface-500">
          {{ $t('terms.lastUpdated') }}
        </p>
        <p class="mt-6 text-lg leading-relaxed text-surface-600 dark:text-surface-300">
          {{ $t('terms.intro', vars) }}
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
