<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useAccountStore } from '@/stores/account'
import { useApi } from '@/composables/useApi'
import { useTheme } from '@/composables/useTheme'
import { useBranding } from '@/composables/useBranding'
import {
  Github,
  Mail,
  UserPlus,
  Loader2,
  Check,
  ArrowRight,
  Rocket,
  Package,
  Globe,
  Store,
  Sun,
  Moon,
  Sparkles,
} from 'lucide-vue-next'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const api = useApi()
const authStore = useAuthStore()
const accountStore = useAccountStore()
const { theme, toggle: toggleTheme } = useTheme()
const { brandTitle, logoSrc } = useBranding()

// ── Wizard state ──────────────────────────────────────────────────────────────

type WizardStep = 'plan' | 'account' | 'checkout' | 'welcome' | 'start'

const currentStep = ref<WizardStep>('plan')
const loading = ref(false)
const error = ref('')

// Step 1: Account creation
const name = ref('')
const email = ref('')
const password = ref('')

// Step 2: Plan selection
interface PlanData {
  id: string
  name: string
  slug: string
  description: string | null
  isFree: boolean
  isDefault: boolean
  priceCents: number
  cpuLimit: number
  memoryLimit: number
  containerLimit: number
  storageLimit: number
  sortOrder: number
}

const plans = ref<PlanData[]>([])
const plansLoading = ref(false)
const selectedPlanId = ref<string | null>(null)
const selectedCycle = ref<string>('monthly')
const allowedCycles = ref<string[]>(['monthly', 'yearly'])
const trialDays = ref<number>(0)

// Step 3: Checkout
const checkoutLoading = ref(false)

// Query params
const preselectedPlan = (route.query.plan as string) || null
const preselectedCycle = (route.query.cycle as string) || null
const preselectedDomains = (route.query.domains as string) || (route.query.domain as string) || null

// ── Computed ──────────────────────────────────────────────────────────────────

const selectedPlan = computed(() => plans.value.find((p) => p.id === selectedPlanId.value))

const stepIndex = computed(() => {
  const map: Record<WizardStep, number> = { plan: 0, account: 1, checkout: 2, welcome: 3, start: 4 }
  return map[currentStep.value]
})

const steps = computed(() => [
  { key: 'plan', label: t('onboarding.stepPlan') },
  { key: 'account', label: t('onboarding.stepAccount') },
  { key: 'checkout', label: t('onboarding.stepCheckout') },
  { key: 'welcome', label: t('onboarding.stepWelcome') },
])

const formatPrice = (cents: number) => {
  if (cents === 0) return t('onboarding.free')
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

const cycleLabel = (cycle: string) => {
  const labels: Record<string, string> = {
    monthly: t('onboarding.monthly'),
    yearly: t('onboarding.yearly'),
    quarterly: t('onboarding.quarterly'),
    half_yearly: t('onboarding.halfYearly'),
    weekly: t('onboarding.weekly'),
    daily: t('onboarding.daily'),
  }
  return labels[cycle] || cycle
}

const cycleSuffix = (cycle: string) => {
  const suffixes: Record<string, string> = {
    monthly: t('onboarding.perMonth'),
    yearly: t('onboarding.perYear'),
    quarterly: t('onboarding.perQuarter'),
    half_yearly: t('onboarding.perHalfYear'),
    weekly: t('onboarding.perWeek'),
    daily: t('onboarding.perDay'),
  }
  return suffixes[cycle] || ''
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  // Initialize auth state
  if (!authStore.initialized) await authStore.init()
  if (authStore.isAuthenticated) {
    await accountStore.fetchAccounts()
  }

  // Handle return from Stripe checkout
  const stepParam = route.query.step as string
  const sessionId = route.query.session_id as string

  if (stepParam === 'welcome' && sessionId && authStore.isAuthenticated) {
    currentStep.value = 'welcome'
    await fetchPlans()
    return
  }

  if (stepParam === 'plan') {
    // Cancelled checkout — go back to plan selection
    currentStep.value = 'plan'
    await fetchPlans()
    return
  }

  // Always start on plan selection — transparency first
  currentStep.value = 'plan'
  await fetchPlans()
})

// ── API calls ─────────────────────────────────────────────────────────────────

