<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { Box, Play, Square, RotateCw, Trash2 } from 'lucide-vue-next'

const route = useRoute()
const serviceId = route.params.id as string

const activeTab = ref('overview')
const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'logs', label: 'Logs' },
  { id: 'deployments', label: 'Deployments' },
  { id: 'settings', label: 'Settings' },
  { id: 'terminal', label: 'Terminal' },
]

const service = ref<any>(null)
const loading = ref(false)
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
      <div class="flex items-center gap-3">
        <Box class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
            {{ service?.name || 'Loading...' }}
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 font-mono">{{ serviceId }}</p>
        </div>
        <span
          v-if="service"
          :class="[
            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ml-2',
            service.status === 'running' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
            service.status === 'stopped' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
            'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
          ]"
        >
          {{ service.status }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium">
          <Play class="w-4 h-4" />
          Start
        </button>
        <button class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium">
          <Square class="w-4 h-4" />
          Stop
        </button>
        <button class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium">
          <RotateCw class="w-4 h-4" />
          Restart
        </button>
        <button class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm font-medium">
          <Trash2 class="w-4 h-4" />
          Delete
        </button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="border-b border-gray-200 dark:border-gray-700 mb-6">
      <nav class="flex gap-6 -mb-px">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="activeTab = tab.id"
          :class="[
            'pb-3 text-sm font-medium border-b-2 transition-colors',
            activeTab === tab.id
              ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
          ]"
        >
          {{ tab.label }}
        </button>
      </nav>
    </div>

    <!-- Tab content -->
    <div>
      <!-- Overview -->
      <div v-if="activeTab === 'overview'" class="space-y-6">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">CPU</p>
            <p class="text-lg font-bold text-gray-900 dark:text-white">0%</p>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Memory</p>
            <p class="text-lg font-bold text-gray-900 dark:text-white">0 MB</p>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Network In</p>
            <p class="text-lg font-bold text-gray-900 dark:text-white">0 B</p>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Network Out</p>
            <p class="text-lg font-bold text-gray-900 dark:text-white">0 B</p>
          </div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Service Info</h3>
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Image</dt>
              <dd class="font-mono text-gray-900 dark:text-white mt-0.5">--</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Replicas</dt>
              <dd class="text-gray-900 dark:text-white mt-0.5">--</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Created</dt>
              <dd class="text-gray-900 dark:text-white mt-0.5">--</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Last Deployed</dt>
              <dd class="text-gray-900 dark:text-white mt-0.5">--</dd>
            </div>
          </dl>
        </div>
      </div>

      <!-- Logs -->
      <div v-if="activeTab === 'logs'">
        <div class="bg-gray-900 rounded-xl border border-gray-700 shadow-sm overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <span class="text-sm font-medium text-gray-300">Service Logs</span>
            <button class="text-xs text-gray-400 hover:text-gray-300 transition-colors">Clear</button>
          </div>
          <div class="p-4 h-96 overflow-y-auto font-mono text-xs text-gray-300 leading-relaxed">
            <p class="text-gray-500">Waiting for log output...</p>
          </div>
        </div>
      </div>

      <!-- Deployments -->
      <div v-if="activeTab === 'deployments'">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Version</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Deployed At</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr>
                <td colspan="4" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No deployments yet.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Settings -->
      <div v-if="activeTab === 'settings'" class="space-y-6">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Environment Variables</h3>
          </div>
          <div class="p-6">
            <p class="text-sm text-gray-500 dark:text-gray-400">No environment variables configured.</p>
          </div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Resource Limits</h3>
          </div>
          <div class="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">CPU Limit</label>
              <input type="text" placeholder="1.0" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Memory Limit</label>
              <input type="text" placeholder="512M" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            </div>
          </div>
        </div>
      </div>

      <!-- Terminal -->
      <div v-if="activeTab === 'terminal'">
        <div class="bg-[#1a1b26] rounded-xl border border-gray-700 shadow-sm overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
            <span class="w-3 h-3 rounded-full bg-red-500"></span>
            <span class="w-3 h-3 rounded-full bg-yellow-500"></span>
            <span class="w-3 h-3 rounded-full bg-green-500"></span>
            <span class="ml-2 text-xs text-gray-400">Terminal</span>
          </div>
          <div class="p-4 h-96 font-mono text-sm text-gray-300">
            <p class="text-gray-500">Connect to terminal to interact with this service...</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
