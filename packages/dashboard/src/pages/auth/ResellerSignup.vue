<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useAccountStore } from '@/stores/account'
import { useApi } from '@/composables/useApi'
import { useTheme } from '@/composables/useTheme'
import { UserPlus, Loader2, AlertCircle, Sun, Moon, Check } from 'lucide-vue-next'
import type { AuthTokens, User } from '@fleet/types'

// --- Composables ---
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()
const accountStore = useAccountStore()
const api = useApi()
const { theme, toggle } = useTheme()

// --- Route params ---
const slug = route.params.slug as string

// --- Branding data ---
interface ResellerPlan {
  id: string
  name: string
  slug: string
  priceCents: number
  description: string
}

interface ResellerBranding {
  brandName: string
  brandLogoUrl: string | null
  brandPrimaryColor: string
  brandDescription: string
  plans: ResellerPlan[]
  billingConfig: {
    allowedCycles: string[]
    cycleDiscounts: Record<string, number>
  }
}

const branding = ref<ResellerBranding | null>(null)
const pageLoading = ref(true)
const pageError = ref<'not-found' | 'error' | null>(null)

// --- Form state ---
const name = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const selectedPlanId = ref<string | null>(null)
const formError = ref('')
const submitting = ref(false)

// --- Computed ---
const accentColor = computed(() => branding.value?.brandPrimaryColor ?? '#6366f1')

const accentColorDark = computed(() => {
  // Lighten the accent color slightly for dark mode by blending with white
  const hex = accentColor.value.replace('#', '')
  const r = Math.min(255, parseInt(hex.substring(0, 2), 16) + 40)
  const g = Math.min(255, parseInt(hex.substring(2, 4), 16) + 40)
  const b = Math.min(255, parseInt(hex.substring(4, 6), 16) + 40)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
})

const passwordsMatch = computed(() => password.value === confirmPassword.value)
const passwordLongEnough = computed(() => password.value.length >= 8)

const canSubmit = computed(() =>
  name.value.trim().length > 0 &&
  email.value.trim().length > 0 &&
  passwordLongEnough.value &&
  passwordsMatch.value &&
  !submitting.value
)

// --- Fetch branding data ---
async function fetchBranding() {
  pageLoading.value = true
  pageError.value = null
  try {
    const data = await api.get<ResellerBranding>(`/reseller/r/${slug}`)
    branding.value = data
    if (data.plans.length > 0) {
      selectedPlanId.value = data.plans[0]!.id
    }
  } catch (e: any) {
    if (e?.status === 404) {
      pageError.value = 'not-found'
    } else {
      pageError.value = 'error'
    }
  } finally {
    pageLoading.value = false
  }
}

// --- Handle registration ---
async function handleSubmit() {
  formError.value = ''

  if (!passwordsMatch.value) {
    formError.value = 'Passwords do not match.'
    return
  }

  if (!passwordLongEnough.value) {
    formError.value = 'Password must be at least 8 characters.'
    return
  }

  submitting.value = true
  try {
    const data = await api.post<{ tokens: AuthTokens; user: User; account: any }>(
      `/reseller/r/${slug}/register`,
      {
        name: name.value.trim(),
        email: email.value.trim(),
        password: password.value,
      }
    )

    authStore.setTokens(data.tokens)
    authStore.user = data.user
    localStorage.setItem('fleet_user', JSON.stringify(data.user))

    await accountStore.fetchAccounts()
    await router.push('/panel')
  } catch (e: any) {
    formError.value = e?.body?.error ?? e?.body?.message ?? 'Registration failed. Please try again.'
  } finally {
    submitting.value = false
  }
}

