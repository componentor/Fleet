<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useServiceBilling, usePlanLocale, type ServiceTier } from '@/composables/useServiceBilling'
import { useCurrency } from '@/composables/useCurrency'
import { Check, Cpu, HardDrive, MemoryStick, Zap } from 'lucide-vue-next'

const props = defineProps<{
  modelValue?: string | null
  disabled?: boolean
  currentPlan?: ServiceTier
}>()

const emit = defineEmits<{
  'update:modelValue': [tierId: string | null]
}>()

const { tiers, tiersLoaded, fetchTiers, fetchFreeTierUsage, fetchBillingConfig } = useServiceBilling()
const { formatCents } = useCurrency()
const { planName: tierName, planDescription: tierDescription } = usePlanLocale()
const allowDowngrade = ref(true)
const freeTierLimitReached = ref(false)

onMounted(async () => {
  await fetchTiers()
  const [usage, config] = await Promise.all([
    fetchFreeTierUsage(),
    props.currentPlan ? fetchBillingConfig() : Promise.resolve(null),
  ])
  if (usage.limit != null && usage.used >= usage.limit) {
    freeTierLimitReached.value = true
  }
  if (config) allowDowngrade.value = config.allowDowngrade
})

function isDowngrade(tier: ServiceTier): boolean {
  if (!props.currentPlan) return false
  return tier.priceCents < props.currentPlan.priceCents || tier.sortOrder < props.currentPlan.sortOrder
}

function isFreeTierDisabled(tier: ServiceTier): boolean {
  if (!tier.isFree || !freeTierLimitReached.value) return false
  // Don't disable if the user is already on this free tier
  if (props.currentPlan?.id === tier.id) return false
  return true
}

const filteredTiers = computed(() => {
  let list = [...tiers.value]
  if (props.currentPlan && !allowDowngrade.value) {
    list = list.filter(t => !isDowngrade(t))
  }
  return list
})

function select(tier: ServiceTier) {
  if (props.disabled) return
  if (isFreeTierDisabled(tier)) return
  emit('update:modelValue', tier.id)
}

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`
  return `${mb} MB`
}
</script>

<template>
  <div v-if="!tiersLoaded" class="flex items-center justify-center py-8">
    <div class="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
  </div>
  <div v-else-if="filteredTiers.length === 0" class="text-sm text-gray-500 dark:text-gray-400 py-4">
    No plans available.
  </div>
  <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    <button
      v-for="tier in filteredTiers"
      :key="tier.id"
      :disabled="disabled || isFreeTierDisabled(tier)"
      :class="[
        'relative flex flex-col rounded-xl border-2 p-5 text-left transition-all',
        isFreeTierDisabled(tier)
          ? 'border-gray-200 dark:border-gray-700 opacity-60 cursor-not-allowed'
          : modelValue === tier.id
            ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 shadow-md'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
        (disabled && !isFreeTierDisabled(tier)) ? 'opacity-60 cursor-not-allowed' : '',
        (!disabled && !isFreeTierDisabled(tier)) ? 'cursor-pointer' : '',
      ]"
      @click="select(tier)"
    >
      <!-- Free tier limit reached badge -->
      <div v-if="isFreeTierDisabled(tier)" class="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-xs font-medium text-red-600 dark:text-red-400">
        Limit reached
      </div>
      <!-- Current plan badge -->
      <div v-else-if="currentPlan?.id === tier.id" class="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300">
        Current
      </div>
      <!-- Selected check -->
      <div
        v-else-if="modelValue === tier.id"
        class="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-white"
      >
        <Check class="h-4 w-4" />
      </div>

      <!-- Name + price -->
      <div class="mb-3">
        <h3 class="text-base font-semibold text-gray-900 dark:text-white">{{ tierName(tier) }}</h3>
        <p v-if="tierDescription(tier)" class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ tierDescription(tier) }}</p>
      </div>

      <div class="mb-4">
        <span v-if="tier.isFree" class="text-2xl font-bold text-gray-900 dark:text-white">Free</span>
        <template v-else>
          <span class="text-2xl font-bold text-gray-900 dark:text-white">{{ formatCents(tier.priceCents) }}</span>
          <span class="text-sm text-gray-500 dark:text-gray-400">/mo</span>
        </template>
      </div>

      <!-- Resource limits -->
      <ul class="space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
        <li class="flex items-center gap-2">
          <Cpu class="h-3.5 w-3.5 text-gray-400" />
          <span>{{ tier.cpuLimit }} vCPU{{ tier.cpuLimit > 1 ? 's' : '' }}</span>
        </li>
        <li class="flex items-center gap-2">
          <MemoryStick class="h-3.5 w-3.5 text-gray-400" />
          <span>{{ formatMb(tier.memoryLimit) }} RAM</span>
        </li>
        <li class="flex items-center gap-2">
          <HardDrive class="h-3.5 w-3.5 text-gray-400" />
          <span>{{ tier.storageLimit }} GB storage</span>
        </li>
        <li v-if="tier.volumeIncludedGb > 0" class="flex items-center gap-2">
          <Zap class="h-3.5 w-3.5 text-gray-400" />
          <span>{{ tier.volumeIncludedGb }} GB volume</span>
        </li>
        <li class="flex items-center gap-2">
          <Zap class="h-3.5 w-3.5 text-gray-400" />
          <span>{{ tier.containerLimit }} container{{ tier.containerLimit > 1 ? 's' : '' }}</span>
        </li>
      </ul>
    </button>
  </div>
</template>
