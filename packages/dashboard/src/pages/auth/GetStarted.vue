<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useAccountStore } from '@/stores/account'
import { useTheme } from '@/composables/useTheme'
import { useBranding } from '@/composables/useBranding'
import {
  Github,
  Mail,
  UserPlus,
  Check,
  ArrowRight,
  Package,
  Globe,
  Store,
  Sun,
  Moon,
  ShoppingCart,
} from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useCart } from '@/composables/useCart'
import { useCurrency } from '@/composables/useCurrency'
import CartDrawer from '@/components/landing/CartDrawer.vue'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const accountStore = useAccountStore()
const { theme, toggle: toggleTheme } = useTheme()
const { brandTitle, logoSrc } = useBranding()
const cart = useCart()
const { formatCurrency, selectedCurrency } = useCurrency()
const cartOpen = ref(false)

// ── Registration gate ────────────────────────────────────────────────────────
const registrationClosed = ref(false)
const registrationMessage = ref('')

// ── Wizard state ──────────────────────────────────────────────────────────────

type WizardStep = 'account' | 'welcome' | 'start'

const currentStep = ref<WizardStep>('account')
const loading = ref(false)
const error = ref('')

// Step 1: Account creation
const name = ref('')
const email = ref('')
const password = ref('')

// Query params
const preselectedDomains = (route.query.domains as string) || (route.query.domain as string) || null
const hasCart = route.query.cart === 'true' || cart.count.value > 0

// ── Computed ──────────────────────────────────────────────────────────────────

const stepIndex = computed(() => {
  const map: Record<WizardStep, number> = { account: 0, welcome: 1, start: 2 }
  return map[currentStep.value]
})

const steps = computed(() => [
  { key: 'account', label: t('onboarding.stepAccount') },
  { key: 'welcome', label: t('onboarding.stepWelcome') },
])

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  // Check registration status
  try {
    const res = await fetch('/api/v1/auth/registration-status')
    if (res.ok) {
      const data = await res.json()
      if (!data.open) {
        registrationClosed.value = true
        registrationMessage.value = data.message || t('onboarding.registrationClosed')
      }
    }
  } catch { /* ignore */ }

  // Handle OAuth redirect with registration=closed
  if (route.query.registration === 'closed') {
    registrationClosed.value = true
    registrationMessage.value = t('onboarding.registrationClosed')
  }

  // Initialize auth state
  if (!authStore.initialized) await authStore.init()
  if (authStore.isAuthenticated) {
    await accountStore.fetchAccounts()
    const isNewUser = sessionStorage.getItem('fleet_just_logged_in') === '1'
    if (isNewUser) {
      currentStep.value = 'start'
      return
    }
    if (cart.count.value > 0) {
      router.replace('/checkout')
    } else {
      router.replace('/panel')
    }
    return
  }

  currentStep.value = 'account'
})

// ── Step handlers ─────────────────────────────────────────────────────────────

async function handleRegister() {
  error.value = ''
  loading.value = true
  try {
    await authStore.register({ name: name.value, email: email.value, password: password.value })
    await accountStore.fetchAccounts()
    sessionStorage.setItem('fleet_just_logged_in', '1')
    goToStart()
  } catch (e: any) {
    error.value = e?.body?.error ?? e?.body?.message ?? t('onboarding.registrationFailed')
  } finally {
    loading.value = false
  }
}

function registerWithGithub() {
  // Store wizard return URL so OAuth callback can redirect back
  sessionStorage.setItem('fleet_onboarding_return', '/onboarding')
  window.location.href = '/api/v1/auth/github'
}

function registerWithGoogle() {
  sessionStorage.setItem('fleet_onboarding_return', '/onboarding')
  window.location.href = '/api/v1/auth/google'
}

function goToStart() {
  // Save preselected domains
  if (preselectedDomains) {
    localStorage.setItem('fleet_onboarding_domains', preselectedDomains)
  }
  // If cart has domains, save them for post-signup flow
  if (cart.count.value > 0) {
    const domainNames = cart.items.value.map(i => i.domain).join(',')
    localStorage.setItem('fleet_onboarding_domains', domainNames)
  }
  currentStep.value = 'start'
}

function navigateTo(path: string) {
  router.push(path)
}

// Random nautical welcome greeting (picked once per visit)
const welcomeGreetingIndex = Math.floor(Math.random() * 6)
const welcomeGreeting = computed(() =>
  t(`onboarding.welcomeGreeting${welcomeGreetingIndex}`, { name: authStore.user?.name?.split(' ')[0] || '' })
)

