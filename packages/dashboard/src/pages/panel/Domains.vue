<script setup lang="ts">
import { ref } from 'vue'
import { Globe, Plus, Search } from 'lucide-vue-next'

const activeTab = ref<'my-domains' | 'buy-domain'>('my-domains')
const domains = ref<any[]>([])
const domainSearch = ref('')
const searchResults = ref<any[]>([])
const loading = ref(false)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Globe class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Domains</h1>
      </div>
      <button
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        Add Domain
      </button>
    </div>

    <!-- Tabs -->
    <div class="border-b border-gray-200 dark:border-gray-700 mb-6">
      <nav class="flex gap-6 -mb-px">
        <button
          @click="activeTab = 'my-domains'"
          :class="[
            'pb-3 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'my-domains'
              ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
          ]"
        >
          My Domains
        </button>
        <button
          @click="activeTab = 'buy-domain'"
          :class="[
            'pb-3 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'buy-domain'
              ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
          ]"
        >
          Buy Domain
        </button>
      </nav>
    </div>

    <!-- My Domains -->
    <div v-if="activeTab === 'my-domains'">
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Domain</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Records</th>
                <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-if="domains.length === 0">
                <td colspan="4" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No domains configured. Add your first domain to get started.
                </td>
              </tr>
              <tr
                v-for="domain in domains"
                :key="domain.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
              >
                <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ domain.name }}</td>
                <td class="px-6 py-4 text-sm">
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      domain.status === 'active'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                    ]"
                  >
                    {{ domain.status }}
                  </span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ domain.recordCount }}</td>
                <td class="px-6 py-4 text-right">
                  <button class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">Manage</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Buy Domain -->
    <div v-if="activeTab === 'buy-domain'">
      <div class="max-w-xl mb-6">
        <div class="relative">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            v-model="domainSearch"
            type="text"
            placeholder="Search for a domain name..."
            class="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>
      </div>

      <div v-if="searchResults.length === 0 && domainSearch" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-center">
        <p class="text-gray-500 dark:text-gray-400 text-sm">Search for a domain to check availability.</p>
      </div>

      <div v-if="searchResults.length > 0" class="space-y-3">
        <div
          v-for="result in searchResults"
          :key="result.domain"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 flex items-center justify-between"
        >
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">{{ result.domain }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ result.available ? 'Available' : 'Taken' }}</p>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-sm font-bold text-gray-900 dark:text-white">{{ result.price }}</span>
            <button
              v-if="result.available"
              class="px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors"
            >
              Register
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