async function fetchPlans() {
  plansLoading.value = true
  try {
    const data = await api.get<{
      plans: PlanData[]
      allowedCycles?: string[]
      trialDays?: number
    }>('/billing/public/plans')

    plans.value = data.plans || []

    if (data.allowedCycles?.length) {
      allowedCycles.value = data.allowedCycles
    }
    if (data.trialDays) {
      trialDays.value = data.trialDays
    }

    // Preselect from query param
    if (preselectedPlan) {
      const match = plans.value.find((p) => p.slug === preselectedPlan)
      if (match) selectedPlanId.value = match.id
    }
    if (preselectedCycle && allowedCycles.value.includes(preselectedCycle)) {
      selectedCycle.value = preselectedCycle
    }

    // Default to highlighted (non-free, non-default) or first plan
    if (!selectedPlanId.value && plans.value.length) {
      const recommended = plans.value.find((p) => !p.isFree && p.isDefault)
      selectedPlanId.value = recommended?.id ?? plans.value[0]?.id ?? null
    }
  } catch {
    // Plans will show empty state
  } finally {
    plansLoading.value = false
  }
}

// ── Step handlers ─────────────────────────────────────────────────────────────

async function handleRegister() {
  error.value = ''
  loading.value = true
  try {
    await authStore.register({ name: name.value, email: email.value, password: password.value })
    await accountStore.fetchAccounts()
    sessionStorage.setItem('fleet_just_logged_in', '1')
    // Account created — proceed with the selected plan
    await proceedAfterAuth()
  } catch (e: any) {
    error.value = e?.body?.error ?? e?.body?.message ?? t('onboarding.registrationFailed')
  } finally {
    loading.value = false
  }
}

function registerWithGithub() {
  // Store wizard return URL so OAuth callback can redirect back
  sessionStorage.setItem('fleet_onboarding_return', '/get-started')
  window.location.href = '/api/v1/auth/github'
}

function registerWithGoogle() {
  sessionStorage.setItem('fleet_onboarding_return', '/get-started')
  window.location.href = '/api/v1/auth/google'
}

async function handlePlanSelect(plan: PlanData) {
  selectedPlanId.value = plan.id

  // If not authenticated yet, go to account creation first
  if (!authStore.isAuthenticated) {
    currentStep.value = 'account'
    return
  }

  // Already authenticated — proceed directly
  await proceedAfterAuth()
}

async function proceedAfterAuth() {
  const plan = selectedPlan.value
  if (!plan) {
    currentStep.value = 'plan'
    return
  }

  if (plan.isFree) {
    // Skip checkout for free plans
    currentStep.value = 'welcome'
    return
  }

  // Proceed to checkout
  currentStep.value = 'checkout'
  await startCheckout(plan)
}

async function startCheckout(plan: PlanData) {
  checkoutLoading.value = true
  try {
    const appUrl = window.location.origin
    const result = await api.post<{ url: string }>('/billing/checkout', {
      billingModel: 'fixed',
      billingCycle: selectedCycle.value,
      planId: plan.id,
      successUrl: `${appUrl}/get-started?step=welcome&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/get-started?step=plan`,
    })

    if (result.url) {
      window.location.href = result.url
    }
  } catch (e: any) {
    error.value = e?.body?.error ?? t('onboarding.checkoutFailed')
    currentStep.value = 'plan'
  } finally {
    checkoutLoading.value = false
  }
}

function goToStart() {
  // Save preselected domains
  if (preselectedDomains) {
    localStorage.setItem('fleet_onboarding_domains', preselectedDomains)
  }
  currentStep.value = 'start'
}

function navigateTo(path: string) {
  router.push(path)
}

