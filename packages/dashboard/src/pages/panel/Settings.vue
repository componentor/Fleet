<script setup lang="ts">
import { ref } from 'vue'
import { Settings, Save, AlertTriangle } from 'lucide-vue-next'

const accountName = ref('')
const accountSlug = ref('')
const loading = ref(false)
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Settings class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Account Settings</h1>
    </div>

    <div class="space-y-8 max-w-2xl">
      <!-- General settings -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">General</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Basic account information.</p>
        </div>
        <div class="p-6 space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Account Name</label>
            <input
              v-model="accountName"
              type="text"
              placeholder="My Account"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Account Slug</label>
            <input
              v-model="accountSlug"
              type="text"
              placeholder="my-account"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
            />
            <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">This is used in URLs and API calls.</p>
          </div>
        </div>
        <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors">
            <Save class="w-4 h-4" />
            Save Changes
          </button>
        </div>
      </div>

      <!-- Danger zone -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-800 shadow-sm">
        <div class="px-6 py-4 border-b border-red-200 dark:border-red-800">
          <div class="flex items-center gap-2">
            <AlertTriangle class="w-5 h-5 text-red-600 dark:text-red-400" />
            <h2 class="text-lg font-semibold text-red-600 dark:text-red-400">Danger Zone</h2>
          </div>
        </div>
        <div class="p-6 space-y-6">
          <!-- Disconnect from parent -->
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-medium text-gray-900 dark:text-white">Disconnect from Parent</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Remove this account from its parent organization. This cannot be undone.</p>
            </div>
            <button class="px-4 py-2 rounded-lg border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors">
              Disconnect
            </button>
          </div>

          <div class="border-t border-gray-200 dark:border-gray-700"></div>

          <!-- Delete account -->
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-medium text-gray-900 dark:text-white">Delete Account</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Permanently delete this account and all associated data. This cannot be undone.</p>
            </div>
            <button class="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors">
              Delete Account
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
