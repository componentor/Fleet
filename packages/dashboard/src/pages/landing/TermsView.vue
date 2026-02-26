<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LandingNavbar from '@/components/landing/LandingNavbar.vue'
import type { NavLink } from '@/components/landing/LandingNavbar.vue'
import LandingFooter from '@/components/landing/LandingFooter.vue'
import { useBranding } from '@/composables/useBranding'

const { t } = useI18n()
const { brandTitle } = useBranding()

const contactEmail = import.meta.env.VITE_CONTACT_EMAIL || 'legal@fleet.app'

const vars = computed(() => {
  const name = brandTitle.value || 'Fleet'
  return { platformName: name, platformNameUpper: name.toUpperCase(), contactEmail }
})

const navLinks = computed<NavLink[]>(() => [
  { label: t('landing.nav.home'), href: '/', routerLink: true },
  { label: 'Docs', href: '/docs', routerLink: true },
  { label: t('landing.footer.privacy'), href: '/privacy', routerLink: true },
  { label: t('landing.nav.github'), href: 'https://github.com/fleet', external: true },
])

const sections = computed(() => [
  { id: 'description', title: t('landing.terms.description.title'), body: t('landing.terms.description.body', vars.value) },
  { id: 'account', title: t('landing.terms.account.title'), body: t('landing.terms.account.body') },
  { id: 'acceptable-use', title: t('landing.terms.acceptableUse.title'), body: t('landing.terms.acceptableUse.body') },
  { id: 'availability', title: t('landing.terms.availability.title'), body: t('landing.terms.availability.body') },
  { id: 'billing', title: t('landing.terms.billing.title'), body: t('landing.terms.billing.body', vars.value) },
  { id: 'ip', title: t('landing.terms.ip.title'), body: t('landing.terms.ip.body', vars.value) },
  { id: 'data-privacy', title: t('landing.terms.dataPrivacy.title'), body: t('landing.terms.dataPrivacy.body') },
  { id: 'termination', title: t('landing.terms.termination.title'), body: t('landing.terms.termination.body') },
  { id: 'liability', title: t('landing.terms.liability.title'), body: t('landing.terms.liability.body', vars.value) },
  { id: 'governing-law', title: t('landing.terms.governingLaw.title'), body: t('landing.terms.governingLaw.body') },
  { id: 'changes', title: t('landing.terms.changes.title'), body: t('landing.terms.changes.body') },
  { id: 'contact', title: t('landing.terms.contact.title'), body: t('landing.terms.contact.body', vars.value) },
])
</script>

<template>
  <div class="min-h-screen bg-white dark:bg-surface-950 text-surface-700 dark:text-surface-200">
    <LandingNavbar :nav-links="navLinks" :show-locale-switcher="true" />

    <main class="pt-32 pb-20 sm:pt-40 sm:pb-32">
      <div class="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <h1 class="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white sm:text-5xl">
          {{ $t('landing.terms.title') }}
        </h1>
        <p class="mt-4 text-sm text-surface-500">
          {{ $t('landing.terms.lastUpdated') }}
        </p>
        <p class="mt-6 text-lg leading-relaxed text-surface-600 dark:text-surface-300">
          {{ $t('landing.terms.intro', vars) }}
        </p>

        <div class="mt-12 space-y-12">
          <section v-for="section in sections" :key="section.id" :id="section.id">
            <h2 class="text-2xl font-bold text-gray-900 dark:text-white">{{ section.title }}</h2>
            <p class="mt-4 leading-relaxed text-surface-600 dark:text-surface-300 whitespace-pre-line">{{ section.body }}</p>
          </section>
        </div>
      </div>
    </main>

    <LandingFooter />
  </div>
</template>