// Welcome step auto-advance
watch(currentStep, (step) => {
  if (step === 'welcome') {
    setTimeout(() => {
      if (currentStep.value === 'welcome') {
        goToStart()
      }
    }, 5000)
  }
})
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
        <h1 class="text-3xl font-bold text-primary-600 dark:text-primary-400">{{ brandTitle }}</h1>
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

    <!-- ═══ Step 1: Choose Your Plan ═══ -->
    <Transition name="wizard" mode="out-in">
      <div
        v-if="currentStep === 'plan'"
        key="plan"
        class="w-full max-w-4xl relative z-10 animate-slide-up-fade"
      >
        <div class="text-center mb-8">
          <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ $t('onboarding.choosePlan') }}</h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ $t('onboarding.choosePlanDesc') }}</p>
        </div>

        <!-- Billing cycle toggle -->
        <div v-if="allowedCycles.length > 1" class="flex justify-center mb-8">
          <div class="inline-flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            <button
              v-for="cycle in allowedCycles"
              :key="cycle"
              @click="selectedCycle = cycle"
              :class="[
                'px-4 py-2 rounded-md text-sm font-medium transition-all',
                selectedCycle === cycle
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
              ]"
            >
              {{ cycleLabel(cycle) }}
            </button>
          </div>
        </div>

        <!-- Plan cards -->
        <div v-if="plansLoading" class="flex justify-center py-12">
          <Loader2 class="w-8 h-8 text-primary-500 animate-spin" />
        </div>

        <div v-else-if="plans.length" class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 stagger-children">
          <div
            v-for="plan in plans"
            :key="plan.id"
            :class="[
              'relative bg-white dark:bg-gray-800 rounded-2xl border p-6 transition-all duration-300 hover:-translate-y-1 cursor-pointer',
              selectedPlanId === plan.id
                ? 'border-primary-500 shadow-lg shadow-primary-500/10 ring-2 ring-primary-500/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-lg',
            ]"
            @click="selectedPlanId = plan.id"
          >
            <!-- Popular badge -->
            <div
              v-if="plan.isDefault && !plan.isFree"
              class="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary-600 to-primary-500 px-3 py-0.5 rounded-full text-xs font-semibold text-white"
            >
              {{ $t('onboarding.popular') }}
            </div>

            <div class="mb-4">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ plan.name }}</h3>
              <p v-if="plan.description" class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ plan.description }}</p>
            </div>

            <!-- Price -->
            <div class="mb-6 flex items-baseline gap-1">
              <span class="text-3xl font-extrabold text-gray-900 dark:text-white">{{ formatPrice(plan.priceCents) }}</span>
              <span v-if="!plan.isFree" class="text-sm text-gray-500 dark:text-gray-400">{{ cycleSuffix(selectedCycle) }}</span>
            </div>

            <!-- Resource limits -->
            <ul class="space-y-2.5 mb-6">
              <li class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Check class="w-4 h-4 text-primary-500 shrink-0" />
                {{ plan.containerLimit === -1 ? $t('onboarding.unlimited') : plan.containerLimit }} {{ $t('onboarding.containers') }}
              </li>
              <li class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Check class="w-4 h-4 text-primary-500 shrink-0" />
                {{ plan.memoryLimit >= 1024 ? `${(plan.memoryLimit / 1024).toFixed(plan.memoryLimit % 1024 === 0 ? 0 : 1)}GB` : `${plan.memoryLimit}MB` }} {{ $t('onboarding.memory') }}
              </li>
              <li class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Check class="w-4 h-4 text-primary-500 shrink-0" />
                {{ plan.cpuLimit === -1 ? $t('onboarding.unlimited') : plan.cpuLimit }} {{ $t('onboarding.cpu') }}
              </li>
              <li class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Check class="w-4 h-4 text-primary-500 shrink-0" />
                {{ plan.storageLimit === -1 ? $t('onboarding.unlimited') : plan.storageLimit }}GB {{ $t('onboarding.storage') }}
              </li>
            </ul>

            <!-- Trial badge -->
            <div v-if="trialDays > 0 && !plan.isFree" class="mb-4">
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-xs font-medium text-green-700 dark:text-green-400">
                <Sparkles class="w-3 h-3" />
                {{ trialDays }} {{ $t('onboarding.dayTrial') }}
              </span>
            </div>

            <!-- Select button -->
            <button
              @click.stop="handlePlanSelect(plan)"
              :class="[
                'w-full py-2.5 rounded-lg text-sm font-semibold transition-all',
                selectedPlanId === plan.id && !plan.isFree
                  ? 'bg-primary-600 hover:bg-primary-700 text-white shadow-md shadow-primary-500/20'
                  : plan.isFree
                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    : 'bg-primary-600 hover:bg-primary-700 text-white',
              ]"
            >
              <span v-if="plan.isFree">{{ $t('onboarding.getStartedFree') }}</span>
              <span v-else class="flex items-center justify-center gap-1.5">
                {{ $t('onboarding.continue') }}
                <ArrowRight class="w-3.5 h-3.5" />
              </span>
            </button>
          </div>
        </div>

        <!-- No plans fallback -->
        <div v-else class="text-center py-12">
          <p class="text-gray-500 dark:text-gray-400">{{ $t('onboarding.noPlansAvailable') }}</p>
          <button
            @click="navigateTo('/panel')"
            class="mt-4 px-6 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
          >
            {{ $t('onboarding.skipToDashboard') }}
          </button>
        </div>

        <!-- Login link -->
        <p class="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {{ $t('onboarding.alreadyHaveAccount') }}
          <router-link to="/login" class="text-primary-600 dark:text-primary-400 hover:underline font-medium">
            {{ $t('onboarding.signIn') }}
          </router-link>
        </p>
      </div>
    </Transition>

    <!-- ═══ Step 2: Account Creation ═══ -->
    <Transition name="wizard" mode="out-in">
      <div
        v-if="currentStep === 'account'"
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
                <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
                <UserPlus v-else class="w-4 h-4" />
                <span v-if="loading">{{ $t('auth.creatingAccount') }}</span>
                <span v-else>{{ $t('onboarding.createAndContinue') }}</span>
              </button>
            </form>

            <!-- Login link -->
            <p class="text-center text-sm text-gray-500 dark:text-gray-400">
              {{ $t('onboarding.alreadyHaveAccount') }}
              <router-link to="/login" class="text-primary-600 dark:text-primary-400 hover:underline font-medium">
                {{ $t('onboarding.signIn') }}
              </router-link>
            </p>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ═══ Step 3: Checkout Redirect ═══ -->
    <Transition name="wizard" mode="out-in">
      <div
        v-if="currentStep === 'checkout'"
        key="checkout"
        class="w-full max-w-md relative z-10 text-center animate-slide-up-fade"
      >
        <div class="bg-white dark:bg-gray-800 shadow-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-12">
          <Loader2 class="w-10 h-10 text-primary-500 animate-spin mx-auto mb-4" />
          <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">{{ $t('onboarding.redirectingCheckout') }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('onboarding.redirectingCheckoutDesc') }}</p>

          <!-- Error fallback -->
          <div v-if="error" class="mt-6">
            <div class="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4">
              <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
            </div>
            <button
              @click="currentStep = 'plan'; error = ''"
              class="text-sm text-primary-600 dark:text-primary-400 hover:underline font-medium"
            >
              {{ $t('onboarding.backToPlans') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ═══ Step 4: Welcome ═══ -->
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
            {{ $t('onboarding.welcomeBack', { name: authStore.user?.name?.split(' ')[0] || '' }) }}
          </h2>
          <p class="text-gray-500 dark:text-gray-400 mb-8">{{ $t('onboarding.welcomeBackDesc') }}</p>

          <!-- Plan summary -->
          <div v-if="selectedPlan" class="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 mb-8 text-left">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{{ $t('onboarding.yourPlan') }}</h3>
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span class="text-gray-400 dark:text-gray-500">{{ $t('onboarding.plan') }}</span>
                <p class="font-medium text-gray-900 dark:text-white">{{ selectedPlan.name }}</p>
              </div>
              <div>
                <span class="text-gray-400 dark:text-gray-500">{{ $t('onboarding.containers') }}</span>
                <p class="font-medium text-gray-900 dark:text-white">{{ selectedPlan.containerLimit === -1 ? $t('onboarding.unlimited') : selectedPlan.containerLimit }}</p>
              </div>
              <div>
                <span class="text-gray-400 dark:text-gray-500">{{ $t('onboarding.memory') }}</span>
                <p class="font-medium text-gray-900 dark:text-white">{{ selectedPlan.memoryLimit >= 1024 ? `${(selectedPlan.memoryLimit / 1024).toFixed(0)}GB` : `${selectedPlan.memoryLimit}MB` }}</p>
              </div>
              <div>
                <span class="text-gray-400 dark:text-gray-500">{{ $t('onboarding.storage') }}</span>
                <p class="font-medium text-gray-900 dark:text-white">{{ selectedPlan.storageLimit === -1 ? $t('onboarding.unlimited') : `${selectedPlan.storageLimit}GB` }}</p>
              </div>
            </div>
          </div>

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

    <!-- ═══ Step 5: Where To Start ═══ -->
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

        <!-- Domains notice -->
        <div
          v-if="preselectedDomains"
          class="mb-6 flex items-center gap-2 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg px-4 py-3"
        >
          <Globe class="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" />
          <p class="text-sm text-primary-700 dark:text-primary-300">{{ $t('onboarding.domainsSaved') }}</p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2 stagger-children">
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

          <!-- Deploy from GitHub -->
          <button
            @click="navigateTo('/panel/deploy')"
            class="group bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-primary-300 dark:hover:border-primary-700"
          >
            <div class="flex items-start gap-4">
              <div class="p-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 shrink-0">
                <Github class="w-5 h-5" />
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                  {{ $t('onboarding.deployGithub') }}
                </h3>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ $t('onboarding.deployGithubDesc') }}</p>
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

          <!-- Register a Domain -->
          <button
            @click="navigateTo('/panel/domains')"
            class="group bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-primary-300 dark:hover:border-primary-700"
          >
            <div class="flex items-start gap-4">
              <div class="p-2.5 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 shrink-0">
                <Globe class="w-5 h-5" />
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                  {{ $t('onboarding.registerDomain') }}
                </h3>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ $t('onboarding.registerDomainDesc') }}</p>
              </div>
              <ArrowRight class="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-primary-500 group-hover:translate-x-1 transition-all shrink-0 mt-1" />
            </div>
          </button>
        </div>

        <!-- Skip to dashboard -->
        <div class="mt-8 text-center">
          <button
            @click="navigateTo('/panel')"
            class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            {{ $t('onboarding.skipToDashboard') }} &rarr;
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