</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
    <!-- Floating background decorations -->
    <div class="pointer-events-none fixed inset-0 overflow-hidden">
      <div class="absolute top-1/4 -left-20 w-72 h-72 bg-primary-500/10 rounded-full blur-3xl animate-float"></div>
      <div class="absolute bottom-1/4 -right-20 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-float" style="animation-delay: 2s;"></div>
      <div class="absolute top-2/3 left-1/3 w-48 h-48 bg-primary-600/5 rounded-full blur-3xl animate-float" style="animation-delay: 4s;"></div>
    </div>

    <!-- Theme toggle -->
    <button
      @click="toggleTheme"
      class="fixed top-4 right-4 z-10 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      :title="`Theme: ${theme}`"
    >
      <Sun v-if="theme === 'light'" class="w-5 h-5" />
      <Moon v-else class="w-5 h-5" />
    </button>

    <!-- Logo -->
    <div class="mb-6 text-center relative z-10 animate-fade-in-up">
      <router-link to="/" class="flex items-center justify-center gap-2 mb-2">
        <template v-if="logoSrc()">
          <img :src="logoSrc()!" :alt="brandTitle" class="h-10 w-auto max-w-[200px] object-contain" />
        </template>
        <template v-else>
          <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700">
            <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
        </template>
        <h1 class="text-3xl font-medium text-gray-900 dark:text-white">{{ brandTitle }}</h1>
      </router-link>
    </div>

    <!-- Progress steps (visible on steps 1-3) -->
    <div
      v-if="stepIndex < 4"
      class="mb-6 relative z-10 animate-fade-in-up flex items-center gap-2"
      style="animation-delay: 0.05s;"
    >
      <template v-for="(step, i) in steps" :key="step.key">
        <div class="flex items-center gap-2">
          <div
            :class="[
              'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300',
              i < stepIndex
                ? 'bg-primary-600 text-white'
                : i === stepIndex
                  ? 'bg-primary-600 text-white animate-gentle-pulse'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500',
            ]"
          >
            <Check v-if="i < stepIndex" class="w-3.5 h-3.5" />
            <span v-else>{{ i + 1 }}</span>
          </div>
          <span
            :class="[
              'text-xs font-medium hidden sm:inline transition-colors',
              i <= stepIndex ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500',
            ]"
          >
            {{ step.label }}
          </span>
        </div>
        <div
          v-if="i < steps.length - 1"
          :class="[
            'w-8 h-0.5 transition-colors duration-300',
            i < stepIndex ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-700',
          ]"
        />
      </template>
    </div>

    <!-- Cart summary banner (clickable to open drawer) -->
    <button
      v-if="cart.count.value > 0 && stepIndex < 3"
      @click="cartOpen = true"
      class="w-full max-w-md mb-4 relative z-10 animate-fade-in-up text-left cursor-pointer"
      style="animation-delay: 0.08s;"
    >
      <div class="bg-white dark:bg-gray-800 border border-primary-200 dark:border-primary-800 rounded-xl px-5 py-3.5 shadow-sm hover:shadow-md hover:border-primary-300 dark:hover:border-primary-700 transition-all">
        <div class="flex items-center gap-3">
          <div class="p-2 rounded-lg bg-primary-50 dark:bg-primary-900/20 shrink-0">
            <ShoppingCart class="w-4 h-4 text-primary-600 dark:text-primary-400" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ $t('onboarding.cartSummary', { count: cart.count.value }, `${cart.count.value} domain(s) in your cart`) }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400 truncate">
              {{ cart.items.value.map(i => i.domain).join(', ') }}
            </p>
          </div>
          <span class="text-sm font-semibold text-primary-600 dark:text-primary-400 shrink-0">
            {{ formatCurrency(cart.total.value, cart.items.value[0]?.currency ?? selectedCurrency) }}
          </span>
        </div>
      </div>
    </button>

    <CartDrawer :open="cartOpen" @close="cartOpen = false" />

    <!-- ═══ Registration Closed ═══ -->
    <div
      v-if="registrationClosed && currentStep === 'account'"
      class="w-full max-w-md relative z-10 animate-slide-up-fade"
    >
      <div class="bg-white dark:bg-gray-800 shadow-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center space-y-5">
        <div class="mx-auto w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <svg class="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">{{ $t('onboarding.registrationClosedTitle') }}</h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{{ registrationMessage }}</p>
        <div class="pt-2">
          <router-link
            to="/login"
            class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
          >
            {{ $t('onboarding.alreadyHaveAccount') }}
          </router-link>
        </div>
      </div>
    </div>

    <!-- ═══ Step 1: Account Creation ═══ -->
    <Transition name="wizard" mode="out-in">
      <div
        v-if="currentStep === 'account' && !registrationClosed"
        key="account"
        class="w-full max-w-md relative z-10 animate-slide-up-fade"
      >
        <div class="bg-white dark:bg-gray-800 shadow-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-8">
          <div class="space-y-6">
            <div class="text-center">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ $t('onboarding.createAccount') }}</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ $t('onboarding.createAccountDesc') }}</p>
            </div>

            <!-- Error -->
            <div v-if="error" class="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
            </div>

            <!-- OAuth -->
            <div class="space-y-3">
              <button
                @click="registerWithGithub"
                class="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              >
                <Github class="w-5 h-5" />
                {{ $t('auth.signUpWithGithub') }}
              </button>
              <button
                @click="registerWithGoogle"
                class="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              >
                <Mail class="w-5 h-5" />
                {{ $t('auth.signUpWithGoogle') }}
              </button>
            </div>

            <!-- Divider -->
            <div class="relative">
              <div class="absolute inset-0 flex items-center">
                <div class="w-full border-t border-gray-200 dark:border-gray-600"></div>
              </div>
              <div class="relative flex justify-center text-sm">
                <span class="bg-white dark:bg-gray-800 px-3 text-gray-500 dark:text-gray-400">{{ $t('auth.orContinueWithEmail') }}</span>
              </div>
            </div>

            <!-- Form -->
            <form @submit.prevent="handleRegister" class="space-y-4">
              <div>
                <label for="gs-name" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('auth.nameLabel') }}</label>
                <input
                  id="gs-name"
                  v-model="name"
                  type="text"
                  required
                  autocomplete="name"
                  :placeholder="$t('auth.namePlaceholder')"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>
              <div>
                <label for="gs-email" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('auth.emailLabel') }}</label>
                <input
                  id="gs-email"
                  v-model="email"
                  type="email"
                  required
                  autocomplete="email"
                  :placeholder="$t('auth.emailPlaceholder')"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>
              <div>
                <label for="gs-password" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('auth.passwordLabel') }}</label>
                <input
                  id="gs-password"
                  v-model="password"
                  type="password"
                  required
                  autocomplete="new-password"
                  :placeholder="$t('auth.createStrongPassword')"
                  minlength="8"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">{{ $t('auth.passwordMinLength') }}</p>
              </div>
              <button
                type="submit"
                :disabled="loading"
                class="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                <CompassSpinner v-if="loading" size="w-4 h-4" />
                <UserPlus v-else class="w-4 h-4" />
                <span v-if="loading">{{ $t('auth.creatingAccount') }}</span>
                <span v-else>{{ $t('onboarding.createAndContinue') }}</span>
              </button>
            </form>

            <!-- Login link -->
            <p class="text-center text-sm text-gray-500 dark:text-gray-400">
              {{ $t('onboarding.alreadyHaveAccount') }}
              <router-link to="/login?redirect=/onboarding" class="text-primary-600 dark:text-primary-400 hover:underline font-medium">
                {{ $t('onboarding.signIn') }}
              </router-link>
            </p>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ═══ Step 2: Welcome ═══ -->
    <Transition name="wizard" mode="out-in">
      <div
        v-if="currentStep === 'welcome'"
        key="welcome"
        class="w-full max-w-lg relative z-10 text-center animate-slide-up-fade"
      >
        <div class="bg-white dark:bg-gray-800 shadow-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-10">
          <!-- Checkmark animation -->
          <div class="w-16 h-16 mx-auto mb-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center animate-scale-in">
            <Check class="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>

          <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {{ welcomeGreeting }}
          </h2>
          <p class="text-gray-500 dark:text-gray-400 mb-8">{{ $t('onboarding.welcomeBackDesc') }}</p>

          <button
            @click="goToStart"
            class="inline-flex items-center gap-2 px-8 py-3 rounded-lg bg-primary-600 hover:bg-primary-700 text-white font-semibold transition-colors"
          >
            {{ $t('onboarding.letsGo') }}
            <ArrowRight class="w-4 h-4" />
          </button>
        </div>
      </div>
    </Transition>

    <!-- ═══ Step 3: Where To Start ═══ -->
    <Transition name="wizard" mode="out-in">
      <div
        v-if="currentStep === 'start'"
        key="start"
        class="w-full max-w-2xl relative z-10 animate-slide-up-fade"
      >
        <div class="text-center mb-8">
          <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ $t('onboarding.whereToStart') }}</h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ $t('onboarding.whereToStartDesc') }}</p>
        </div>

        <!-- Cart domains notice -->
        <div
          v-if="cart.count.value > 0"
          class="mb-6 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl px-5 py-4"
        >
          <div class="flex items-start gap-3">
            <ShoppingCart class="w-5 h-5 text-primary-600 dark:text-primary-400 shrink-0 mt-0.5" />
            <div class="flex-1">
              <p class="text-sm font-medium text-primary-700 dark:text-primary-300 mb-2">
                {{ $t('onboarding.domainsReadyToRegister', 'Your domains are ready to register!') }}
              </p>
              <div class="space-y-1">
                <div v-for="item in cart.items.value" :key="item.domain" class="flex items-center justify-between text-sm">
                  <span class="text-primary-600 dark:text-primary-400 font-mono">{{ item.domain }}</span>
                  <span class="text-primary-500 dark:text-primary-400 font-medium">{{ formatCurrency(item.price, item.currency || selectedCurrency) }}/yr</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- Legacy domains notice -->
        <div
          v-else-if="preselectedDomains"
          class="mb-6 flex items-center gap-2 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg px-4 py-3"
        >
          <Globe class="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" />
          <p class="text-sm text-primary-700 dark:text-primary-300">{{ $t('onboarding.domainsSaved') }}</p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2 stagger-children">
          <!-- Register a Domain (promoted to first when cart has items) -->
          <button
            @click="navigateTo('/panel/domains')"
            :class="[
              'group rounded-xl border p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-lg',
              cart.count.value > 0
                ? 'bg-primary-50 dark:bg-primary-900/10 border-primary-200 dark:border-primary-800 hover:border-primary-400 dark:hover:border-primary-600 sm:col-span-2'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-700 order-4',
            ]"
          >
            <div class="flex items-start gap-4">
              <div class="p-2.5 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 shrink-0">
                <Globe class="w-5 h-5" />
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                  {{ cart.count.value > 0 ? $t('onboarding.completeRegistration', 'Complete Domain Registration') : $t('onboarding.registerDomain') }}
                </h3>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {{ cart.count.value > 0 ? $t('onboarding.completeRegistrationDesc', 'Finalize the registration of your selected domains') : $t('onboarding.registerDomainDesc') }}
                </p>
              </div>
              <ArrowRight class="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-primary-500 group-hover:translate-x-1 transition-all shrink-0 mt-1" />
            </div>
          </button>

          <!-- Deploy from Docker Hub -->
          <button
            @click="navigateTo('/panel/deploy')"
            class="group bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-primary-300 dark:hover:border-primary-700"
          >
            <div class="flex items-start gap-4">
              <div class="p-2.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 shrink-0">
                <Package class="w-5 h-5" />
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                  {{ $t('onboarding.deployDocker') }}
                </h3>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ $t('onboarding.deployDockerDesc') }}</p>
              </div>
              <ArrowRight class="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-primary-500 group-hover:translate-x-1 transition-all shrink-0 mt-1" />
            </div>
          </button>

          <!-- Browse Marketplace -->
          <button
            @click="navigateTo('/panel/marketplace')"
            class="group bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-primary-300 dark:hover:border-primary-700"
          >
            <div class="flex items-start gap-4">
              <div class="p-2.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 shrink-0">
                <Store class="w-5 h-5" />
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                  {{ $t('onboarding.browseMarketplace') }}
                </h3>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ $t('onboarding.browseMarketplaceDesc') }}</p>
              </div>
              <ArrowRight class="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-primary-500 group-hover:translate-x-1 transition-all shrink-0 mt-1" />
            </div>
          </button>
        </div>

        <!-- Skip to dashboard or back to landing -->
        <div class="mt-8 text-center">
          <button
            @click="navigateTo(authStore.isAuthenticated ? '/panel' : '/')"
            class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            {{ authStore.isAuthenticated ? $t('onboarding.skipToDashboard') : $t('onboarding.backToHome', 'Back to home') }} &rarr;
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
