<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ChevronDown, Globe, Search, ExternalLink, Share2, ShoppingCart, AlertTriangle, X } from 'lucide-vue-next'
import { useDomainPicker, type DomainOption } from '@/composables/useDomainPicker'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  disabled?: boolean
  excludeServiceId?: string
}>(), {
  placeholder: 'app.example.com',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { domains, loading, fetchDomains, purchasedDomains, externalDomains, subdomainDomains } = useDomainPicker()

const open = ref(false)
const search = ref('')
const customMode = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)

onMounted(() => {
  fetchDomains()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

function handleClickOutside(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

// Filter domains based on search
function filterGroup(group: DomainOption[]) {
  if (!search.value) return group
  const q = search.value.toLowerCase()
  return group.filter(d => d.domain.toLowerCase().includes(q))
}

const filteredPurchased = computed(() => filterGroup(purchasedDomains.value))
const filteredExternal = computed(() => filterGroup(externalDomains.value))
const filteredSubdomain = computed(() => filterGroup(subdomainDomains.value))

const hasResults = computed(() =>
  filteredPurchased.value.length > 0 ||
  filteredExternal.value.length > 0 ||
  filteredSubdomain.value.length > 0
)

function selectDomain(domain: string) {
  emit('update:modelValue', domain)
  open.value = false
  search.value = ''
  customMode.value = false
}

function enableCustomMode() {
  customMode.value = true
  open.value = false
  search.value = ''
  // Focus the input after switching to custom mode
  setTimeout(() => inputRef.value?.focus(), 50)
}

function clearDomain() {
  emit('update:modelValue', '')
  customMode.value = false
  search.value = ''
}

function onInputChange(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function toggleDropdown() {
  if (props.disabled) return
  if (customMode.value) {
    customMode.value = false
    open.value = true
  } else {
    open.value = !open.value
  }
  search.value = ''
}

function isAssignedToOther(d: DomainOption): boolean {
  if (!d.assignedServiceId) return false
  if (props.excludeServiceId && d.assignedServiceId === props.excludeServiceId) return false
  return true
}
</script>

<template>
  <div ref="containerRef" class="relative">
    <!-- Input row -->
    <div class="flex items-center">
      <div class="relative flex-1">
        <!-- Custom mode: direct text input -->
        <input
          v-if="customMode"
          ref="inputRef"
          :value="modelValue"
          @input="onInputChange"
          type="text"
          :placeholder="placeholder"
          :disabled="disabled"
          class="w-full px-3 py-2 pr-16 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-gray-400 dark:placeholder-gray-500"
        />
        <!-- Selection mode: shows selected domain or placeholder -->
        <button
          v-else
          type="button"
          @click="toggleDropdown"
          :disabled="disabled"
          class="w-full px-3 py-2 pr-16 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-left text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
          :class="modelValue ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'"
        >
          {{ modelValue || placeholder }}
        </button>
        <!-- Right side buttons -->
        <div class="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          <button
            v-if="modelValue"
            type="button"
            @click.stop="clearDomain"
            class="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Clear"
          >
            <X class="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            @click.stop="toggleDropdown"
            :disabled="disabled"
            class="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <ChevronDown class="w-4 h-4 transition-transform" :class="open ? 'rotate-180' : ''" />
          </button>
        </div>
      </div>
    </div>

    <!-- Dropdown panel -->
    <div
      v-if="open"
      class="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg max-h-72 overflow-hidden"
    >
      <!-- Search filter -->
      <div class="p-2 border-b border-gray-200 dark:border-gray-700">
        <div class="relative">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            v-model="search"
            type="text"
            :placeholder="t('domainPicker.searchPlaceholder')"
            class="w-full pl-8 pr-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-1 focus:ring-primary-500 placeholder-gray-400 dark:placeholder-gray-500"
          />
        </div>
      </div>

      <!-- Scrollable domain list -->
      <div class="overflow-y-auto max-h-52">
        <!-- Loading state -->
        <div v-if="loading" class="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
          Loading domains...
        </div>

        <template v-else-if="hasResults">
          <!-- Purchased domains -->
          <div v-if="filteredPurchased.length > 0">
            <div class="px-3 py-1.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-750">
              {{ t('domainPicker.purchased') }}
            </div>
            <button
              v-for="d in filteredPurchased"
              :key="d.domain"
              type="button"
              @click="selectDomain(d.domain)"
              class="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between gap-2 transition-colors"
            >
              <div class="flex items-center gap-2 min-w-0">
                <ShoppingCart class="w-3.5 h-3.5 text-purple-500 shrink-0" />
                <span class="text-gray-900 dark:text-white truncate">{{ d.domain }}</span>
              </div>
              <span v-if="isAssignedToOther(d)" class="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                {{ t('domainPicker.inUseBy', { service: d.assignedServiceName }) }}
              </span>
            </button>
          </div>

          <!-- External (BYOD) domains -->
          <div v-if="filteredExternal.length > 0">
            <div class="px-3 py-1.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-750">
              {{ t('domainPicker.external') }}
            </div>
            <button
              v-for="d in filteredExternal"
              :key="d.domain"
              type="button"
              @click="selectDomain(d.domain)"
              class="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between gap-2 transition-colors"
            >
              <div class="flex items-center gap-2 min-w-0">
                <ExternalLink class="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span class="text-gray-900 dark:text-white truncate">{{ d.domain }}</span>
                <span v-if="!d.verified" class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle class="w-2.5 h-2.5" />
                  {{ t('domainPicker.pending') }}
                </span>
              </div>
              <span v-if="isAssignedToOther(d)" class="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                {{ t('domainPicker.inUseBy', { service: d.assignedServiceName }) }}
              </span>
            </button>
          </div>

          <!-- Shared subdomains -->
          <div v-if="filteredSubdomain.length > 0">
            <div class="px-3 py-1.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-750">
              {{ t('domainPicker.subdomain') }}
            </div>
            <button
              v-for="d in filteredSubdomain"
              :key="d.domain"
              type="button"
              @click="selectDomain(d.domain)"
              class="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between gap-2 transition-colors"
            >
              <div class="flex items-center gap-2 min-w-0">
                <Share2 class="w-3.5 h-3.5 text-teal-500 shrink-0" />
                <span class="text-gray-900 dark:text-white truncate">{{ d.domain }}</span>
              </div>
              <span v-if="isAssignedToOther(d)" class="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                {{ t('domainPicker.inUseBy', { service: d.assignedServiceName }) }}
              </span>
            </button>
          </div>
        </template>

        <!-- No domains -->
        <div v-else-if="!loading" class="px-3 py-4 text-center">
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('domainPicker.noDomains') }}</p>
          <p class="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{{ t('domainPicker.noDomainsHint') }}</p>
        </div>
      </div>

      <!-- Custom domain option -->
      <div class="border-t border-gray-200 dark:border-gray-700">
        <button
          type="button"
          @click="enableCustomMode"
          class="w-full px-3 py-2 text-left text-sm text-primary-600 dark:text-primary-400 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
        >
          <Globe class="w-3.5 h-3.5" />
          {{ t('domainPicker.customDomain') }}
        </button>
      </div>
    </div>
  </div>
</template>