// --- Format price ---
function formatPrice(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

// --- Mount ---
onMounted(fetchBranding)
</script>

<template>
  <div
    class="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden"
    :style="{
      '--accent': accentColor,
      '--accent-dark': accentColorDark,
    }"
  >
    <!-- Floating background decorations -->
    <div class="pointer-events-none fixed inset-0 overflow-hidden">
      <div
        class="absolute top-1/4 -left-20 w-72 h-72 rounded-full blur-3xl animate-float opacity-10"
        :style="{ backgroundColor: accentColor }"
      />
      <div
        class="absolute bottom-1/4 -right-20 w-96 h-96 rounded-full blur-3xl animate-float opacity-10"
        :style="{ backgroundColor: accentColor, animationDelay: '2s' }"
      />
      <div
        class="absolute top-2/3 left-1/3 w-48 h-48 rounded-full blur-3xl animate-float opacity-5"
        :style="{ backgroundColor: accentColor, animationDelay: '4s' }"
      />
    </div>

    <!-- Theme toggle -->
    <button
      @click="toggle"
      class="fixed top-4 right-4 z-10 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      :title="`Theme: ${theme}`"
    >
      <Sun v-if="theme === 'light'" class="w-5 h-5" />
      <Moon v-else class="w-5 h-5" />
    </button>

    <!-- Loading state -->
    <div v-if="pageLoading" class="relative z-10 flex flex-col items-center gap-4 animate-fade-in-up">
      <Loader2 class="w-8 h-8 text-gray-400 dark:text-gray-500 animate-spin" />
      <p class="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
    </div>

    <!-- Error: Page not found -->
    <div v-else-if="pageError === 'not-found'" class="relative z-10 text-center animate-fade-in-up">
      <div class="bg-white dark:bg-gray-800 shadow-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-8 max-w-md w-full">
        <AlertCircle class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
        <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Page not found</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
          The signup page you are looking for does not exist or is no longer available.
        </p>
        <router-link
          to="/login"
          class="inline-block px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          Go to login
        </router-link>
      </div>
    </div>

    <!-- Error: Generic error -->
    <div v-else-if="pageError === 'error'" class="relative z-10 text-center animate-fade-in-up">
      <div class="bg-white dark:bg-gray-800 shadow-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-8 max-w-md w-full">
        <AlertCircle class="w-12 h-12 text-red-400 dark:text-red-500 mx-auto mb-4" />
        <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Something went wrong</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
          We could not load the signup page. Please try again later.
        </p>
        <button
          @click="fetchBranding"
          class="inline-block px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          Try again
        </button>
      </div>
    </div>

    <!-- Main content -->
    <template v-else-if="branding">
      <!-- Brand header -->
      <div class="mb-8 text-center relative z-10 animate-fade-in-up">
        <div class="flex items-center justify-center gap-3 mb-2">
          <img
            v-if="branding.brandLogoUrl"
            :src="branding.brandLogoUrl"
            :alt="branding.brandName"
            class="h-10 w-auto object-contain"
          />
          <h1
            v-else
            class="text-3xl font-bold"
            :style="{ color: `var(--accent)` }"
          >
            {{ branding.brandName }}
          </h1>
        </div>
        <p
          v-if="branding.brandLogoUrl"
          class="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {{ branding.brandName }}
        </p>
        <p
          v-if="branding.brandDescription"
          class="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto"
        >
          {{ branding.brandDescription }}
        </p>
      </div>

      <!-- Card -->
      <div class="w-full max-w-md relative z-10 animate-fade-in-up" style="animation-delay: 0.1s;">
        <div class="bg-white dark:bg-gray-800 shadow-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-8">
          <div class="space-y-6">
            <div class="text-center">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">Create your account</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Get started with {{ branding.brandName }}
              </p>
            </div>

            <!-- Error alert -->
            <div
              v-if="formError"
              class="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3"
            >
              <p class="text-sm text-red-700 dark:text-red-300">{{ formError }}</p>
            </div>

            <!-- Registration form -->
            <form @submit.prevent="handleSubmit" class="space-y-4">
              <div>
                <label for="reseller-name" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Full Name
                </label>
                <input
                  id="reseller-name"
                  v-model="name"
                  type="text"
                  required
                  autocomplete="name"
                  placeholder="Enter your full name"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:border-transparent text-sm"
                  :style="{ '--tw-ring-color': accentColor }"
                />
              </div>

              <div>
                <label for="reseller-email" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Email
                </label>
                <input
                  id="reseller-email"
                  v-model="email"
                  type="email"
                  required
                  autocomplete="email"
                  placeholder="you@example.com"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:border-transparent text-sm"
                  :style="{ '--tw-ring-color': accentColor }"
                />
              </div>

              <div>
                <label for="reseller-password" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Password
                </label>
                <input
                  id="reseller-password"
                  v-model="password"
                  type="password"
                  required
                  autocomplete="new-password"
                  placeholder="Create a strong password"
                  minlength="8"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:border-transparent text-sm"
                  :style="{ '--tw-ring-color': accentColor }"
                />
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">Minimum 8 characters</p>
              </div>

              <div>
                <label for="reseller-confirm-password" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Confirm Password
                </label>
                <input
                  id="reseller-confirm-password"
                  v-model="confirmPassword"
                  type="password"
                  required
                  autocomplete="new-password"
                  placeholder="Confirm your password"
                  minlength="8"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:border-transparent text-sm"
                  :style="{ '--tw-ring-color': accentColor }"
                  :class="{ 'border-red-400 dark:border-red-500': confirmPassword.length > 0 && !passwordsMatch }"
                />
                <p
                  v-if="confirmPassword.length > 0 && !passwordsMatch"
                  class="mt-1 text-xs text-red-500 dark:text-red-400"
                >
                  Passwords do not match
                </p>
              </div>

              <!-- Plan selection -->
              <div v-if="branding.plans.length > 0" class="pt-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select a plan
                </label>
                <div class="space-y-2">
                  <button
                    v-for="plan in branding.plans"
                    :key="plan.id"
                    type="button"
                    @click="selectedPlanId = plan.id"
                    class="w-full text-left px-4 py-3 rounded-lg border-2 transition-all"
                    :class="selectedPlanId === plan.id
                      ? 'bg-gray-50 dark:bg-gray-700/50'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 bg-white dark:bg-gray-700/30'"
                    :style="selectedPlanId === plan.id
                      ? { borderColor: accentColor, boxShadow: `0 0 0 1px ${accentColor}20` }
                      : {}"
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {{ plan.name }}
                          </span>
                          <Check
                            v-if="selectedPlanId === plan.id"
                            class="w-4 h-4 shrink-0"
                            :style="{ color: accentColor }"
                          />
                        </div>
                        <p v-if="plan.description" class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                          {{ plan.description }}
                        </p>
                      </div>
                      <span class="text-sm font-bold text-gray-900 dark:text-gray-100 ml-3 shrink-0">
                        {{ formatPrice(plan.priceCents) }}<span class="text-xs font-normal text-gray-500 dark:text-gray-400">/mo</span>
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                :disabled="!canSubmit"
                class="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                :style="{
                  backgroundColor: canSubmit ? accentColor : undefined,
                }"
                :class="!canSubmit ? 'bg-gray-400 dark:bg-gray-600' : 'hover:brightness-90'"
              >
                <Loader2 v-if="submitting" class="w-4 h-4 animate-spin" />
                <UserPlus v-else class="w-4 h-4" />
                <span v-if="submitting">Creating account...</span>
                <span v-else>Create Account</span>
              </button>
            </form>

            <!-- Login link -->
            <p class="text-center text-sm text-gray-500 dark:text-gray-400">
              Already have an account?
              <router-link to="/login" class="hover:underline font-medium" :style="{ color: accentColor }">
                Sign in
              </router-link>
            </p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
