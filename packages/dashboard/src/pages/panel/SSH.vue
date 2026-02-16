<script setup lang="ts">
import { ref } from 'vue'
import { Key, Plus, Trash2, Shield } from 'lucide-vue-next'

const sshKeys = ref<any[]>([])
const ipRestrictions = ref<any[]>([])
const newKeyName = ref('')
const newKeyContent = ref('')
const newIp = ref('')
const loading = ref(false)
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Key class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">SSH Access</h1>
    </div>

    <div class="space-y-8">
      <!-- SSH Keys section -->
      <div>
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">SSH Keys</h2>
        </div>

        <!-- Add key form -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-4">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 class="text-sm font-medium text-gray-900 dark:text-white">Add SSH Key</h3>
          </div>
          <div class="p-6 space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Name</label>
              <input
                v-model="newKeyName"
                type="text"
                placeholder="My laptop key"
                class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Public Key</label>
              <textarea
                v-model="newKeyContent"
                rows="3"
                placeholder="ssh-ed25519 AAAA..."
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              ></textarea>
            </div>
            <button
              :disabled="!newKeyName || !newKeyContent"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Plus class="w-4 h-4" />
              Add Key
            </button>
          </div>
        </div>

        <!-- Keys table -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700">
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Fingerprint</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Added</th>
                  <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr v-if="sshKeys.length === 0">
                  <td colspan="4" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                    No SSH keys added yet.
                  </td>
                </tr>
                <tr
                  v-for="key in sshKeys"
                  :key="key.id"
                  class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                >
                  <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ key.name }}</td>
                  <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 font-mono">{{ key.fingerprint }}</td>
                  <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ key.createdAt }}</td>
                  <td class="px-6 py-4 text-right">
                    <button class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <Trash2 class="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- IP Restrictions section -->
      <div>
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <Shield class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">IP Restrictions</h2>
          </div>
        </div>

        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="p-6">
            <div class="flex gap-3 mb-4">
              <input
                v-model="newIp"
                type="text"
                placeholder="192.168.1.0/24"
                class="flex-1 max-w-sm px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              />
              <button
                :disabled="!newIp"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Plus class="w-4 h-4" />
                Add IP
              </button>
            </div>

            <div v-if="ipRestrictions.length === 0" class="py-6 text-center text-gray-500 dark:text-gray-400 text-sm">
              No IP restrictions configured. All IPs are allowed.
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="ip in ipRestrictions"
                :key="ip.id"
                class="flex items-center justify-between px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-750"
              >
                <div>
                  <span class="text-sm font-mono text-gray-900 dark:text-white">{{ ip.cidr }}</span>
                  <span class="text-xs text-gray-500 dark:text-gray-400 ml-2">{{ ip.label }}</span>
                </div>
                <button class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">Remove</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
