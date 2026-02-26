<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LandingNavbar from '@/components/landing/LandingNavbar.vue'
import type { NavLink } from '@/components/landing/LandingNavbar.vue'
import LandingFooter from '@/components/landing/LandingFooter.vue'
import { useBranding } from '@/composables/useBranding'

const { t } = useI18n()
const { brandTitle, brandGithubUrl } = useBranding()

const contactEmail = import.meta.env.VITE_CONTACT_EMAIL || 'privacy@fleet.app'

const vars = computed(() => {
  const name = brandTitle.value || 'Fleet'
  return { platformName: name, platformNameUpper: name.toUpperCase(), contactEmail }
})

const navLinks = computed<NavLink[]>(() => {
  const links: NavLink[] = [
    { label: t('landing.nav.home'), href: '/', routerLink: true },
    { label: 'Docs', href: '/docs', routerLink: true },
    { label: t('landing.footer.terms'), href: '/terms', routerLink: true },
  ]
  if (brandGithubUrl.value) {
    links.push({ label: t('landing.nav.github'), href: brandGithubUrl.value, external: true })
  }
  return links
})

const sections = computed(() => [
  { id: 'info-collect', title: t('landing.privacy.infoCollect.title'), body: t('landing.privacy.infoCollect.body') },
  { id: 'how-we-use', title: t('landing.privacy.howWeUse.title'), body: t('landing.privacy.howWeUse.body', vars.value) },
  { id: 'data-storage', title: t('landing.privacy.dataStorage.title'), body: t('landing.privacy.dataStorage.body') },
  { id: 'third-party', title: t('landing.privacy.thirdParty.title'), body: t('landing.privacy.thirdParty.body') },
  { id: 'data-retention', title: t('landing.privacy.dataRetention.title'), body: t('landing.privacy.dataRetention.body') },
  { id: 'your-rights', title: t('landing.privacy.yourRights.title'), body: t('landing.privacy.yourRights.body') },
  { id: 'cookies', title: t('landing.privacy.cookies.title'), body: t('landing.privacy.cookies.body') },
  { id: 'changes', title: t('landing.privacy.changes.title'), body: t('landing.privacy.changes.body', vars.value) },
  { id: 'contact', title: t('landing.privacy.contact.title'), body: t('landing.privacy.contact.body', vars.value) },
])
</script>

<template>
  <div class="min-h-screen bg-white dark:bg-surface-950 text-surface-700 dark:text-surface-200">
    <LandingNavbar :nav-links="navLinks" :show-locale-switcher="true" />

    <main class="pt-32 pb-20 sm:pt-40 sm:pb-32">
      <div class="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <h1 class="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white sm:text-5xl">
          {{ $t('landing.privacy.title') }}
        </h1>
        <p class="mt-4 text-sm text-surface-500">
          {{ $t('landing.privacy.lastUpdated') }}
        </p>
        <p class="mt-6 text-lg leading-relaxed text-surface-600 dark:text-surface-300">
          {{ $t('landing.privacy.intro', vars) }}
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
