<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  Network, Plus, Unlink, ArrowLeft, ArrowRight,
  Check, CreditCard, UserCircle, Cpu, HardDrive, Box, MemoryStick,
} from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useAccountStore } from '@/stores/account'

const { t, locale } = useI18n()
function localPlanName(plan: PlanData): string { return plan.nameTranslations?.[locale.value] || plan.name }
function localPlanDesc(plan: PlanData): string { return plan.descriptionTranslations?.[locale.value] || plan.description || '' }
const api = useApi()
const route = useRoute()
const router = useRouter()
const accountStore = useAccountStore()

const tree = ref<any>(null)
const loading = ref(true)
const error = ref('')
const releasingId = ref<string | null>(null)
const successMessage = ref('')

// ── Wizard state ──
type WizardStep = 'name' | 'plan' | 'billing' | 'confirm'

const showWizard = ref(false)
const wizardStep = ref<WizardStep>('name')

// Step 1: Name
const newName = ref('')

// Step 2: Plan selection
interface PlanData {
  id: string
  name: string
  slug: string
  description: string | null
  nameTranslations?: Record<string, string>
  descriptionTranslations?: Record<string, string>
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

// Step 3: Billing
const inheritBilling = ref(true)
const parentHasSubscription = ref(false)
const parentCheckLoading = ref(false)

// Step 4: Confirm / submit
const creating = ref(false)

// ── Computed ──
const selectedPlan = computed(() => plans.value.find((p) => p.id === selectedPlanId.value))

const stepIndex = computed(() => {
  const map: Record<WizardStep, number> = { name: 0, plan: 1, billing: 2, confirm: 3 }
  return map[wizardStep.value]
})

const wizardSteps = computed(() => [
  { key: 'name', label: t('subAccounts.wizard.step1Title') },
  { key: 'plan', label: t('subAccounts.wizard.step2Title') },
  { key: 'billing', label: t('subAccounts.wizard.step3Title') },
  { key: 'confirm', label: t('subAccounts.wizard.step4Title') },
])

const formatPrice = (cents: number) => {
  if (cents === 0) return t('subAccounts.wizard.free')
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

const cycleLabel = (cycle: string) => {
  const labels: Record<string, string> = {
    monthly: t('subAccounts.wizard.monthly'),
    yearly: t('subAccounts.wizard.yearly'),
    quarterly: t('subAccounts.wizard.quarterly'),
  }
  return labels[cycle] || cycle
}

const cycleSuffix = (cycle: string) => {
  const suffixes: Record<string, string> = {
    monthly: t('subAccounts.wizard.perMonth'),
    yearly: t('subAccounts.wizard.perYear'),
    quarterly: t('subAccounts.wizard.perQuarter'),
  }
  return suffixes[cycle] || ''
}

const formatLimit = (value: number) => value === -1 ? t('subAccounts.wizard.unlimited') : String(value)

// ── Tree ──
async function fetchTree() {
  loading.value = true
  const accountId = accountStore.currentAccount?.id
  if (!accountId) { loading.value = false; return }
  try {
    tree.value = await api.get<any>(`/accounts/${accountId}/tree`)
  } catch {
    tree.value = null
  } finally {
    loading.value = false
  }
}

function switchToAccount(accountId: string) {
  accountStore.switchAccount(accountId)
  router.push('/panel')
}

async function releaseChild(childId: string, childName: string) {
  if (!confirm(t('subAccounts.releaseConfirm', { name: childName }))) return
  const accountId = accountStore.currentAccount?.id
  if (!accountId) return
  releasingId.value = childId
  error.value = ''
  try {
    await api.post(`/accounts/${accountId}/release/${childId}`, {})
    await fetchTree()
    await accountStore.fetchAccounts()
  } catch (err: any) {
    error.value = err?.body?.error || t('subAccounts.releaseFailed')
  } finally {
    releasingId.value = null
  }
}

// ── Wizard functions ──
function openWizard() {
  showWizard.value = true
  wizardStep.value = 'name'
  newName.value = ''
  selectedPlanId.value = null
  selectedCycle.value = 'monthly'
  inheritBilling.value = true
  error.value = ''
  successMessage.value = ''
}

function closeWizard() {
  showWizard.value = false
  error.value = ''
}

async function fetchPlans() {
  plansLoading.value = true
  try {
    const data = await api.get<{
      plans: PlanData[]
      allowedCycles?: string[]
    }>('/billing/public/plans')
    plans.value = data.plans || []
    if (data.allowedCycles?.length) {
      allowedCycles.value = data.allowedCycles
    }
  } catch {
    plans.value = []
  } finally {
    plansLoading.value = false
  }
}

async function checkParentSubscription() {
  parentCheckLoading.value = true
  try {
    const sub = await api.get<any>('/billing/subscription')
    parentHasSubscription.value = sub && sub.status === 'active'
  } catch {
    parentHasSubscription.value = false
  } finally {
    parentCheckLoading.value = false
  }
}

function goToStep(step: WizardStep) {
  error.value = ''
  wizardStep.value = step
}

function nextFromName() {
  if (!newName.value.trim()) return
  goToStep('plan')
  if (plans.value.length === 0) fetchPlans()
}

function selectPlan(plan: PlanData) {
  selectedPlanId.value = plan.id
  goToStep('billing')
  checkParentSubscription()
}

function nextFromBilling() {
  goToStep('confirm')
}

async function submitWizard() {
  const accountId = accountStore.currentAccount?.id
  if (!accountId || !selectedPlanId.value) return

  creating.value = true
  error.value = ''
  try {
    const appUrl = window.location.origin
    const body: any = {
      name: newName.value.trim(),
      planId: selectedPlanId.value,
      billingCycle: selectedCycle.value,
      inheritBilling: inheritBilling.value,
    }

    // For own billing on paid plans, add redirect URLs
    if (!inheritBilling.value && selectedPlan.value && !selectedPlan.value.isFree) {
      body.successUrl = `${appUrl}/panel/sub-accounts?sub_account_created=true`
      body.cancelUrl = `${appUrl}/panel/sub-accounts`
    }

    const result = await api.post<any>(`/accounts/${accountId}/sub-accounts`, body)

    if (result.checkoutUrl) {
      // Redirect to Stripe checkout
      window.location.href = result.checkoutUrl
      return
    }

    // Success — no redirect needed
    showWizard.value = false
    successMessage.value = t('subAccounts.wizard.successCreated')
    setTimeout(() => { successMessage.value = '' }, 5000)
    await fetchTree()
    await accountStore.fetchAccounts()
  } catch (err: any) {
    error.value = err?.body?.error || t('subAccounts.createFailed')
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  fetchTree()

  // Handle return from Stripe checkout
  if (route.query.sub_account_created === 'true') {
    successMessage.value = t('subAccounts.wizard.successCreated')
    setTimeout(() => { successMessage.value = '' }, 5000)
    // Clean up query params
    router.replace({ path: route.path })
  }
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <Network class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('subAccounts.title') }}</h1>
      </div>
      <button
        v-if="!showWizard"
        @click="openWizard"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        {{ t('subAccounts.create') }}
      </button>
    </div>

    <!-- Success message -->
    <div v-if="successMessage" class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-3">
      <Check class="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
      <p class="text-sm text-green-700 dark:text-green-300">{{ successMessage }}</p>
    </div>

    <!-- Error message -->
    <div v-if="error && !showWizard" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- ─── Wizard ─── -->
    <div v-if="showWizard" class="mb-8 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <!-- Step indicator -->
      <div class="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-700">
        <div class="flex items-center gap-2">
          <template v-for="(step, i) in wizardSteps" :key="step.key">
            <div class="flex items-center gap-2">
              <div
                :class="[
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors',
                  i < stepIndex ? 'bg-primary-600 text-white' :
                  i === stepIndex ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 ring-2 ring-primary-500' :
                  'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500',
                ]"
              >
                <Check v-if="i < stepIndex" class="w-3.5 h-3.5" />
                <span v-else>{{ i + 1 }}</span>
              </div>
              <span
                :class="[
                  'text-xs font-medium hidden sm:block',
                  i <= stepIndex ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500',
                ]"
              >{{ step.label }}</span>
            </div>
            <div v-if="i < wizardSteps.length - 1" class="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          </template>
        </div>
      </div>

      <div class="p-6">
        <!-- Error inside wizard -->
        <div v-if="error" class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
        </div>

        <!-- Step 1: Name -->
        <div v-if="wizardStep === 'name'">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">{{ t('subAccounts.wizard.nameTitle') }}</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">{{ t('subAccounts.wizard.nameDesc') }}</p>
          <form @submit.prevent="nextFromName">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('subAccounts.accountName') }}</label>
            <input
              v-model="newName"
              type="text"
              :placeholder="t('subAccounts.namePlaceholder')"
              required
              autofocus
              class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
            <div class="flex items-center gap-3 mt-6">
              <button type="button" @click="closeWizard" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                {{ t('subAccounts.cancel') }}
              </button>
              <button type="submit" :disabled="!newName.trim()" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {{ t('subAccounts.wizard.next') }}
                <ArrowRight class="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>

        <!-- Step 2: Plan selection -->
        <div v-else-if="wizardStep === 'plan'">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">{{ t('subAccounts.wizard.planTitle') }}</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">{{ t('subAccounts.wizard.planDesc') }}</p>

          <!-- Cycle toggle -->
          <div v-if="allowedCycles.length > 1" class="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-lg w-fit mb-6">
            <button
              v-for="cycle in allowedCycles"
              :key="cycle"
              @click="selectedCycle = cycle"
              :class="[
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                selectedCycle === cycle
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
              ]"
            >
              {{ cycleLabel(cycle) }}
            </button>
          </div>

          <div v-if="plansLoading" class="flex items-center justify-center py-12">
            <CompassSpinner color="text-primary-600" />
          </div>

          <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <button
              v-for="plan in plans"
              :key="plan.id"
              @click="selectPlan(plan)"
              :class="[
                'relative text-left p-5 rounded-xl border-2 transition-all hover:shadow-md',
                selectedPlanId === plan.id
                  ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
              ]"
            >
              <span v-if="plan.isDefault" class="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300">
                {{ t('subAccounts.wizard.popular') }}
              </span>
              <h4 class="text-base font-semibold text-gray-900 dark:text-white">{{ localPlanName(plan) }}</h4>
              <p v-if="localPlanDesc(plan)" class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ localPlanDesc(plan) }}</p>
              <div class="mt-3">
                <span class="text-2xl font-bold text-gray-900 dark:text-white">{{ formatPrice(plan.priceCents) }}</span>
                <span v-if="!plan.isFree" class="text-sm text-gray-500 dark:text-gray-400">{{ cycleSuffix(selectedCycle) }}</span>
              </div>
              <div class="mt-4 space-y-2 text-xs text-gray-600 dark:text-gray-400">
                <div class="flex items-center gap-2">
                  <Box class="w-3.5 h-3.5 shrink-0" />
                  <span>{{ formatLimit(plan.containerLimit) }} {{ t('subAccounts.wizard.containers') }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <MemoryStick class="w-3.5 h-3.5 shrink-0" />
                  <span>{{ formatLimit(plan.memoryLimit) }} MB {{ t('subAccounts.wizard.memory') }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <Cpu class="w-3.5 h-3.5 shrink-0" />
                  <span>{{ formatLimit(plan.cpuLimit) }} {{ t('subAccounts.wizard.cpu') }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <HardDrive class="w-3.5 h-3.5 shrink-0" />
                  <span>{{ formatLimit(plan.storageLimit) }} GB {{ t('subAccounts.wizard.storage') }}</span>
                </div>
              </div>
            </button>
          </div>

          <div class="flex items-center gap-3 mt-6">
            <button @click="goToStep('name')" class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <ArrowLeft class="w-4 h-4" />
              {{ t('subAccounts.wizard.back') }}
            </button>
          </div>
        </div>

        <!-- Step 3: Billing -->
        <div v-else-if="wizardStep === 'billing'">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">{{ t('subAccounts.wizard.billingTitle') }}</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">{{ t('subAccounts.wizard.billingDesc') }}</p>

          <div v-if="parentCheckLoading" class="flex items-center justify-center py-12">
            <CompassSpinner color="text-primary-600" />
          </div>

          <div v-else class="space-y-3 max-w-lg">
            <!-- Inherit billing -->
            <button
              @click="inheritBilling = true"
              :disabled="!parentHasSubscription && !selectedPlan?.isFree"
              :class="[
                'w-full text-left p-4 rounded-xl border-2 transition-all',
                inheritBilling
                  ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
                !parentHasSubscription && !selectedPlan?.isFree ? 'opacity-50 cursor-not-allowed' : '',
              ]"
            >
              <div class="flex items-start gap-3">
                <CreditCard class="w-5 h-5 mt-0.5 shrink-0 text-primary-600 dark:text-primary-400" />
                <div>
                  <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('subAccounts.wizard.inheritBilling') }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ t('subAccounts.wizard.inheritDesc') }}</p>
                  <p v-if="!parentHasSubscription && !selectedPlan?.isFree" class="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    {{ t('subAccounts.wizard.parentNoSubscription') }}
                  </p>
                </div>
              </div>
            </button>

            <!-- Own billing -->
            <button
              @click="inheritBilling = false"
              :class="[
                'w-full text-left p-4 rounded-xl border-2 transition-all',
                !inheritBilling
                  ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
              ]"
            >
              <div class="flex items-start gap-3">
                <UserCircle class="w-5 h-5 mt-0.5 shrink-0 text-gray-600 dark:text-gray-400" />
                <div>
                  <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('subAccounts.wizard.ownBilling') }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ t('subAccounts.wizard.ownDesc') }}</p>
                </div>
              </div>
            </button>
          </div>

          <div class="flex items-center gap-3 mt-6">
            <button @click="goToStep('plan')" class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <ArrowLeft class="w-4 h-4" />
              {{ t('subAccounts.wizard.back') }}
            </button>
            <button @click="nextFromBilling" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors">
              {{ t('subAccounts.wizard.next') }}
              <ArrowRight class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Step 4: Confirm -->
        <div v-else-if="wizardStep === 'confirm'">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">{{ t('subAccounts.wizard.confirmTitle') }}</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">{{ t('subAccounts.wizard.confirmDesc') }}</p>

          <div class="max-w-lg space-y-3">
            <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div class="grid grid-cols-2 gap-y-3 text-sm">
                <span class="text-gray-500 dark:text-gray-400">{{ t('subAccounts.wizard.summaryName') }}</span>
                <span class="font-medium text-gray-900 dark:text-white">{{ newName }}</span>
                <span class="text-gray-500 dark:text-gray-400">{{ t('subAccounts.wizard.summaryPlan') }}</span>
                <span class="font-medium text-gray-900 dark:text-white">{{ selectedPlan?.name }}</span>
                <span class="text-gray-500 dark:text-gray-400">{{ t('subAccounts.wizard.summaryCycle') }}</span>
                <span class="font-medium text-gray-900 dark:text-white">{{ cycleLabel(selectedCycle) }}</span>
                <span class="text-gray-500 dark:text-gray-400">{{ t('subAccounts.wizard.summaryPrice') }}</span>
                <span class="font-medium text-gray-900 dark:text-white">
                  {{ selectedPlan ? formatPrice(selectedPlan.priceCents) : '' }}
                  <span v-if="selectedPlan && !selectedPlan.isFree" class="text-gray-500 dark:text-gray-400 font-normal">{{ cycleSuffix(selectedCycle) }}</span>
                </span>
                <span class="text-gray-500 dark:text-gray-400">{{ t('subAccounts.wizard.summaryBilling') }}</span>
                <span class="font-medium text-gray-900 dark:text-white">
                  {{ inheritBilling ? t('subAccounts.wizard.inheritBilling') : t('subAccounts.wizard.ownBilling') }}
                </span>
              </div>
            </div>

            <p v-if="!inheritBilling && selectedPlan && !selectedPlan.isFree" class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('subAccounts.wizard.checkoutNote') }}
            </p>
          </div>

          <div class="flex items-center gap-3 mt-6">
            <button @click="goToStep('billing')" :disabled="creating" class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50">
              <ArrowLeft class="w-4 h-4" />
              {{ t('subAccounts.wizard.back') }}
            </button>
            <button @click="submitWizard" :disabled="creating" class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              <CompassSpinner v-if="creating" size="w-4 h-4" />
              <Check v-else class="w-4 h-4" />
              {{ creating ? t('subAccounts.wizard.creating') : t('subAccounts.wizard.createButton') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Tree view ─── -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-8 h-8" />
    </div>

    <template v-else>
      <div v-if="tree" class="space-y-3">
        <!-- Root account -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ tree.account.name }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">{{ tree.account.slug }}</p>
            </div>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
              {{ t('subAccounts.current') }}
            </span>
          </div>
        </div>

        <!-- Children -->
        <div v-if="tree.children && tree.children.length > 0" class="ml-6 space-y-3">
          <div
            v-for="child in tree.children"
            :key="child.account.id"
            class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5"
          >
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ child.account.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">{{ child.account.slug }}</p>
                <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {{ t('subAccounts.status') }}
                  <span :class="child.account.status === 'active' ? 'text-green-600 dark:text-green-400' : 'text-gray-500'">
                    {{ child.account.status }}
                  </span>
                </p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  @click="switchToAccount(child.account.id)"
                  class="px-3 py-1.5 rounded-lg text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                >
                  {{ t('subAccounts.switchTo') }}
                </button>
                <button
                  @click="releaseChild(child.account.id, child.account.name)"
                  :disabled="releasingId === child.account.id"
                  class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                >
                  <CompassSpinner v-if="releasingId === child.account.id" size="w-3 h-3" />
                  <Unlink v-else class="w-3 h-3" />
                  {{ t('subAccounts.release') }}
                </button>
              </div>
            </div>

            <!-- Nested children -->
            <div v-if="child.children && child.children.length > 0" class="ml-6 mt-3 space-y-2">
              <div
                v-for="grandchild in child.children"
                :key="grandchild.account.id"
                class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-750"
              >
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">{{ grandchild.account.name }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 font-mono">{{ grandchild.account.slug }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    @click="switchToAccount(grandchild.account.id)"
                    class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    {{ t('subAccounts.switchTo') }}
                  </button>
                  <button
                    @click="releaseChild(grandchild.account.id, grandchild.account.name)"
                    :disabled="releasingId === grandchild.account.id"
                    class="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                  >
                    <CompassSpinner v-if="releasingId === grandchild.account.id" size="w-3 h-3" />
                    <Unlink v-else class="w-3 h-3" />
                    {{ t('subAccounts.release') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="ml-6">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-center">
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('subAccounts.noSubAccounts') }}</p>
          </div>
        </div>
      </div>

      <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('subAccounts.loadFailed') }}</p>
      </div>
    </template>
  </div>
</template>
